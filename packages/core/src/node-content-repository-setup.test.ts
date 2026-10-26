import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { vercelAdminHeaders } from "./admin-domain.js";
import {
  contentBuildsFor,
  type SeparateSetup,
  separateSetupFiles,
  separateSetupLinks,
} from "./content-repository-setup.js";
import { planSite, type SiteFiles, siteFileText } from "./site-setup.js";

const STARTER_VERCEL = readFileSync(new URL("../../../templates/starter/vercel.ts", import.meta.url), "utf8");

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
    ["README.md", "# Site\n\nHello\n\n## Working on the site\n\nRun it.\n"],
    ["goodfellow.config.tsx", config],
    ["_gitignore", "node_modules/\ndist/\n"],
    [".github/workflows/deploy.yml", "name: Deploy"],
    [".gitlab-ci.yml", "pages:"],
    ["vercel.ts", STARTER_VERCEL],
    ["content/site.json", "{}\n"],
    ["content/pages/index.json", "{}\n"],
    ["public/favicon.svg", "<svg/>"],
    ["public/media/logo.png", new Uint8Array([137, 80, 78, 71])],
    ["src/styles.css", "@import 'tailwindcss';\n"],
  ]);
}

const text = (files: SiteFiles, path: string) => {
  const file = files.get(path);
  if (file === undefined) throw new Error(`No ${path}`);
  return siteFileText(file);
};

