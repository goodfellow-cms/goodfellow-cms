import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BITBUCKET_PIPELINE_NAMES, BITBUCKET_PIPELINES } from "./bitbucket-setup.js";
import { TASK_BRANCH_PREFIX } from "./plugin-tasks.js";
import {
  hostsFor,
  parseRepo,
  planSite,
  type SiteFiles,
  siteFileText,
  sitePackageName,
  withoutRepositoryNotes,
} from "./site-setup.js";
import { SITE_OVERRIDES } from "./updates.js";

const config = `import { defineConfig } from "@goodfellow-cms/core";
// import { github } from "@goodfellow-cms/github";
// import { gitlab } from "@goodfellow-cms/gitlab";
// import { bitbucket } from "@goodfellow-cms/bitbucket";

export default defineConfig({
  // backend: github({ repo: "your-name/your-site" }),
  // backend: gitlab({ project: "your-name/your-site", clientId: "your-application-id" }),
  // backend: bitbucket({ repo: "your-workspace/your-site", clientId: "your-consumer-key" }),
});
`;

function template(): SiteFiles {
  return new Map<string, string | Uint8Array>([
    ["package.json", JSON.stringify({ name: "template", dependencies: { "@goodfellow-cms/core": "workspace:*" } })],
    [
      "README.md",
      "# Site\n\n<!-- goodfellow-repository -->\nFor the repository.\n<!-- /goodfellow-repository -->\n\nHello\n",
    ],
    ["goodfellow.config.tsx", config],
    ["_gitignore", "node_modules\n"],
    ["_npmrc", "ignore-scripts=true\n"],
    [".github/workflows/deploy.yml", "name: Deploy"],
    [".github/workflows/plugin-task.yml", "name: Plugin task"],
    [".gitlab-ci.yml", "pages:"],
    ["vercel.ts", "{}"],
    ["public/media/logo.png", new Uint8Array([137, 80, 78, 71])],
  ]);
}

