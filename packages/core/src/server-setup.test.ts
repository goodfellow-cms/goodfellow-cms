import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { planServerSite, SITE_VITEST_CONFIG, TEMPLATE_WORKER, workerName } from "./server-setup.js";
import { type SiteFiles, siteFileText } from "./site-setup.js";

const company = join(import.meta.dirname, "../../../examples/company");

/** The company example's files, as create-goodfellow's bundled copy has them, leaving out what's built or installed. */
function companyFiles(): SiteFiles {
  const files: SiteFiles = new Map();
  for (const entry of readdirSync(company, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(company, join(entry.parentPath, entry.name)).split(sep);
    if (path.some((part) => ["node_modules", ".turbo", ".next", "dist", ".wrangler"].includes(part))) continue;
    files.set(path.join("/"), new Uint8Array(readFileSync(join(company, ...path))));
  }
  return files;
}

const versions = new Proxy({} as Record<string, string>, { get: () => "1.2.3" });

describe("planServerSite", () => {
  it("names the company example's Worker, database, KV namespace, and repositories for the new site", () => {
    const files = planServerSite({
      template: companyFiles(),
      name: "Acme Works",
      versions,
      code: "acme/site",
      content: "acme/site-content",
      siteUrl: "https://www.acme.example",
    });
    const text = (path: string) => siteFileText(files.get(path) ?? "");
    const wrangler = text("wrangler.jsonc");
    expect(wrangler).toContain('"name": "acme-works"');
    expect(wrangler).toContain('"database_name": "acme-works"');
    expect(wrangler).toContain("kv namespace create acme-works-cache");
    expect(wrangler).toContain('"GOODFELLOW_SITE_URL": "https://www.acme.example"');
    expect(text("goodfellow.config.tsx")).toContain('github({ repo: "acme/site-content", contentOnly: true })');
    const deploy = text(".github/workflows/deploy.yml");
    expect(deploy).toContain("repository: acme/site-content");
    expect(deploy).toContain("d1 migrations apply acme-works --remote");
    const pkg = JSON.parse(text("package.json"));
    expect(pkg.name).toBe("acme-works");
    expect(pkg.scripts.deploy).toContain("apply acme-works --remote");
    expect(pkg.dependencies["@goodfellow-cms/core"]).toBe("^1.2.3");
    // The README's steps still say where the placeholders were, and its first section what's there now.
    const readme = text("README.md");
    expect(readme).toContain("in place of `your-name/your-site-content`");
    expect(readme).toContain("**acme/site-content**");
    // Nothing of the example's own names is left, but where the README says what was put in their place.
    for (const [path, file] of files) {
      if (path === "README.md" || typeof file !== "string") continue;
      expect(file, path).not.toContain(TEMPLATE_WORKER);
      expect(file, path).not.toMatch(/your-name\/your-site/);
    }
  });

  it("keeps the content in a repository of its own, which asks the code's to build after each publish", () => {
    const files = planServerSite({ template: companyFiles(), name: "acme", versions, code: "acme/site" });
    const paths = [...files.keys()];
    expect(paths.filter((path) => path.startsWith("content/") || path.startsWith("public/media/"))).toEqual([]);
    expect(files.has("content-repository/content/site.json")).toBe(true);
    expect(siteFileText(files.get("content-repository/.github/workflows/deploy-site.yml") ?? "")).toContain(
      "gh workflow run deploy.yml --repo acme/site",
    );
    expect(siteFileText(files.get(".gitignore") ?? "")).toContain("/content-repository/");
    const readme = siteFileText(files.get("README.md") ?? "");
    expect(readme).toContain("**acme/site**");
    // The content's repository isn't known yet, so its placeholder stays where people fill it in.
    expect(readme).toContain("**your-name/your-site-content**");
    expect(readme).not.toContain("goodfellow-repository");
    // Content and media are copied as they are, bytes and all.
    const media = paths.find((path) => path.startsWith("content-repository/public/media/"));
    if (media) expect(files.get(media)).toBeInstanceOf(Uint8Array);
  });

  it("gives the files npm leaves out of packages their own names back, keeping what they say", () => {
    const template = companyFiles();
    // As create-goodfellow's bundled copy has them.
    for (const [own, bundled] of [
      [".gitignore", "_gitignore"],
      [".npmrc", "_npmrc"],
    ]) {
      template.set(bundled as string, template.get(own as string) as Uint8Array);
      template.delete(own as string);
    }
    const files = planServerSite({ template, name: "acme", versions });
    expect(files.has("_gitignore")).toBe(false);
    expect(files.has("_npmrc")).toBe(false);
    const gitignore = siteFileText(files.get(".gitignore") ?? "");
    // The secrets a developer's copy holds stay out of its repository, and the content's folder too.
    expect(gitignore).toContain(".dev.vars*");
    expect(gitignore).toContain("node_modules/");
    expect(gitignore).toContain("/content-repository/");
    expect(siteFileText(files.get(".npmrc") ?? "")).toContain("ignore-scripts=true");
  });

  it("leaves nothing that reaches outside the site, as the example's test settings do into the workspace", () => {
    const files = planServerSite({ template: companyFiles(), name: "acme", versions });
    for (const [path, file] of files) {
      if (typeof file !== "string" || !/\.(ts|tsx|mjs|js|json|jsonc)$/.test(path)) continue;
      // The links content/ and public/media/ make go into content-repository/, which is the site's own.
      expect(file, path).not.toMatch(/["'](\.\.\/){2,}/);
    }
    expect(files.get("vitest.config.ts")).toBe(SITE_VITEST_CONFIG);
  });

  it("gives names Cloudflare takes", () => {
    expect(workerName("My Site")).toBe("my-site");
    expect(workerName("site.example_org")).toBe("site-example-org");
    expect(workerName("---")).toBe("my-site");
    expect(workerName("a".repeat(80))).toHaveLength(63);
  });
});
