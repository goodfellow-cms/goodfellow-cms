import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

// Built by Turborepo before these tests run: see turbo.json.
const next = resolve(import.meta.dirname, "../../../templates/next");
const starter = resolve(import.meta.dirname, "../../../templates/starter");
const read = (file: string) => readFile(join(next, "out", file), "utf8");

/** Attributes `next/image` adds to `<img>`, or sets where `<img>` leaves the default. */
const IMAGE_ONLY = new Set(["decoding", "data-nimg", "width", "height", "loading"]);

/** Attributes menus mark the current page with, which Next.js's shared layout sets in the browser instead. */
const CURRENT_PAGE = new Set(["data-current", "aria-current"]);

/**
 * The part of a page Goodfellow renders (header, page and footer), comparable
 * between renderers: attributes in order, without `next/image`'s extras, without
 * menus' marks for the current page, and without the trailing slash `next/link`
 * adds to page links (`trailingSlash`).
 */
function body(html: string): string {
  const match = /<header class="gf-header">[\s\S]*?<\/footer>/.exec(html);
  if (!match) throw new Error("No Goodfellow page in this HTML.");
  // The empty boundary Next.js renders after a layout's page, where it would show loading states.
  return match[0]
    .replaceAll("<!--$--><!--/$-->", "")
    .replace(/<([a-z]+)((?:\s[^\s=>]+(?:="[^"]*")?)*)\s*(\/?)>/g, (_tag, name: string, attributes: string) => {
      const list = [...attributes.matchAll(/\s([^\s=>]+)(?:="([^"]*)")?/g)]
        .map(([, key = "", value = ""]) => [key, value] as const)
        .filter(
          ([key, value]) =>
            !CURRENT_PAGE.has(key) &&
            !(name === "img" && (IMAGE_ONLY.has(key) || (key === "style" && value === "color:transparent"))),
        )
        .map(([key, value]) => [key, key === "href" && value.length > 1 ? value.replace(/\/$/, "") : value] as const)
        .sort(([a], [b]) => a.localeCompare(b));
      return `<${name}${list.map(([key, value]) => ` ${key}="${value}"`).join("")}>`;
    });
}

async function files(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();
}

describe("the Next.js template's static export", () => {
  it("has the starter's content, so it can be compared with the starter", async () => {
    for (const dir of ["content", "public"]) {
      const names = await files(join(starter, dir));
      expect(await files(join(next, dir))).toEqual(names);
      for (const name of names) {
        expect(await readFile(join(next, dir, name), "utf8"), name).toBe(
          await readFile(join(starter, dir, name), "utf8"),
        );
      }
    }
  });

  it("renders every page with the same HTML as goodfellow build, but for Next.js's links and images", async () => {
    const pages = ["index.html", "about/index.html", "news/index.html", "news/welcome/index.html", "404.html"];
    for (const file of pages) {
      const built = await readFile(join(starter, "dist", file), "utf8");
      expect(body(await read(file)), file).toBe(body(built));
    }
  });

  it("describes the site's blocks as goodfellow build does, for tools such as the Claude connector", async () => {
    const exported = JSON.parse(await read("goodfellow-site.json"));
    const built = JSON.parse(await readFile(join(starter, "dist", "goodfellow-site.json"), "utf8"));
    expect(exported).toEqual(built);
  });

  it("fills in entries' titles and the site's theme", async () => {
    const html = await read("news/welcome/index.html");
    expect(html).toContain("<title>Welcome to our new website | My site</title>");
    // The fonts' stand-ins come first, where the build could make them.
    expect(html).toMatch(
      /<style data-precedence="default" data-href="goodfellow-theme">(@font-face \{[^}]*\})*:root\{--background:/,
    );
    expect(await read("404.html")).toContain("<title>Page not found | My site</title>");
  });

  it("sends visitors only the code their pages run, not the editor", async () => {
    for (const file of ["index.html", "news/welcome/index.html"]) {
      const scripts = new Set((await read(file)).match(/\/_next\/static\/chunks\/[^"]+\.js/g));
      let size = 0;
      for (const script of scripts) {
        const code = await read(script.slice(1));
        // Puck, which comes with all of `@goodfellow-cms/react` when a Client Component imports one part of it.
        expect(code, script).not.toContain("createUsePuck");
        size += gzipSync(code).length;
      }
      // Next.js and React come to about 185 kB.
      expect(size, file).toBeLessThan(250_000);
    }
  });

  it("includes the admin panel, without the local backend used in development", async () => {
    expect(existsSync(join(next, "out/admin/index.html"))).toBe(true);
    for (const file of await files(join(next, "out"))) {
      if (!/\.(html|js|txt)$/.test(file)) continue;
      // The local backend's own words: the admin panel also sends its header to full-stack sites' servers.
      expect(await read(file), file).not.toContain("The development server's API isn't at");
    }
  });

  it("keeps the site's blocks out of the admin panel's page, in the editor's page with its own policy", async () => {
    const admin = await read("admin/index.html");
    const editor = await read("admin/editor/index.html");
    // A block's label, which only the site's config has.
    expect(editor).toContain("<head><meta http-equiv=\"Content-Security-Policy\"");
    expect(editor).toMatch(/script-src 'self' 'sha256-/);
    const scripts = (html: string) => [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1] ?? "");
    const editorOnly = scripts(editor).filter((script) => !scripts(admin).includes(script));
    expect(editorOnly.length).toBeGreaterThan(0);
    for (const script of scripts(admin)) {
      // Puck itself, which only the editor's frames load.
      expect(await read(script.slice(1)), script).not.toContain("createUsePuck");
    }
  });
});