describe("planSite", () => {
  it("keeps the setup that runs plugins' tasks for the git host the site is on, whoever builds it", async () => {
    const plan = (
      host: "github" | "gitlab",
      builder: "github-pages" | "gitlab-pages" | "vercel" | "cloudflare-pages",
    ) =>
      planSite({
        template: template(),
        name: "my-parish",
        versions: { "@goodfellow-cms/core": "1.2.3" },
        backend: { host, repo: "someone/my-parish" },
        host: builder,
      });
    for (const builder of ["github-pages", "vercel", "cloudflare-pages"] as const) {
      expect((await plan("github", builder)).has(".github/workflows/plugin-task.yml")).toBe(true);
    }
    for (const builder of ["gitlab-pages", "vercel", "cloudflare-pages"] as const) {
      const files = await plan("gitlab", builder);
      expect(files.has(".github/workflows/plugin-task.yml")).toBe(false);
      if (builder !== "gitlab-pages") {
        expect(siteFileText(files.get(".gitlab-ci.yml") ?? "")).toContain("npx goodfellow task");
      }
    }
  });

  it("names the site, uses published versions, and sets up its storage and host", async () => {
    const files = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: "github", repo: "someone/my-parish" },
      host: "github-pages",
    });
    expect(JSON.parse(siteFileText(files.get("package.json") ?? ""))).toEqual({
      name: "my-parish",
      dependencies: { "@goodfellow-cms/core": "^1.2.3" },
      // npm reads overrides only in the site's own package.json, so new sites get them.
      overrides: SITE_OVERRIDES,
    });
    expect(files.get("README.md")).toBe("# Site\n\nHello\n");
    expect(files.get("goodfellow.config.tsx")).toContain('backend: github({ repo: "someone/my-parish" }),');
    expect(files.get(".gitignore")).toBe("node_modules\n");
    expect(files.has("_gitignore")).toBe(false);
    expect(files.get(".npmrc")).toBe("ignore-scripts=true\n");
    expect([...files.keys()].filter((path) => /deploy|gitlab|vercel/.test(path))).toEqual([
      ".github/workflows/deploy.yml",
    ]);
    expect(files.get("public/media/logo.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("names an admin address of its own in the config, where the host serves a site at more than one", async () => {
    const plan = (host: "gitlab-pages" | "github-pages", admin: string) =>
      planSite({
        template: template(),
        name: "my-parish",
        versions: { "@goodfellow-cms/core": "1.2.3" },
        backend: { host: "gitlab", repo: "someone/my-parish" },
        host,
        admin,
      });
    const files = await plan("gitlab-pages", "https://admin.example.org/");
    expect(files.get("goodfellow.config.tsx")).toContain('  admin: { url: "https://admin.example.org" },');
    // The README says how to finish setting it up once the site is online.
    expect(files.get("README.md")).toContain("## Admin address");
    await expect(plan("github-pages", "https://admin.example.org")).rejects.toThrow("admin address");
    await expect(plan("gitlab-pages", "http://admin.example.org")).rejects.toThrow("admin address");
  });

  it("gives a site on Cloudflare Pages a nightly update and rebuild, in place of the other hosts' setups", async () => {
    const github = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: "github", repo: "someone/my-parish" },
      host: "cloudflare-pages",
    });
    expect([...github.keys()].filter((path) => /workflows|gitlab|vercel/.test(path))).toEqual([
      ".github/workflows/plugin-task.yml",
      ".github/workflows/deploy.yml",
      ".github/workflows/scheduled.yml",
    ]);
    const workflow = parse(siteFileText(github.get(".github/workflows/deploy.yml") ?? ""));
    // Cloudflare builds pushes itself, so the workflow runs at night, when it's started, and on pushes only for
    // the lockfile.
    expect(Object.keys(workflow.on)).toEqual(["push", "schedule", "workflow_dispatch"]);
    expect(workflow.on.push.paths).toEqual(["package.json"]);
    expect(workflow.jobs.lockfile.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs["publish-lockfile"].permissions).toEqual({ contents: "write" });
    expect(workflow.jobs.update.needs).toEqual(["check", "lockfile"]);
    // The update is built with a token that can only read, and published by a job that runs none of the site's code.
    const update = workflow.jobs.update.steps.find((step: { id?: string }) => step.id === "update");
    expect(update.run).toBe('npx goodfellow update --commit --to "$TO"');
    expect(workflow.jobs.update.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs["publish-update"].permissions).toEqual({ contents: "write" });
    // Each night a check decides whether to rebuild, and update first, unless GOODFELLOW_NIGHTLY turns it off.
    expect(workflow.jobs.check.if).toBe("github.event_name == 'schedule' && vars.GOODFELLOW_NIGHTLY != 'off'");
    expect(workflow.jobs.check.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.check.steps.at(-1).run).toBe("npx goodfellow nightly");
    expect(workflow.jobs.update.if).toContain("needs.check.outputs.update == 'true'");
    // The rebuild is for when no update was published, which Cloudflare would build by itself, and at night only
    // when the check says so.
    expect(workflow.jobs.rebuild.needs).toEqual(["check", "update", "publish-update", "lockfile", "publish-lockfile"]);
    expect(workflow.jobs.rebuild.if).toBe(
      `\${{ !cancelled() && (github.event_name != 'schedule' || needs.check.outputs.build == 'true' || needs.check.result == 'failure') && github.event_name != 'push' && needs.publish-update.outputs.sha == '' && needs.publish-lockfile.outputs.sha == '' }}`,
    );
    expect(workflow.jobs.rebuild.steps[0].env.HOOK).toBe(`\${{ secrets.CLOUDFLARE_DEPLOY_HOOK }}`);
    const scheduled = parse(siteFileText(github.get(".github/workflows/scheduled.yml") ?? ""));
    expect(scheduled.jobs.start.steps.at(-1).run).toContain("gh workflow run deploy.yml");

    const gitlab = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: "gitlab", repo: "someone/my-parish" },
      host: "cloudflare-pages",
    });
    expect([...gitlab.keys()].filter((path) => /workflows|gitlab|vercel/.test(path))).toEqual([".gitlab-ci.yml"]);
    const pipeline = parse(siteFileText(gitlab.get(".gitlab-ci.yml") ?? ""));
    // Not "pages", which GitLab would take for a GitLab Pages job.
    expect(Object.keys(pipeline)).toEqual(["variables", "lockfile", "update", "plugin-task"]);
    // The lockfile is written when package.json changes, and Cloudflare builds the push that publishes it.
    expect(pipeline.lockfile.rules).toEqual([
      { if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE == "push"', changes: ["package.json"] },
    ]);
    expect(pipeline.lockfile.script[0]).toContain('git push origin "HEAD:$CI_COMMIT_BRANCH"');
    // Scheduled changes and Rebuild now only rebuild; the nightly schedule checks first.
    expect(pipeline.update.script[0]).toContain(
      'elif [ -z "$GOODFELLOW_SCHEDULED_CHANGE" ] && [ -z "$GOODFELLOW_REBUILD" ]',
    );
    expect(pipeline.update.script[0]).toContain("npx goodfellow nightly --output nightly.env");
    expect(pipeline.update.script[1]).toContain('if [ "$update" = true ]');
    expect(pipeline.update.script[2]).toContain('if [ "$build" = false ] && [ "$update" = false ]');
    expect(pipeline.update.script[2]).toContain(
      'curl --fail --silent --show-error --request POST "$CLOUDFLARE_DEPLOY_HOOK"',
    );
    expect(pipeline.update.rules).toEqual([
      {
        if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && ($CI_PIPELINE_SOURCE == "schedule" || $GOODFELLOW_UPDATE || $GOODFELLOW_REBUILD)',
      },
    ]);
  });

  it("gives a site on Bitbucket Pipelines for its updates, scheduled changes and plugins' tasks, with Vercel building it", async () => {
    const files = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: "bitbucket", repo: "someone/my-parish" },
      host: "vercel",
    });
    expect(files.get("goodfellow.config.tsx")).toContain('backend: bitbucket({ repo: "someone/my-parish" }),');
    expect(files.get("goodfellow.config.tsx")).toContain('\nimport { bitbucket } from "@goodfellow-cms/bitbucket";');
    expect([...files.keys()].filter((path) => /workflows|gitlab|vercel|bitbucket/.test(path)).sort()).toEqual([
      BITBUCKET_PIPELINES,
      "vercel.ts",
    ]);
    const pipelines = siteFileText(files.get(BITBUCKET_PIPELINES) ?? "");
    const parsed = parse(pipelines) as {
      pipelines: { branches: Record<string, unknown>; custom: Record<string, Array<Record<string, unknown>>> };
    };
    expect(Object.keys(parsed.pipelines.branches)).toEqual(["main"]);
    // Publishing doesn't use build minutes: the lockfile step runs only when package.json changes.
    expect(JSON.stringify(parsed.pipelines.branches.main)).toContain('"includePaths":["package.json"]');
    const { update, scheduled, task } = BITBUCKET_PIPELINE_NAMES;
    expect(Object.keys(parsed.pipelines.custom)).toEqual([update, scheduled, task]);
    const script = (name: string) =>
      JSON.stringify(parsed.pipelines.custom[name]?.find((part) => "step" in part)?.step ?? {});
    expect(script(BITBUCKET_PIPELINE_NAMES.update)).toContain("npx goodfellow nightly --output nightly.env");
    expect(script(BITBUCKET_PIPELINE_NAMES.update)).toContain("VERCEL_DEPLOY_HOOK");
    // A scheduled change's rebuild only asks Vercel to build: it clones and installs nothing, so it takes seconds.
    expect(script(BITBUCKET_PIPELINE_NAMES.scheduled)).toContain("VERCEL_DEPLOY_HOOK");
    expect(script(BITBUCKET_PIPELINE_NAMES.scheduled)).toContain('"clone":{"enabled":false}');
    expect(script(BITBUCKET_PIPELINE_NAMES.scheduled)).not.toContain("npm");
    expect(script(BITBUCKET_PIPELINE_NAMES.task)).toContain(
      `HEAD:refs/heads/${TASK_BRANCH_PREFIX}$GOODFELLOW_TASK_REQUEST`,
    );
    expect(pipelines).toContain("--package-lock-only");
    expect(files.get("README.md")).toContain("## Bitbucket and Vercel");

    // Bitbucket's sites are put online by Vercel.
    expect(hostsFor("bitbucket")).toEqual(["vercel"]);
    await expect(
      planSite({
        template: template(),
        name: "my-parish",
        versions: {},
        backend: { host: "bitbucket", repo: "someone/my-parish" },
        host: "github-pages",
      }),
    ).rejects.toThrow("GitHub Pages");
  });

  it("gives a Next.js site on Cloudflare Pages goodfellow-next's commands, and both hosts' setups without a repository", async () => {
    const files = template();
    files.set("next.config.ts", "export default {};");
    const planned = await planSite({
      template: files,
      name: "site",
      versions: { "@goodfellow-cms/core": "1.0.0" },
      host: "cloudflare-pages",
    });
    expect(siteFileText(planned.get(".github/workflows/deploy.yml") ?? "")).toContain("npx goodfellow-next update");
    expect(siteFileText(planned.get(".github/workflows/scheduled.yml") ?? "")).toContain("npx goodfellow-next due");
    expect(siteFileText(planned.get(".gitlab-ci.yml") ?? "")).toContain("npx goodfellow-next update");
    expect(planned.has("vercel.ts")).toBe(false);
  });

  it("installs plugins as the admin panel would, listing them in a config that didn't", async () => {
    const files = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      plugins: [
        {
          name: "goodfellow-plugin-guestbook",
          release: { version: "1.0.0", published: "", provenance: true, goodfellow: "^1.2.0" },
          manifest: { version: 1, title: "Guestbook", permissions: { connect: ["https://guestbook.example.com"] } },
        },
      ],
      today: "2026-10-25",
    });
    const text = (path: string) => siteFileText(files.get(path) ?? "");
    expect(JSON.parse(text("package.json")).dependencies).toEqual({
      "@goodfellow-cms/core": "^1.2.3",
      "goodfellow-plugin-guestbook": "1.0.0",
    });
    expect(JSON.parse(text("plugins/installed/installed.json")).plugins["goodfellow-plugin-guestbook"].release).toBe(
      "1.0.0",
    );
    expect(text("plugins/installed/index.ts")).toContain('import plugin0 from "goodfellow-plugin-guestbook";');
    expect(text("goodfellow.config.tsx")).toContain("plugins: installedPlugins,");
  });

  it("keeps every host's setup when none is chosen", async () => {
    const files = await planSite({ template: template(), name: "site", versions: { "@goodfellow-cms/core": "1.0.0" } });
    expect(files.has(".gitlab-ci.yml") && files.has("vercel.ts") && files.has(".github/workflows/deploy.yml")).toBe(
      true,
    );
    expect(files.get("goodfellow.config.tsx")).toBe(config);
  });
});