/** Imports a generated `vercel.ts` as Vercel would, from a folder of its own. */
async function vercelConfig(source: string): Promise<Record<string, unknown>> {
  const dir = await mkdtemp(join(tmpdir(), "goodfellow-vercel-"));
  try {
    await writeFile(join(dir, "vercel.ts"), source);
    return ((await import(join(dir, "vercel.ts"))) as { config: Record<string, unknown> }).config;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("planSite with the content in a repository of its own", () => {
  const plan = (
    host: "github-pages" | "gitlab-pages" | "vercel" | "cloudflare-pages",
    build: "content" | "code" = "content",
    git: "github" | "gitlab" | "bitbucket" = host === "gitlab-pages" ? "gitlab" : "github",
  ) =>
    planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: git, repo: "parish/site" },
      host,
      content: { repo: "parish/site-content", build },
    });

  it("moves the content into content-repository/, which the code ignores and links to", async () => {
    const files = await plan("github-pages");
    expect([...files.keys()].filter((path) => path.startsWith("content/") || path.startsWith("public/media/"))).toEqual(
      [],
    );
    expect(text(files, "content-repository/content/site.json")).toBe("{}\n");
    expect(files.get("content-repository/public/media/logo.png")).toEqual(new Uint8Array([137, 80, 78, 71]));
    // The site's own public files stay with the code.
    expect(files.has("public/favicon.svg")).toBe(true);
    expect(text(files, ".gitignore")).toMatch(
      /node_modules\/\ndist\/\n\n#.*\n\/content-repository\/\n\/content\n\/public\/media\n$/,
    );
    // The admin panel edits the content repository.
    expect(text(files, "goodfellow.config.tsx")).toContain(
      'backend: github({ repo: "parish/site-content", contentOnly: true, code: "parish/site" }),',
    );
    expect(text(files, "README.md")).toMatch(/^# Site\n\nHello\n\n## Content in a repository of its own\n/);
    expect(text(files, "README.md")).toContain(
      "git clone https://github.com/parish/site-content.git content-repository",
    );
    expect(text(files, "content-repository/README.md")).toContain("[parish/site](https://github.com/parish/site)");
  });

  it("builds GitHub Pages from the content repository, and updates the code in its own", async () => {
    const files = await plan("github-pages");
    expect(files.has(".github/workflows/deploy.yml")).toBe(false);
    expect(files.has(".gitlab-ci.yml")).toBe(false);
    expect(files.has("vercel.ts")).toBe(false);

    const deploy = parse(text(files, "content-repository/.github/workflows/deploy.yml"));
    const steps = deploy.jobs.build.steps as Array<Record<string, unknown>>;
    // The jobs that run the site's code can only read, and keep no credentials.
    expect(deploy.permissions).toEqual({});
    expect(deploy.jobs.build.permissions).toEqual({ contents: "read", pages: "read" });
    expect(steps[0]).toEqual({
      uses: "actions/checkout@v5",
      with: {
        repository: "parish/site",
        "ssh-key": `\${{ secrets.GOODFELLOW_CODE_KEY }}`,
        "persist-credentials": false,
      },
    });
    expect(steps[1]).toEqual({
      uses: "actions/checkout@v5",
      with: { path: "content-repository", "persist-credentials": false },
    });
    expect(steps.map((step) => step.run).filter(Boolean)).toEqual([
      "npm ci",
      "npx goodfellow content copy",
      `npx goodfellow build --base "\${{ steps.pages.outputs.base_path }}/"`,
    ]);
    // Each hour, a build only once a scheduled change has come due, checked with the code and content in place.
    const scheduled = parse(text(files, "content-repository/.github/workflows/scheduled.yml"));
    expect(scheduled.on.schedule).toEqual([{ cron: "47 * * * *" }]);
    const check = scheduled.jobs.check.steps as Array<Record<string, unknown>>;
    expect(check.slice(0, 2)).toEqual(steps.slice(0, 2));
    expect(check.map((step) => step.run).filter(Boolean)).toEqual([
      "npm ci",
      "npx goodfellow content copy",
      expect.stringContaining("gh run list"),
      'npx goodfellow due --since "$SINCE"',
    ]);
    // Starting the build runs none of the site's code.
    expect(scheduled.jobs.start.permissions).toEqual({ actions: "write" });
    expect(scheduled.jobs.start.steps.map((step: { run?: string }) => step.run)).toEqual([
      'gh workflow run deploy.yml --repo "$GITHUB_REPOSITORY" --ref "$GITHUB_REF_NAME"',
    ]);

    const update = parse(text(files, ".github/workflows/update.yml"));
    expect(update.jobs.update.steps[1].with).toEqual({
      repository: "parish/site-content",
      path: "content-repository",
      "ssh-key": `\${{ secrets.GOODFELLOW_CONTENT_KEY }}`,
      "persist-credentials": false,
    });
    // The update builds with a token that can only read; publishing it runs none of the site's code.
    expect(update.jobs.update.permissions).toEqual({ contents: "read" });
    expect(update.jobs["publish-update"].permissions).toEqual({ contents: "write" });
    expect(update.jobs["publish-update"].steps.some((step: { run?: string }) => step.run?.includes("npm"))).toBe(false);
    expect(update.jobs.build.steps[0].run).toContain("gh workflow run deploy.yml --repo parish/site-content");
  });

  it("builds GitLab Pages from the content project, which the code project's pipeline starts", async () => {
    const files = await plan("gitlab-pages");
    expect(text(files, "goodfellow.config.tsx")).toContain(
      'backend: gitlab({ project: "parish/site-content", contentOnly: true, code: "parish/site" }),',
    );
    const pages = parse(text(files, "content-repository/.gitlab-ci.yml")).pages;
    expect(pages.script).toContain("npx goodfellow content copy ..");
    expect(pages.script[0]).toContain("/parish/site.git");
    expect(pages.pages).toEqual({ publish: "site/dist" });

    const code = parse(text(files, ".gitlab-ci.yml"));
    expect(code.update.script[0]).toContain("/parish/site-content.git");
    expect(code.build.trigger).toEqual({ project: "parish/site-content" });
  });

  it("builds on Vercel from the code repository, which clones the content when it installs", async () => {
    const files = await plan("vercel", "code");
    const vercel = await vercelConfig(text(files, "vercel.ts"));
    expect(vercel.installCommand).toBe(
      `npm ci && git clone --depth 1 "https://\${GOODFELLOW_CONTENT_TOKEN:+x-access-token:$GOODFELLOW_CONTENT_TOKEN@}github.com/parish/site-content.git" content-repository && npx goodfellow content copy`,
    );
    expect(vercel.outputDirectory).toBe("dist");
    // The content repository asks Vercel to rebuild the site when it changes.
    const rebuild = parse(text(files, "content-repository/.github/workflows/rebuild.yml"));
    expect(rebuild.jobs.rebuild.steps[0].run).toContain('curl --fail --silent --show-error --request POST "$HOOK"');
  });

  it("builds on Vercel from the content repository, which clones the code", async () => {
    const files = await plan("vercel", "content");
    const vercel = await vercelConfig(text(files, "content-repository/vercel.ts"));
    expect(vercel).toMatchObject({
      installCommand: `git clone --depth 1 "https://\${GOODFELLOW_CODE_TOKEN:+x-access-token:$GOODFELLOW_CODE_TOKEN@}github.com/parish/site.git" site && cd site && npm ci && npx goodfellow content copy ..`,
      buildCommand: "cd site && npx goodfellow build",
      outputDirectory: "site/dist",
    });
    expect(parse(text(files, ".github/workflows/rebuild.yml")).on.push).toEqual({ branches: ["main"] });
    // Vercel reads it before the code is cloned, so the admin address's header rules are written out in it.
    expect(vercel.headers).toEqual([]);
  });

  it("keeps a Bitbucket site's content apart, with Vercel building either repository and the content's pipelines rebuilding it", async () => {
    // Vercel builds the code, which clones the content with a repository access token.
    const fromCode = await plan("vercel", "code", "bitbucket");
    expect(text(fromCode, "goodfellow.config.tsx")).toContain(
      'backend: bitbucket({ repo: "parish/site-content", contentOnly: true, code: "parish/site" }),',
    );
    const vercel = await vercelConfig(text(fromCode, "vercel.ts"));
    expect(vercel.installCommand).toContain(
      `\${GOODFELLOW_CONTENT_TOKEN:+x-token-auth:$GOODFELLOW_CONTENT_TOKEN@}bitbucket.org/parish/site-content.git`,
    );
    expect(text(fromCode, "vercel.ts").replace(/\s*\/\/\s*/g, " ")).toContain(
      "a repository access token for parish/site-content with Repositories: Read",
    );
    const content = parse(text(fromCode, "content-repository/bitbucket-pipelines.yml"));
    // The content's pipelines rebuild when it changes, for scheduled changes and each night, running none of the code.
    expect(Object.keys(content.pipelines.branches)).toEqual(["main"]);
    expect(Object.keys(content.pipelines.custom)).toEqual(["scheduled", "rebuild"]);
    for (const step of [
      content.pipelines.branches.main,
      content.pipelines.custom.scheduled,
      content.pipelines.custom.rebuild,
    ]) {
      expect(step[0].step.clone).toEqual({ enabled: false });
      expect(step[0].step.script[0]).toContain(
        'curl --fail --silent --show-error --request POST "$VERCEL_DEPLOY_HOOK"',
      );
    }
    expect(fromCode.has("bitbucket-pipelines.yml")).toBe(false);
    expect(fromCode.has(".github/workflows/plugin-task.yml")).toBe(false);
    expect(text(fromCode, "README.md")).toContain("https://bitbucket.org/parish/site-content");

    // Vercel builds the content, which clones the code; the code asks it to rebuild when it changes.
    const fromContent = await plan("vercel", "content", "bitbucket");
    const contentVercel = await vercelConfig(text(fromContent, "content-repository/vercel.ts"));
    expect(contentVercel.installCommand).toContain(
      `\${GOODFELLOW_CODE_TOKEN:+x-token-auth:$GOODFELLOW_CODE_TOKEN@}bitbucket.org/parish/site.git`,
    );
    const own = parse(text(fromContent, "content-repository/bitbucket-pipelines.yml"));
    expect(own.pipelines.branches).toBeUndefined();
    expect(Object.keys(own.pipelines.custom)).toEqual(["scheduled", "rebuild"]);
    const code = parse(text(fromContent, "bitbucket-pipelines.yml"));
    expect(Object.keys(code.pipelines.branches)).toEqual(["main"]);
    expect(code.pipelines.custom).toBeUndefined();

    expect(separateSetupLinks({ git: "bitbucket", host: "vercel", build: "code" })).toEqual({
      reads: [],
      nightly: ["content"],
    });
    expect(() =>
      separateSetupFiles({
        git: "bitbucket",
        host: "cloudflare-pages",
        build: "content",
        code: "parish/site",
        content: "parish/site-content",
        next: false,
      }),
    ).toThrow("Vercel");
  });

  it("names an admin address in the code's config, with Vercel's header rules written out in the content's vercel.ts", async () => {
    const files = await planSite({
      template: template(),
      name: "my-parish",
      versions: { "@goodfellow-cms/core": "1.2.3" },
      backend: { host: "github", repo: "parish/site" },
      host: "vercel",
      content: { repo: "parish/site-content", build: "content" },
      admin: "https://admin.example.org",
    });
    expect(text(files, "goodfellow.config.tsx")).toContain('  admin: { url: "https://admin.example.org" },');
    const vercel = await vercelConfig(text(files, "content-repository/vercel.ts"));
    expect(vercel.headers).toEqual(vercelAdminHeaders({ url: "https://admin.example.org" }));
    // The admin panel can't publish the code's config, so the README says to check it from a computer.
    expect(text(files, "README.md")).toContain("run `npx goodfellow admin check` here");
  });

  it("builds on Cloudflare Pages from the content repository, which the code asks to rebuild", async () => {
    const github = await plan("cloudflare-pages");
    expect([...github.keys()].filter((path) => path.includes(".github") || path.endsWith(".gitlab-ci.yml"))).toEqual([
      ".github/workflows/update.yml",
      "content-repository/.github/workflows/scheduled.yml",
    ]);
    const update = parse(text(github, ".github/workflows/update.yml"));
    expect(update.jobs.rebuild.if).toBe(`\${{ !cancelled() }}`);
    expect(update.jobs.rebuild.steps[0].env.HOOK).toBe(`\${{ secrets.CLOUDFLARE_DEPLOY_HOOK }}`);
    const scheduled = parse(text(github, "content-repository/.github/workflows/scheduled.yml"));
    expect(scheduled.jobs.start.steps.at(-1).env.HOOK).toBe(`\${{ secrets.CLOUDFLARE_DEPLOY_HOOK }}`);
    // The README says what to put in Cloudflare's settings.
    expect(text(github, "content-repository/README.md")).toContain(
      `the build command \`git clone --depth 1 "https://\${GOODFELLOW_CODE_TOKEN:+x-access-token:$GOODFELLOW_CODE_TOKEN@}github.com/parish/site.git" site && cd site && npm ci && npx goodfellow content copy .. && npx goodfellow build\` and the output directory \`site/dist\``,
    );

    const gitlab = await plan("cloudflare-pages", "content", "gitlab");
    const content = parse(text(gitlab, "content-repository/.gitlab-ci.yml"));
    expect(Object.keys(content)).toEqual(["rebuild"]);
    expect(content.rebuild.rules).toEqual([
      { if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_PIPELINE_SOURCE == "schedule"' },
    ]);
    const code = parse(text(gitlab, ".gitlab-ci.yml"));
    expect(Object.keys(code)).toEqual(["update", "rebuild"]);
    expect(code.rebuild.script.at(-1)).toBe(
      'curl --fail --silent --show-error --request POST "$CLOUDFLARE_DEPLOY_HOOK"',
    );
    expect(contentBuildsFor("cloudflare-pages")).toEqual(["content"]);
    expect(separateSetupLinks({ git: "gitlab", host: "cloudflare-pages", build: "content" })).toEqual({
      reads: [{ reader: "code", read: "content" }],
      nightly: ["code"],
      updates: "code",
    });
  });

  it("needs both repositories and a host", async () => {
    await expect(
      planSite({
        template: template(),
        name: "x",
        versions: { "@goodfellow-cms/core": "1.0.0" },
        content: { repo: "parish/site-content", build: "content" },
      }),
    ).rejects.toThrow("needs both repositories and a host");
  });
});

describe("separateSetupFiles", () => {
  const next: SeparateSetup = {
    git: "gitlab",
    host: "gitlab-pages",
    build: "content",
    code: "parish/web/site",
    content: "parish/web/site-content",
    next: true,
  };

  it("builds Next.js sites with their build script, into out/", () => {
    const { content, code } = separateSetupFiles(next);
    const pages = parse(content.get(".gitlab-ci.yml") ?? "").pages;
    expect(pages.script).toContain("npx goodfellow-next content copy ..");
    expect(pages.script).toContain("npm run build");
    expect(pages.pages.publish).toBe("site/out");
    expect(parse(code.get(".gitlab-ci.yml") ?? "").update.script).toContain("npx goodfellow-next content copy");
  });

  it("gives Next.js sites on Vercel settings of their own", async () => {
    const { code, content } = separateSetupFiles({ ...next, git: "github", host: "vercel", build: "code" });
    expect(await vercelConfig(code.get("vercel.ts") ?? "")).toMatchObject({ framework: "nextjs" });
    expect([...content.keys()]).toEqual([".github/workflows/rebuild.yml"]);
    const gitlab = separateSetupFiles({ ...next, host: "vercel", build: "content" });
    expect(await vercelConfig(gitlab.content.get("vercel.ts") ?? "")).toMatchObject({
      installCommand: `git clone --depth 1 "https://\${GOODFELLOW_CODE_TOKEN:+oauth2:$GOODFELLOW_CODE_TOKEN@}gitlab.com/parish/web/site.git" site && cd site && npm ci && npx goodfellow-next content copy ..`,
      outputDirectory: "site/out",
    });
    expect(parse(gitlab.code.get(".gitlab-ci.yml") ?? "").rebuild.rules).toEqual([
      { if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH" },
    ]);
  });

  it("builds Pages only from the content repository", () => {
    expect(contentBuildsFor("github-pages")).toEqual(["content"]);
    expect(contentBuildsFor("vercel")).toEqual(["code", "content"]);
    expect(() => separateSetupFiles({ ...next, build: "code" })).toThrow("only build the site from the content");
  });

  it("says what connects the repositories, as their setup files describe it", () => {
    const github = separateSetupLinks({ git: "github", host: "github-pages", build: "content" });
    expect(github).toEqual({
      reads: [
        { reader: "content", read: "code", secret: "GOODFELLOW_CODE_KEY" },
        { reader: "code", read: "content", secret: "GOODFELLOW_CONTENT_KEY" },
      ],
      nightly: [],
      updates: "code",
    });
    // Each secret is one the setup files use.
    const files = separateSetupFiles({ ...next, git: "github", host: "github-pages" });
    expect(files.content.get(".github/workflows/deploy.yml")).toContain("secrets.GOODFELLOW_CODE_KEY");
    expect(files.code.get(".github/workflows/update.yml")).toContain("secrets.GOODFELLOW_CONTENT_KEY");

    expect(separateSetupLinks({ git: "gitlab", host: "gitlab-pages", build: "content" })).toEqual({
      reads: [
        { reader: "content", read: "code" },
        { reader: "code", read: "content" },
      ],
      nightly: ["code"],
      updates: "code",
    });
    expect(separateSetupLinks({ git: "gitlab", host: "vercel", build: "code" })).toEqual({
      reads: [],
      nightly: ["content"],
    });
    expect(separateSetupLinks({ git: "github", host: "vercel", build: "content" })).toEqual({ reads: [], nightly: [] });
  });
});
