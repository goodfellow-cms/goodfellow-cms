import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startsWithGuard } from "./admin-domain.js";
import { guardBuiltSite, writeSiteHeaders } from "./node-admin-domain.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "goodfellow-guard-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(path: string, text: string) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), text);
}
const read = (path: string) => readFile(join(dir, path), "utf8");
const options = { admin: { url: "https://admin.example.org" }, siteUrl: "https://example.org/" };

describe("guardBuiltSite", () => {
  it("guards every page a browser opens, and gives the admin panel its own", async () => {
    await write("index.html", "<!DOCTYPE html><html><head><title>Home</title></head></html>");
    await write("404.html", "<!DOCTYPE html><html><head><title>Not found</title></head></html>");
    await write("media/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    await write("sitemap.xml", '<?xml version="1.0"?><urlset></urlset>');
    await write("assets/site.js", "console.log('site');");
    await write("admin/index.html", '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /></head></html>');
    const editor =
      '<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="x" /></head></html>';
    await write("admin/editor/index.html", editor);
    await write("_headers", "/*\n  X-Frame-Options: DENY\n");

    expect(await guardBuiltSite(dir, options)).toBe(5);
    for (const [path, kind] of [
      ["index.html", "html"],
      ["404.html", "html"],
      ["media/logo.svg", "svg"],
      ["sitemap.xml", "xml"],
      ["admin/index.html", "html"],
    ] as const) {
      expect(startsWithGuard(await read(path), kind), path).toBe(true);
    }
    expect(await read("index.html")).toContain('location.origin!=="https://admin.example.org"');
    expect(await read("index.html")).toContain('location.replace("https://example.org"+location.pathname');
    expect(await read("admin/index.html")).toContain("framed=window.top!==window");
    expect(await read("admin/editor/index.html")).toBe(editor);
    expect(await read("assets/site.js")).toBe("console.log('site');");
    const headers = await read("_headers");
    expect(headers.startsWith("/*\n  X-Frame-Options: DENY\n\nhttps://admin.example.org/*\n")).toBe(true);

    // Running again changes nothing.
    await guardBuiltSite(dir, options);
    expect(await read("_headers")).toBe(headers);
  });

  it("on Netlify, guards the pages but writes no rules for the admin address, which Netlify can't match", async () => {
    await write("index.html", "<!DOCTYPE html><html><head><title>Home</title></head></html>");
    await writeSiteHeaders(dir, { host: "netlify" });
    const site = await read("_headers");
    expect(site).toContain(
      "/admin/editor/*\n  Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    expect(site).not.toMatch(/^\s*!/m);
    expect(await guardBuiltSite(dir, { ...options, host: "netlify" })).toBe(1);
    expect(startsWithGuard(await read("index.html"), "html")).toBe(true);
    expect(await read("_headers")).toBe(site);
  });

  it("refuses a site with a page that can't start with its guard", async () => {
    await write("index.html", "<html><head></head></html>");
    await write("widget.html", '<html onload="steal()"><head></head></html>');
    await write("media/old.svgz", "\u001f\u008b\u0008 compressed");
    await expect(guardBuiltSite(dir, options)).rejects.toThrow(
      /widget\.html, media\/old\.svgz|media\/old\.svgz, widget\.html/,
    );
  });

  it("refuses an admin address that's the site's own", async () => {
    await expect(guardBuiltSite(dir, { ...options, admin: { url: "https://example.org" } })).rejects.toThrow(
      /is the Site address/,
    );
  });
});
