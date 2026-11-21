import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cloudflareAdminHeaders, cloudflareSiteHeaders, startsWithGuard } from "./admin-domain.js";
import { cachedFolders, checkFrameFolder, guardBuiltSite, writeSiteHeaders } from "./node-admin-domain.js";

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
      "/admin/editor/*\n  Content-Security-Policy: object-src 'none'; base-uri 'self'; sandbox allow-scripts; frame-ancestors 'self'",
    );
    expect(site).not.toMatch(/^\s*!/m);
    expect(await guardBuiltSite(dir, { ...options, host: "netlify" })).toBe(1);
    expect(startsWithGuard(await read("index.html"), "html")).toBe(true);
    expect(await read("_headers")).toBe(site);
  });

  it("keeps a build's assets a year only where every file there is named by its content", async () => {
    await write("assets/styles-B56g62wk.css", "body{}");
    await write("assets/islands-CHz1ci1F.js", "");
    expect(await cachedFolders(dir)).toEqual([
      "assets/",
      "_next/static/",
      "fonts/google/",
      "minisearch/assets/",
      "api/search/",
    ]);
    await writeSiteHeaders(dir, { host: "netlify" });
    expect(await read("_headers")).toContain(
      "/assets/*\n  Content-Security-Policy: object-src 'none'; base-uri 'self'\n  Cache-Control: public, max-age=31536000, immutable\n",
    );
    // A file the site keeps in public/assets/ keeps its name when it changes.
    await write("assets/logo.png", "png");
    expect(await cachedFolders(dir)).toEqual(["_next/static/", "fonts/google/", "minisearch/assets/", "api/search/"]);
    await rm(join(dir, "_headers"));
    await writeSiteHeaders(dir);
    const rules = await read("_headers");
    expect(rules).not.toMatch(/^\/assets\/\*/m);
    expect(rules).toContain("/fonts/google/*\n  Cache-Control: public, max-age=31536000, immutable\n");
  });

  it("refuses a site with a page that can't start with its guard", async () => {
    await write("index.html", "<html><head></head></html>");
    await write("widget.html", '<html onload="steal()"><head></head></html>');
    await write("media/old.svgz", "\u001f\u008b\u0008 compressed");
    await expect(guardBuiltSite(dir, options)).rejects.toThrow(
      /widget\.html, media\/old\.svgz|media\/old\.svgz, widget\.html/,
    );
  });

  it("guards XML that hosts type by other names, and refuses a file that starts as a page under another name", async () => {
    await write("index.html", "<html><head></head></html>");
    await write("schema.xsd", '<?xml version="1.0"?><schema xmlns="http://www.w3.org/2001/XMLSchema"></schema>');
    await write("robots.txt", "User-agent: *\nAllow: /\n");
    await write("assets/app.js", "<!-- an old comment -->\nconsole.log(1);");
    expect(await guardBuiltSite(dir, options)).toBe(2);
    expect(startsWithGuard(await read("schema.xsd"), "xml")).toBe(true);
    // GitLab Pages types a file it has no type for by its first bytes, so notes.txt would be a page there.
    for (const [path, text] of [
      ["media/notes.txt", "<html><script>steal()</script>"],
      ["media/notes.vtt", "\ufeff  <script>steal()</script>"],
      ["data", "<?xml version='1.0'?><x/>"],
      ["media/old.ico", "<!-- --><script>steal()</script>"],
    ] as const) {
      await write(path, text);
      await expect(guardBuiltSite(dir, options), path).rejects.toThrow(path);
      await rm(join(dir, path));
    }
    // Read many at a time, every one is still checked, and each named.
    const names = Array.from({ length: 150 }, (_, index) => `fonts/f${String(index).padStart(3, "0")}.woff`);
    for (const name of names) await write(name, "<html>");
    const refused = await guardBuiltSite(dir, options).catch((error: Error) => error.message);
    expect(
      String(refused)
        .match(/fonts\/f\d+\.woff/g)
        ?.sort(),
    ).toEqual(names);
  });

  it("refuses a page whose comment a browser ends before the guard", async () => {
    await write("index.html", "<html><head></head></html>");
    await write("early.html", "<!--><script>steal()</script>--><html><head></head></html>");
    await expect(guardBuiltSite(dir, options)).rejects.toThrow(/early\.html/);
  });

  it("refuses an admin address that's the site's own", async () => {
    await expect(guardBuiltSite(dir, { ...options, admin: { url: "https://example.org" } })).rejects.toThrow(
      /is the Site address/,
    );
  });
});

