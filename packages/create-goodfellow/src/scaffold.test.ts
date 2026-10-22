import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commitAll,
  configureBackend,
  copyTemplate,
  hostsFor,
  initGitRepository,
  packageName,
  parseRepo,
  remoteUrl,
  ScaffoldError,
  scaffold,
  sitePackageJson,
} from "./scaffold.js";

const repo = resolve(import.meta.dirname, "../../..");
const starter = join(repo, "templates/starter");
const parish = join(repo, "examples/parish");
const next = join(repo, "templates/next");

const versions = {
  "@goodfellow-cms/admin": "1.2.3",
  "@goodfellow-cms/blocks": "1.2.3",
  "@goodfellow-cms/core": "1.2.3",
  "@goodfellow-cms/github": "1.2.3",
  "@goodfellow-cms/gitlab": "1.2.3",
  "@goodfellow-cms/react": "1.2.3",
  goodfellow: "1.2.3",
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "create-goodfellow-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("scaffold", () => {
  it("copies the starter, with published versions instead of workspace links", async () => {
    const target = join(dir, "My Site");
    await scaffold({ template: starter, target, versions });

    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg.name).toBe("my-site");
    expect(pkg.dependencies["@goodfellow-cms/core"]).toBe("^1.2.3");
    expect(pkg.dependencies["@puckeditor/core"]).toBe("0.23.0");
    expect(pkg.devDependencies.goodfellow).toBe("^1.2.3");
    expect(JSON.stringify(pkg)).not.toContain("workspace:");

    expect(existsSync(join(target, "content/pages/index.json"))).toBe(true);
    expect(existsSync(join(target, "public/media/logo.svg"))).toBe(true);
    expect(existsSync(join(target, ".gitignore"))).toBe(true);
    // The README's note about working in the Goodfellow repository doesn't apply to a site of its own.
    const readme = await readFile(join(target, "README.md"), "utf8");
    expect(await readFile(join(starter, "README.md"), "utf8")).toContain("goodfellow-repository");
    expect(readme).not.toContain("goodfellow-repository");
    expect(readme).not.toContain("pnpm");
    expect(readme).toContain("## Working on the site\n\n```sh\nnpm install");
    // Every host's setup is kept until one is chosen.
    expect(existsSync(join(target, ".github/workflows/deploy.yml"))).toBe(true);
    expect(existsSync(join(target, ".gitlab-ci.yml"))).toBe(true);
    expect(existsSync(join(target, "vercel.ts"))).toBe(true);
    // Installed packages and build output stay behind.
    expect(existsSync(join(target, "node_modules"))).toBe(false);
    expect(existsSync(join(target, "dist"))).toBe(false);
  });

  it("starts with the recommended blocks when asked, installed as the admin panel would", async () => {
    const target = join(dir, "site");
    await scaffold({ template: starter, target, versions, registryDir: join(repo, "packages/registry/r") });
    const record = JSON.parse(await readFile(join(target, "blocks/installed/installed.json"), "utf8"));
    expect(Object.keys(record.blocks).sort()).toEqual([
      "shadcn-call-to-action",
      "shadcn-cards",
      "shadcn-faq",
      "shadcn-hero",
      "shadcn-notice",
      "shadcn-tabs",
      "shadcn-testimonials",
    ]);
    expect(record.blocks["shadcn-faq"].source).toBe("@goodfellow/shadcn-faq");
    expect(existsSync(join(target, "components/ui/accordion.tsx"))).toBe(true);
    expect(await readFile(join(target, "blocks/installed/index.ts"), "utf8")).toContain('"shadcn-hero"');

    // Without it, only the built-in blocks.
    const plain = join(dir, "plain");
    await scaffold({ template: starter, target: plain, versions });
    expect(existsSync(join(plain, "blocks/installed/installed.json"))).toBe(false);
    expect(existsSync(join(plain, "components"))).toBe(false);
  });

  it("copies the parish example, with its own blocks", async () => {
    const target = join(dir, "parish");
    await scaffold({ template: parish, target, versions });
    expect(existsSync(join(target, "blocks/mass-times.tsx"))).toBe(true);
    expect(existsSync(join(target, "content/collections/events/_collection.json"))).toBe(true);
    expect(await readFile(join(target, "goodfellow.config.tsx"), "utf8")).toContain("MassTimes");
  });

  it("copies the Next.js starter without its build output", async () => {
    const target = join(dir, "next-site");
    await scaffold({
      template: next,
      target,
      versions: { ...versions, "@goodfellow-cms/next": "1.2.3" },
      host: "vercel",
    });
    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
    expect(pkg.dependencies["@goodfellow-cms/next"]).toBe("^1.2.3");
    expect(existsSync(join(target, "app/(site)/[[...path]]/page.tsx"))).toBe(true);
    expect(existsSync(join(target, "next.config.ts"))).toBe(true);
    for (const skipped of ["out", ".next", "next-env.d.ts", "turbo.json"]) {
      expect(existsSync(join(target, skipped)), skipped).toBe(false);
    }
    expect(existsSync(join(target, ".gitlab-ci.yml"))).toBe(false);
  });

  it("sets up the chosen backend and keeps only the chosen host's setup", async () => {
    const target = join(dir, "site");
    await scaffold({
      template: starter,
      target,
      versions,
      backend: { host: "gitlab", repo: "parish/site" },
      host: "gitlab-pages",
    });
    const config = await readFile(join(target, "goodfellow.config.tsx"), "utf8");
    expect(config).toContain('\nimport { gitlab } from "@goodfellow-cms/gitlab";');
    expect(config).toContain('  backend: gitlab({ project: "parish/site" }),');
    expect(config).toContain('// backend: github({ repo: "your-name/your-site" }),');
    expect(existsSync(join(target, ".gitlab-ci.yml"))).toBe(true);
    expect(existsSync(join(target, "vercel.ts"))).toBe(false);
    expect(existsSync(join(target, ".github"))).toBe(false);
  });

  it("keeps the content in a repository of its own, which the code ignores and links to", async () => {
    const target = join(dir, "site");
    await scaffold({
      template: starter,
      target,
      versions,
      backend: { host: "github", repo: "parish/site" },
      host: "github-pages",
      content: { repo: "parish/site-content", build: "content" },
    });
    expect(await readFile(join(target, "goodfellow.config.tsx"), "utf8")).toContain(
      '  backend: github({ repo: "parish/site-content", contentOnly: true, code: "parish/site" }),',
    );
    // The content is the content repository's, through links, as `npm run dev` reads it.
    expect((await lstat(join(target, "content"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(target, "content/site.json"), "utf8")).toBe(
      await readFile(join(target, "content-repository/content/site.json"), "utf8"),
    );
    expect(existsSync(join(target, "public/media/logo.svg"))).toBe(true);
    expect(existsSync(join(target, "content-repository/.github/workflows/deploy.yml"))).toBe(true);
    expect(existsSync(join(target, "content-repository/.github/workflows/scheduled.yml"))).toBe(true);
    expect(existsSync(join(target, ".github/workflows/update.yml"))).toBe(true);
    expect(existsSync(join(target, ".github/workflows/deploy.yml"))).toBe(false);
    expect(existsSync(join(target, ".github/workflows/scheduled.yml"))).toBe(false);

    for (const [name, value] of Object.entries({
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.org",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.org",
    })) {
      vi.stubEnv(name, value);
    }
    try {
      // The content repository first, then the code's, which leaves it and the links out.
      const content = join(target, "content-repository");
      expect(initGitRepository(content, { host: "github", repo: "parish/site-content" })).toMatchObject({
        created: true,
      });
      expect(commitAll(content, "Create the site's content")).toBe("committed");
      expect(initGitRepository(target, { host: "github", repo: "parish/site" })).toMatchObject({ created: true });
      expect(commitAll(target, "Create the site")).toBe("committed");
      const files = (cwd: string) => execFileSync("git", ["ls-files"], { cwd, encoding: "utf8" }).trim().split("\n");
      const code = files(target);
      expect(code).toContain("goodfellow.config.tsx");
      expect(code.filter((path) => /^(content|public\/media|content-repository)(\/|$)/.test(path))).toEqual([]);
      expect(files(content)).toContain("content/site.json");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("won't write into a folder that already has files", async () => {
    const target = join(dir, "taken");
    await mkdir(target);
    await writeFile(join(target, "notes.txt"), "mine");
    await expect(scaffold({ template: starter, target, versions })).rejects.toThrow(ScaffoldError);
    expect(await readFile(join(target, "notes.txt"), "utf8")).toBe("mine");
  });

  it("refuses a template that links to a package it has no version for", async () => {
    await expect(scaffold({ template: starter, target: join(dir, "site"), versions: {} })).rejects.toThrow(
      "No version of @goodfellow-cms/admin",
    );
  });
});

describe("initGitRepository", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  it("makes the site a repository on main, with origin set to the site's repository", () => {
    expect(initGitRepository(dir, { host: "github", repo: "your-name/your-site" })).toEqual({
      created: true,
      remote: "https://github.com/your-name/your-site.git",
    });
    expect(git(dir, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(git(dir, "remote", "get-url", "origin")).toBe("https://github.com/your-name/your-site.git");
    // Nothing is committed yet: that waits for npm install's package-lock.json.
    expect(() => git(dir, "rev-parse", "--verify", "-q", "HEAD")).toThrow();
  });

  it("leaves out origin when the site's repository isn't known", () => {
    expect(initGitRepository(dir)).toEqual({ created: true });
    expect(git(dir, "remote")).toBe("");
  });

  it("leaves a folder inside another repository as it is", async () => {
    git(dir, "init", "-q");
    const site = join(dir, "sites/new");
    await mkdir(site, { recursive: true });
    expect(initGitRepository(site)).toEqual({ created: false, reason: "inside-repository" });
    expect(existsSync(join(site, ".git"))).toBe(false);
  });

  it("commits everything but what .gitignore leaves out", async () => {
    for (const [name, value] of Object.entries({
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.org",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.org",
    })) {
      vi.stubEnv(name, value);
    }
    try {
      initGitRepository(dir);
      await writeFile(join(dir, ".gitignore"), "node_modules\n");
      await writeFile(join(dir, "package-lock.json"), "{}\n");
      await mkdir(join(dir, "node_modules/react"), { recursive: true });
      await writeFile(join(dir, "node_modules/react/index.js"), "");
      expect(commitAll(dir, "Create the site")).toBe("committed");
      expect(git(dir, "log", "--format=%s")).toBe("Create the site");
      expect(git(dir, "ls-files").split("\n")).toEqual([".gitignore", "package-lock.json"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("knows where GitLab projects are pushed to, subgroups included", () => {
    expect(remoteUrl({ host: "gitlab", repo: "parish/web/site" })).toBe("https://gitlab.com/parish/web/site.git");
  });
});

describe("copyTemplate", () => {
  it("renames .gitignore files for publishing, and back again", async () => {
    await copyTemplate(starter, join(dir, "bundled"), { bundling: true });
    expect(existsSync(join(dir, "bundled/.gitignore"))).toBe(false);
    expect(existsSync(join(dir, "bundled/_gitignore"))).toBe(true);
    await copyTemplate(join(dir, "bundled"), join(dir, "site"));
    expect(await readFile(join(dir, "site/.gitignore"), "utf8")).toBe(
      await readFile(join(starter, ".gitignore"), "utf8"),
    );
  });
});

describe("helpers", () => {
  it("makes package names from folder names", () => {
    expect(packageName("/home/me/St. Joseph Parish")).toBe("st.-joseph-parish");
    expect(packageName("sites/my_site")).toBe("my_site");
    expect(packageName("/tmp/---")).toBe("my-site");
  });

  it("reads repositories typed as names or addresses", () => {
    expect(parseRepo("github", "your-name/your-site")).toBe("your-name/your-site");
    expect(parseRepo("github", "https://github.com/your-name/your-site.git")).toBe("your-name/your-site");
    expect(parseRepo("github", "a/b/c")).toBeUndefined();
    expect(parseRepo("gitlab", "https://gitlab.com/group/sub/site/")).toBe("group/sub/site");
    expect(parseRepo("gitlab", "site")).toBeUndefined();
  });

  it("only offers hosts that can build the site's repository", () => {
    expect(hostsFor("github")).toEqual(["github-pages", "cloudflare-pages", "vercel"]);
    expect(hostsFor("gitlab")).toEqual(["gitlab-pages", "cloudflare-pages", "vercel"]);
    expect(hostsFor(undefined)).toHaveLength(4);
  });

  it("writes repository names safely into the config", () => {
    const config = '// import { github } from "@goodfellow-cms/github";\n  // backend: github({ repo: "x/y" }),\n';
    expect(configureBackend(config, { host: "github", repo: 'a/b"c' })).toBe(
      'import { github } from "@goodfellow-cms/github";\n  backend: github({ repo: "a/b\\"c" }),\n',
    );
    expect(() => configureBackend("export default {};", { host: "github", repo: "a/b" })).toThrow();
  });

  it("keeps the order of package.json's keys", () => {
    const source = '{"name":"x","private":true,"dependencies":{"goodfellow":"workspace:*"}}';
    expect(sitePackageJson(source, "site", { goodfellow: "2.0.0" })).toBe(
      '{\n  "name": "site",\n  "private": true,\n  "dependencies": {\n    "goodfellow": "^2.0.0"\n  }\n}\n',
    );
  });
});
