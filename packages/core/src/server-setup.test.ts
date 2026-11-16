import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  newSetupCode,
  planServerSite,
  SETUP_CODE_LENGTH,
  SITE_VITEST_CONFIG,
  setupCodeHash,
  TEMPLATE_WORKER,
  workerName,
} from "./server-setup.js";
import { type SiteFiles, siteFileText } from "./site-setup.js";

const company = join(import.meta.dirname, "../../../examples/company");

/** The company example's files, as create-goodfellow's bundled copy has them, leaving out what's built or installed. */
function companyFiles(): SiteFiles {
  const files: SiteFiles = new Map();
  // Folder by folder, never into those left out: other tests write and remove folders in node_modules meanwhile.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (LEFT_OUT.includes(entry.name)) continue;
      const at = join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (entry.isFile()) files.set(relative(company, at).split(sep).join("/"), new Uint8Array(readFileSync(at)));
    }
  };
  walk(company);
  return files;
}

/** What the bundled copy leaves out, being built or installed. */
const LEFT_OUT = ["node_modules", ".turbo", ".next", "dist", ".wrangler"];

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

  it("puts in each repository's name once, even where one is spelled like a placeholder", () => {
    const files = planServerSite({
      template: companyFiles(),
      name: "acme",
      versions,
      code: "acme/site",
      content: "your-name/your-site",
    });
    const text = (path: string) => siteFileText(files.get(path) ?? "");
    expect(text("goodfellow.config.tsx")).toContain('github({ repo: "your-name/your-site", contentOnly: true })');
    expect(text(".github/workflows/deploy.yml")).toContain("repository: your-name/your-site\n");
  });

  it("keeps the content in a repository of its own, which runs no workflows", () => {
    const files = planServerSite({ template: companyFiles(), name: "acme", versions, code: "acme/site" });
    const paths = [...files.keys()];
    expect(paths.filter((path) => path.startsWith("content/") || path.startsWith("public/media/"))).toEqual([]);
    expect(files.has("content-repository/content/site.json")).toBe(true);
    // Whoever can change the content can't start the code's workflows: the code's Deploy runs each night instead.
    expect(paths.filter((path) => path.startsWith("content-repository/.github/"))).toEqual([]);
    expect(siteFileText(files.get("content-repository/README.md") ?? "")).toContain("runs each night");
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

  it("puts a setup code's hash in wrangler.jsonc's vars, which stays valid JSON once its comments are gone", async () => {
    const hash = await setupCodeHash("abcd-efgh");
    const files = planServerSite({
      template: companyFiles(),
      name: "acme",
      versions,
      siteUrl: "https://www.acme.example",
      setupCodeHash: hash,
      madeBy: "page",
    });
    const wrangler = siteFileText(files.get("wrangler.jsonc") ?? "");
    const vars = /"vars"\s*:\s*(\{[^}]*\})/.exec(wrangler)?.[1] ?? "";
    expect(JSON.parse(vars)).toEqual({
      GOODFELLOW_SETUP_CODE_HASH: hash,
      GOODFELLOW_SITE_URL: "https://www.acme.example",
    });
    // The README says the setup page made it, which created the repositories on GitHub itself.
    const readme = siteFileText(files.get("README.md") ?? "");
    expect(readme).toContain("Goodfellow's setup page made this site");
    expect(readme).not.toContain("Push each to GitHub");
    expect(() => planServerSite({ template: companyFiles(), name: "acme", versions, setupCodeHash: "ABC" })).toThrow(
      "64 lowercase hexadecimal digits",
    );
    // Without one, wrangler.jsonc has no hash, and the README names create-goodfellow.
    const plain = planServerSite({ template: companyFiles(), name: "acme", versions });
    expect(siteFileText(plain.get("wrangler.jsonc") ?? "")).not.toContain("SETUP_CODE");
    expect(siteFileText(plain.get("README.md") ?? "")).toContain("`create-goodfellow` made this site");
  });

  it("makes setup codes of 120 random bits, whose hash doesn't mind spaces, dashes, or case", async () => {
    const code = newSetupCode();
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/);
    expect(code.replaceAll("-", "")).toHaveLength(SETUP_CODE_LENGTH);
    expect(newSetupCode()).not.toBe(code);
    const hash = await setupCodeHash(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await setupCodeHash(` ${code.toLowerCase().replaceAll("-", " ")} `)).toBe(hash);
    // The digits a code never has, typed for the letters they look like.
    expect(await setupCodeHash("C0DE-11B8")).toBe(await setupCodeHash("CODE-IIBB"));
    expect(await setupCodeHash(code.replace(/^./, (first) => (first === "A" ? "B" : "A")))).not.toBe(hash);
    // SHA-256 of "ABCDEFGH", as any other tool gives it.
    expect(await setupCodeHash("abcd-efgh")).toBe("9ac2197d9258257b1ae8463e4214e4cd0a578bc1517f2415928b91be4283fc48");
  });

  it("gives names Cloudflare takes", () => {
    expect(workerName("My Site")).toBe("my-site");
    expect(workerName("site.example_org")).toBe("site-example-org");
    expect(workerName("---")).toBe("my-site");
    expect(workerName("a".repeat(80))).toHaveLength(63);
  });
});