describe("the admin panel's frames' folders", () => {
  /** A frame's folder as a build writes it: its page, script, styles, licenses, a font, and a picture. */
  const frame = async (folder: string) => {
    await write(`${folder}index.html`, '<!DOCTYPE html><html><head><meta charset="utf-8" /></head></html>');
    await write(`${folder}plugin-Ab12Cd34.js`, "(function(){})();");
    await write(`${folder}plugin-Ab12Cd34.css`, "body{}");
    await write(`${folder}LICENSES.txt`, "MIT");
    await write(`${folder}inter-Ab12Cd34.woff2`, "wOF2");
    await write(`${folder}logo-Ab12Cd34.PNG`, "\u0089PNG");
  };

  it("take what a frame needs", async () => {
    await frame("admin/plugins/goodfellow-plugin-x/");
    await expect(checkFrameFolder(join(dir, "admin/plugins/goodfellow-plugin-x"))).resolves.toBeUndefined();
    await frame("admin/editor/");
    await write("index.html", "<!DOCTYPE html><html><head></head></html>");
    await expect(guardBuiltSite(dir, options)).resolves.toBe(1);
    // Its own pages stay as they were: they refuse to run outside the admin panel's frames.
    expect(await read("admin/editor/index.html")).not.toContain("<script");
  });

  it("stop the build at anything else, which could open as a page at the admin panel's address", async () => {
    const folder = "admin/plugins/goodfellow-plugin-x/";
    await frame(folder);
    for (const [name, text] of [
      ["help-Ab12Cd34.html", "<script>steal()</script>"],
      ["pic-Ab12Cd34.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>'],
      ["notes-Ab12Cd34", "plain"],
      ["data-Ab12Cd34.xml", "<?xml version='1.0'?><a/>"],
      ["script-Ab12Cd34.js", "<html><script>steal()</script>"],
      ["sub/index.html", "<script>steal()</script>"],
    ] as const) {
      await write(`${folder}${name}`, text);
      await expect(checkFrameFolder(join(dir, folder)), name).rejects.toThrow(name);
      await expect(guardBuiltSite(dir, options), name).rejects.toThrow(`${folder}${name}`);
      await rm(join(dir, folder, name));
    }
    await write("admin/editor/pic-Ab12Cd34.svg", "<svg/>");
    await expect(guardBuiltSite(dir, options)).rejects.toThrow("admin/editor/pic-Ab12Cd34.svg");
  });

  it("lose what an earlier build left, in a rebuild into the same folder, and keep a newer build's", async () => {
    const folder = "admin/plugins/goodfellow-plugin-x/";
    await frame(folder);
    // An earlier build's page an import brought, in a folder of its own, its script's source map, and a stray file.
    await write(`${folder}nested/help-Ab12Cd34.html`, "<script>steal()</script>");
    await write(`${folder}plugin-Ab12Cd34.js.map`, "{}");
    await write(`${folder}old-Ab12Cd34.js`, "(function(){})();");
    const since = Date.now();
    const earlier = new Date(since - 60_000);
    for (const name of ["nested/help-Ab12Cd34.html", "plugin-Ab12Cd34.js.map", "old-Ab12Cd34.js"]) {
      await utimes(join(dir, folder, name), earlier, earlier);
    }
    // A newer build's file, written while this one's check runs, which nothing may take out.
    await write(`${folder}plugin-Ef56Gh78.js`, "(function(){})();");
    const written = new Set(["plugin-Ab12Cd34.js", "plugin-Ab12Cd34.css", "LICENSES.txt", "inter-Ab12Cd34.woff2"]);
    written.add("logo-Ab12Cd34.PNG");
    await expect(checkFrameFolder(join(dir, folder), { stale: { written, since } })).resolves.toBeUndefined();
    expect((await readdir(join(dir, folder))).sort()).toEqual([
      "LICENSES.txt",
      "index.html",
      "inter-Ab12Cd34.woff2",
      "logo-Ab12Cd34.PNG",
      "plugin-Ab12Cd34.css",
      "plugin-Ab12Cd34.js",
      "plugin-Ef56Gh78.js",
    ]);
    // Without a build to compare with, as in a build that doesn't rebuild, nothing is taken out.
    await write(`${folder}help-Ab12Cd34.html`, "<script>steal()</script>");
    await utimes(join(dir, folder, "help-Ab12Cd34.html"), earlier, earlier);
    await expect(checkFrameFolder(join(dir, folder))).rejects.toThrow("help-Ab12Cd34.html");
  });

  it("are sandboxed on hosts that take headers, as the admin panel frames them", () => {
    expect(cloudflareSiteHeaders("/")).toContain(
      "/admin/plugins/*\n  ! Content-Security-Policy\n  ! Cross-Origin-Opener-Policy\n  ! Origin-Agent-Cluster\n  Content-Security-Policy: sandbox allow-scripts; frame-ancestors 'self'",
    );
    expect(cloudflareAdminHeaders({ url: "https://admin.example.org" })).toContain(
      "https://admin.example.org/admin/editor/*\n  ! Content-Security-Policy\n  Content-Security-Policy: sandbox allow-scripts;",
    );
  });
});

describe("files in UTF-16", () => {
  it("stop the build where they start as a page does, though their names don't say so", async () => {
    const page =
      '<?xml version="1.0" encoding="UTF-16"?><x xmlns:h="http://www.w3.org/1999/xhtml"><h:script>steal()</h:script></x>';
    const units = ["﻿", ...page].map((char) => char.charCodeAt(0));
    await write("index.html", "<!DOCTYPE html><html><head></head></html>");
    await mkdir(join(dir, "media"), { recursive: true });
    await writeFile(join(dir, "media/a.gml"), new Uint8Array(units.flatMap((unit) => [unit & 255, unit >> 8])));
    await expect(guardBuiltSite(dir, options)).rejects.toThrow("media/a.gml");
  });
});
