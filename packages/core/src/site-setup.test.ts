import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { planSite, type SiteFiles, siteFileText, sitePackageName, withoutRepositoryNotes } from "./site-setup.js";

const config = `import { defineConfig } from "@goodfellow-cms/core";
// import { github } from "@goodfellow-cms/github";
// import { gitlab } from "@goodfellow-cms/gitlab";

export default defineConfig({
  // backend: github({ repo: "your-name/your-site" }),
  // backend: gitlab({ project: "your-name/your-site", clientId: "your-application-id" }),
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
    [".gitlab-ci.yml", "pages:"],
    ["vercel.ts", "{}"],
    ["public/media/logo.png", new Uint8Array([137, 80, 78, 71])],
  ]);
}

describe("planSite", () => {
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
      ".github/workflows/deploy.yml",
      ".github/workflows/scheduled.yml",
    ]);
    const workflow = parse(siteFileText(github.get(".github/workflows/deploy.yml") ?? ""));
    // Cloudflare builds pushes itself, so the workflow only runs at night and when it's started.
    expect(Object.keys(workflow.on)).toEqual(["schedule", "workflow_dispatch"]);
    // The update is built with a token that can only read, and published by a job that runs none of the site's code.
    const update = workflow.jobs.update.steps.find((step: { id?: string }) => step.id === "update");
    expect(update.run).toBe('npx goodfellow update --commit --to "$TO"');
    expect(workflow.jobs.update.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs["publish-update"].permissions).toEqual({ contents: "write" });
    // The rebuild is for when no update was published, which Cloudflare would build by itself.
    expect(workflow.jobs.rebuild.if).toBe(`\${{ !cancelled() && needs.publish-update.outputs.sha == '' }}`);
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
    expect(Object.keys(pipeline)).toEqual(["update"]);
    expect(pipeline.update.script[0]).toContain('if [ -z "$GOODFELLOW_SCHEDULED_CHANGE" ]');
    expect(pipeline.update.script[1]).toContain(
      'curl --fail --silent --show-error --request POST "$CLOUDFLARE_DEPLOY_HOOK"',
    );
    expect(pipeline.update.rules).toEqual([
      { if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && ($CI_PIPELINE_SOURCE == "schedule" || $GOODFELLOW_UPDATE)' },
    ]);
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

  it("keeps every host's setup when none is chosen", async () => {
    const files = await planSite({ template: template(), name: "site", versions: { "@goodfellow-cms/core": "1.0.0" } });
    expect(files.has(".gitlab-ci.yml") && files.has("vercel.ts") && files.has(".github/workflows/deploy.yml")).toBe(
      true,
    );
    expect(files.get("goodfellow.config.tsx")).toBe(config);
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