describe("parseRepo", () => {
  it("reads Bitbucket repositories from their path or any of their addresses", () => {
    expect(parseRepo("bitbucket", "parish/site")).toBe("parish/site");
    expect(parseRepo("bitbucket", "https://bitbucket.org/parish/site/src/main/")).toBe("parish/site");
    expect(parseRepo("bitbucket", "https://someone@bitbucket.org/parish/site.git")).toBe("parish/site");
    expect(parseRepo("bitbucket", "parish")).toBeUndefined();
    expect(parseRepo("bitbucket", "https://gitlab.com/parish/site")).toBeUndefined();
  });
});

describe("sitePackageName", () => {
  it("makes a valid npm package name", () => {
    expect(sitePackageName("St. Joseph Parish")).toBe("st.-joseph-parish");
    expect(sitePackageName("---")).toBe("my-site");
    expect(sitePackageName("._My Site!--")).toBe("my-site");
  });
});

describe("withoutRepositoryNotes", () => {
  it("removes the notes for people reading a site in the Goodfellow repository", () => {
    const note = (text: string) => `<!-- goodfellow-repository -->\n${text}\n<!-- /goodfellow-repository -->\n\n`;
    expect(withoutRepositoryNotes(`# Site\n\n${note("One")}Text\n\n${note("Two")}End\n`)).toBe(
      "# Site\n\nText\n\nEnd\n",
    );
  });

  it("keeps a note that never ends", () => {
    expect(withoutRepositoryNotes("A\n<!-- goodfellow-repository -->\nB\n")).toBe(
      "A\n<!-- goodfellow-repository -->\nB\n",
    );
  });
});
