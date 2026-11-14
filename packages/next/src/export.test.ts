import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflareSiteHeaders, editorPolicy, startsWithGuard } from "@goodfellow-cms/core";
import { builtSiteSource } from "@goodfellow-cms/core/node";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blockPageRender,
  buildFileFolders,
  checkPages,
  dueSite,
  exportedPages,
  fixSegmentFiles,
  guardExport,
  nextDistDir,
  renderedPages,
  writeBuildRecordFile,
  writeEditorFrames,
  writeExportHeaders,
  writeFeedFiles,
  writeImageFiles,
  writePluginFiles,
  writeRedirectFiles,
} from "./export.js";
import { DIST_DIR_RECORD, IMAGE_SIZES_MARK } from "./image-sizes-mark.js";
import { loadKeptSiteModule, loadSiteModule, readCollectionSources } from "./plugins.js";

let out: string;
afterEach(() => rm(out, { recursive: true, force: true }));

async function write(path: string, content = "x") {
  await mkdir(join(out, path, ".."), { recursive: true });
  await writeFile(join(out, path), content);
}

describe("fixSegmentFiles", () => {
  it("moves the folders Next.js writes on Windows to the files the browser asks for", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write("news/open-house/__next.$oc$path/__PAGE__.txt", "page");
    await write("news/open-house/__next.!KHNpdGUp/$oc$path/__PAGE__.txt", "grouped");
    await write("news/open-house/__next._tree.txt");
    await write("news/open-house/index.html");
    await write("_next/static/chunks/a.js");

    expect(await fixSegmentFiles(out)).toBe(2);
    expect((await readdir(join(out, "news/open-house"))).sort()).toEqual([
      "__next.!KHNpdGUp.$oc$path.__PAGE__.txt",
      "__next.$oc$path.__PAGE__.txt",
      "__next._tree.txt",
      "index.html",
    ]);
    expect(await readFile(join(out, "news/open-house/__next.$oc$path.__PAGE__.txt"), "utf8")).toBe("page");
    expect(existsSync(join(out, "_next/static/chunks/a.js"))).toBe(true);
  });

  it("leaves an export made elsewhere as it is", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write("about/__next.$oc$path.__PAGE__.txt");
    expect(await fixSegmentFiles(out)).toBe(0);
    expect(await readdir(join(out, "about"))).toEqual(["__next.$oc$path.__PAGE__.txt"]);
  });
});

describe("writeRedirectFiles", () => {
  it("writes a page at each old address the export has no page at, with the export's base path", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write(
      "site/content/site.json",
      '{ "version": 1, "title": "St. Joseph", "url": "https://example.org/site" }\n',
    );
    await write("site/content/pages/about.json", '{ "version": 1, "data": { "root": {}, "content": [] } }\n');
    await write(
      "site/content/redirects.json",
      JSON.stringify({
        version: 1,
        redirects: [
          { from: "/about-us", to: "/about" },
          { from: "/about", to: "/elsewhere" },
          { from: "/events/2026-10", to: "/events" },
        ],
      }),
    );
    await write("site/.next/routes-manifest.json", '{ "basePath": "/site" }');
    // A page a block added, which the content's own pages don't list.
    await write("out/events/2026-10.html", "month");

    expect(await writeRedirectFiles(join(out, "out"), join(out, "site"))).toEqual({ pages: 1, cloudflareLeft: 0 });
    const html = await readFile(join(out, "out/about-us/index.html"), "utf8");
    expect(html).toContain('content="0; url=/site/about/"');
    expect(html).toContain('href="https://example.org/site/about/"');
    expect(existsSync(join(out, "out/about/index.html"))).toBe(false);
    expect(await readFile(join(out, "out/events/2026-10.html"), "utf8")).toBe("month");
    // Cloudflare Pages sends the same redirects itself, leaving out the addresses the export has pages at.
    expect(await readFile(join(out, "out/_redirects"), "utf8")).toBe(
      "/site/about-us /site/about/ 301\n/site/about-us/ /site/about/ 301\n",
    );
  });
});

describe("checkPages", () => {
  it("checks the export's pages, putting problems down to the content they come from", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    const page = (main: string) =>
      `<!doctype html><html lang="en"><head><title>Parish</title></head><body><main class="gf-main">${main}</main></body></html>`;
    await write("content/site.json", JSON.stringify({ version: 1, title: "Parish" }));
    await write("content/pages/index.json", JSON.stringify({ version: 1, data: { root: { props: {} }, content: [] } }));
    await write("content/pages/news.json", JSON.stringify({ version: 1, data: { root: { props: {} }, content: [] } }));
    await write("out/index.html", page("<h1>Home</h1>"));
    await write("out/news.html", page("<h1>News</h1><h3>Lent</h3>"));
    // A list's second page, which the news page adds.
    await write("out/news/page/2.html", page('<h1>News</h1><img src="/media/lent.jpg">'));
    await write("out/admin/index.html", page("<h3>Admin</h3>"));
    await write("out/_not-found.html", page("<h3>Not found</h3>"));

    const pages = await exportedPages(join(out, "out"));
    expect(pages.map((built) => built.url).sort()).toEqual(["/", "/news", "/news/page/2"]);
    const problems = await checkPages(pages, out);
    expect(problems.map((problem) => [problem.kind, problem.file, "path" in problem && problem.path])).toEqual([
      ["skipped-heading", "content/pages/news.json", "/news"],
      ["no-alt", "content/pages/news.json", "/news/page/2"],
    ]);
  }, 30_000);
});

describe("writeImageFiles", () => {
  it("writes smaller copies of photos where next build listed them", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    const photo = await sharp({ create: { width: 1000, height: 500, channels: 3, background: "#336699" } })
      .jpeg()
      .toBuffer();
    await mkdir(join(out, "site/public/media"), { recursive: true });
    await writeFile(join(out, "site/public/media/hall.jpg"), photo);

    // Without the mark, pages don't list copies, so there are none.
    expect(await writeImageFiles(join(out, "out"), join(out, "site"))).toBeUndefined();
    expect(existsSync(join(out, "out/media-sizes"))).toBe(false);

    await write(`site/.next/${IMAGE_SIZES_MARK}`, "");
    expect(await writeImageFiles(join(out, "out"), join(out, "site"))).toEqual({ written: 2, failed: [] });
    const copy = await sharp(await readFile(join(out, "out/media-sizes/480/hall.jpg.webp"))).metadata();
    expect([copy.format, copy.width, copy.height]).toEqual(["webp", 480, 240]);
  });

  it("reads the mark where next build wrote, with a distDir of the site's own", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    const site = join(out, "site");
    expect(await nextDistDir(site)).toBe(join(site, ".next"));
    await write(`site/${DIST_DIR_RECORD}`, "build");
    expect(await nextDistDir(site)).toBe(join(site, "build"));
    await mkdir(join(site, "public/media"), { recursive: true });
    await write(`site/build/${IMAGE_SIZES_MARK}`, "");
    expect(await writeImageFiles(join(out, "out"), site)).toEqual({ written: 0, failed: [] });
  });
});

describe("guardExport", () => {
  it("starts every page of a site with an admin address with its guard, with the export's base path", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write(
      "site/content/site.json",
      '{ "version": 1, "title": "St. Joseph", "url": "https://example.org/site" }\n',
    );
    await write("site/.next/routes-manifest.json", JSON.stringify({ basePath: "/site" }));
    const description = { version: 1, goodfellow: "1.0.0", content: {}, root: { fields: {} }, blocks: {} };
    await write(
      "out/goodfellow-site.json",
      JSON.stringify({ ...description, admin: { url: "https://admin.example.org", checked: true } }),
    );
    await write("out/index.html", '<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/></head></html>');
    await write("out/admin/index.html", '<!DOCTYPE html><html lang="en"><head></head></html>');
    const editor = '<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="x"/></head></html>';
    await write("out/admin/editor.html", editor);

    expect(await guardExport(join(out, "out"), join(out, "site"))).toBe(2);
    expect(startsWithGuard(await readFile(join(out, "out/index.html"), "utf8"), "html")).toBe(true);
    expect(await readFile(join(out, "out/admin/index.html"), "utf8")).toContain(
      'location.origin!=="https://admin.example.org"',
    );
    expect(await readFile(join(out, "out/admin/editor.html"), "utf8")).toBe(editor);
    expect(await readFile(join(out, "out/_headers"), "utf8")).toContain("https://admin.example.org/site/admin/*");
  });

  it("adds Cloudflare Pages' header rules for every site after the site's own, once", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write("site/.next/routes-manifest.json", JSON.stringify({ basePath: "/site" }));
    await write("out/_headers", "/fonts/*\n  Cache-Control: max-age=31536000\n");
    await writeExportHeaders(join(out, "out"), join(out, "site"));
    await writeExportHeaders(join(out, "out"), join(out, "site"));
    expect(await readFile(join(out, "out/_headers"), "utf8")).toBe(
      `/fonts/*\n  Cache-Control: max-age=31536000\n\n${cloudflareSiteHeaders("/site/")}`,
    );
  });

  it("leaves an export without an admin address as it is", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await write("out/index.html", "<html><head></head></html>");
    expect(await guardExport(join(out, "out"), out)).toBeUndefined();
    expect(await readFile(join(out, "out/index.html"), "utf8")).toBe("<html><head></head></html>");
  });
});

describe("collections' sources in an export", () => {
  it("are read from the modules the config names, for the feeds and the checks' pages", async () => {
    // Inside the package, so the site's imports find its packages.
    const site = await mkdtemp(join(import.meta.dirname, "../.sources-site-"));
    let other: string | undefined;
    out = join(site, "out");
    try {
      const file = (path: string, value: unknown) =>
        mkdir(join(site, path, ".."), { recursive: true }).then(() =>
          writeFile(join(site, path), typeof value === "string" ? value : JSON.stringify(value)),
        );
      await file("package.json", '{ "name": "sources-site", "type": "module" }');
      await file("content/site.json", { version: 1, url: "https://example.org" });
      await file("content/collections/jobs/_collection.json", {
        version: 1,
        name: "Jobs",
        entryName: "Job",
        path: "/jobs/{slug}",
        fields: [
          { name: "title", label: "Title", type: "text" },
          { name: "posted", label: "Posted", type: "date" },
        ],
      });
      // A file left in the folder that loading would refuse, which the source's items replace.
      await file("content/collections/jobs/broken.json", { version: 1, fields: { title: 42 } });
      // Named by shorthand, which no look at the config's text for "collections:" would find.
      await file(
        "goodfellow.config.tsx",
        'import { defineConfig } from "@goodfellow-cms/core";\nconst collections = { jobs: { source: "./lib/jobs.ts", options: { title: "Welder" } } };\nexport default defineConfig({ blocks: {}, collections });\n',
      );
      await file(
        "lib/jobs.ts",
        'const reads = globalThis as { jobsReads?: number };\nexport default (options: { title: string }) => ({ items: async () => { reads.jobsReads = (reads.jobsReads ?? 0) + 1; return [{ slug: "welder", fields: { title: options.title, posted: "2026-11-01" } }, { slug: "later", fields: { title: "Later", posted: "2026-11-02" }, showFrom: "2031-03-04T05:06" }, { slug: "?", fields: { title: "Bad" } }]; } });\n',
      );
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(await writeFeedFiles(out, site)).toBe(2);
      expect(await readFile(join(out, "feeds/jobs.rss"), "utf8")).toContain("https://example.org/jobs/welder/");
      // The item's exported page is checked, as the source's.
      const pages = [{ url: "/jobs/welder/", html: '<main class="gf-main"><img src="/media/x.jpg"></main>' }];
      expect((await checkPages(pages, site)).map((problem) => [problem.kind, problem.file])).toContainEqual([
        "no-alt",
        "source:jobs/welder",
      ]);
      // Steps that read only the files leave out the item file the source replaces too.
      expect(await buildFileFolders(site)).toBeInstanceOf(Array);
      // The build record says the site changes when the source's scheduled item shows.
      await writeBuildRecordFile(out, site);
      expect(JSON.parse(await readFile(join(out, "goodfellow-build.json"), "utf8")).currentUntil).toContain(
        "2031-03-04",
      );
      // Every step showed the items of one read of the source, which may change while they're written, and its item
      // with a name that can't be used was warned about once.
      expect((globalThis as { jobsReads?: number }).jobsReads).toBe(1);
      expect(warn.mock.calls.filter(([text]) => String(text).startsWith("source:jobs/?"))).toHaveLength(1);
      // `next dev` reads the sources on every request, keeping each while its code is the same, so a source that opens
      // a database pool as it's made opens one.
      const first = await readCollectionSources(site);
      expect((await readCollectionSources(site)).jobs).toBe(first.jobs);
      await file(
        "lib/jobs.ts",
        'export default () => ({ items: async () => [{ slug: "welder", fields: { title: "Changed" } }] });\n',
      );
      const changed = await readCollectionSources(site);
      expect(changed.jobs).not.toBe(first.jobs);
      // Another site with the same code has its own, since its packages are its own.
      other = await mkdtemp(join(import.meta.dirname, "../.sources-site-"));
      await cp(site, other, { recursive: true });
      expect((await readCollectionSources(other)).jobs).not.toBe(changed.jobs);
      expect((await readCollectionSources(site)).jobs).toBe(changed.jobs);
      // \`goodfellow-next due\` reads the source's items, schedules and all, and leaves out the file they replace.
      const due = await dueSite(builtSiteSource(site), site);
      expect(due.collections.find((one) => one.id === "jobs")?.entries.map((entry) => entry.slug)).toContain("later");
      // A source it can't read leaves its items out, saying so, rather than fail every check.
      await writeFile(
        join(other, "lib/jobs.ts"),
        'export default () => ({ items: async () => { throw new Error("No database here."); } });\n',
      );
      const down = await dueSite(builtSiteSource(other), other);
      expect(down.collections.find((one) => one.id === "jobs")?.entries).toEqual([]);
      expect(warn.mock.calls.some(([text]) => String(text).includes("No database here."))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      await rm(site, { recursive: true, force: true });
      if (other) await rm(other, { recursive: true, force: true });
    }
  });
});

describe("loadSiteModule", () => {
  it("bundles a module not kept yet once for requests that arrive together", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-together-"));
    const entry = join(out, "source.mjs");
    await writeFile(entry, "export default {};\n");
    let bundles = 0;
    const counting: typeof loadSiteModule = (...args) => {
      bundles++;
      return loadSiteModule(...args);
    };
    const loaded = await Promise.all(Array.from({ length: 8 }, () => loadKeptSiteModule(out, entry, counting)));
    for (const module of loaded) expect(module).toBe(loaded[0]);
    expect(bundles).toBe(1);
  });

  it("loads modules started at once each as itself", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-modules-"));
    const count = 12;
    for (let index = 0; index < count; index++) {
      await writeFile(join(out, `module-${index}.mjs`), `export default ${index};\n`);
    }
    const loaded = await Promise.all(
      Array.from({ length: count }, (_, index) => loadSiteModule(out, join(out, `module-${index}.mjs`))),
    );
    expect(loaded.map((module) => module.default)).toEqual(Array.from({ length: count }, (_, index) => index));
  });

  it("keeps a module without bundling it again until a file bundled into it changes", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-kept-"));
    const entry = join(out, "source.mjs");
    const part = join(out, "part.mjs");
    const past = new Date(Date.now() - 60_000);
    await writeFile(entry, 'import part from "./part.mjs";\nexport default part;\n');
    await writeFile(part, "export default 1;\n");
    for (const path of [entry, part]) await utimes(path, past, past);
    const first = await loadKeptSiteModule(out, entry);
    expect(first.default).toBe(1);
    // A file whose text changed but whose time didn't isn't read again: nothing is bundled.
    await writeFile(part, "export default 2;\n");
    await utimes(part, past, past);
    expect(await loadKeptSiteModule(out, entry)).toBe(first);
    // Once it has changed, it's bundled again, and its new code is a new module.
    const later = new Date(past.getTime() + 1_000);
    await utimes(part, later, later);
    const second = await loadKeptSiteModule(out, entry);
    expect(second.default).toBe(2);
    // Changed back, it's a new module again: the one before isn't kept, so the source made from it can go.
    await writeFile(part, "export default 1;\n");
    const latest = new Date(past.getTime() + 2_000);
    await utimes(part, latest, latest);
    const third = await loadKeptSiteModule(out, entry);
    expect(third.default).toBe(1);
    expect(third).not.toBe(first);
    // A file whose time is ahead of the computer's clock, as on a mounted folder, is kept like any other.
    const ahead = new Date(Date.now() + 3_600_000);
    await utimes(part, ahead, ahead);
    const fourth = await loadKeptSiteModule(out, entry);
    await writeFile(part, "export default 3;\n");
    await utimes(part, ahead, ahead);
    expect(await loadKeptSiteModule(out, entry)).toBe(fourth);
    // And so is a new bundle of one.
    const further = new Date(Date.now() + 7_200_000);
    await utimes(part, further, further);
    const fifth = await loadKeptSiteModule(out, entry);
    expect(fifth.default).toBe(3);
    await writeFile(part, "export default 4;\n");
    await utimes(part, further, further);
    expect(await loadKeptSiteModule(out, entry)).toBe(fifth);
  });
});

describe("writePluginFiles", () => {
  it("builds plugins' admin frames and runs their build steps, from the site's config", async () => {
    // Inside the package, so the site's imports find its packages.
    const site = await mkdtemp(join(import.meta.dirname, "../.plugin-site-"));
    out = join(site, "out");
    try {
      await mkdir(join(site, "plugins/hello"), { recursive: true });
      await mkdir(out, { recursive: true });
      await writeFile(join(site, "package.json"), '{ "name": "plugin-site", "type": "module" }');
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        [
          'import { defineConfig, definePlugin } from "@goodfellow-cms/core";',
          "const hello = definePlugin({",
          '  name: "goodfellow-plugin-hello",',
          '  title: "Hello",',
          '  permissions: { connect: ["https://api.example.com"], write: ["hello/"] },',
          '  admin: "./plugins/hello/admin.ts",',
          '  build: [{ id: "greet", module: "./plugins/hello/build.mjs", title: "Say hello" }],',
          "});",
          "export default defineConfig({ blocks: {}, plugins: [hello] });",
          "",
        ].join("\n"),
      );
      await writeFile(join(site, "plugins/hello/admin.ts"), 'export default { services: { greet: () => "Hello" } };\n');
      await writeFile(
        join(site, "plugins/hello/build.mjs"),
        "import { writeFileSync } from 'node:fs';\nexport default (context) => writeFileSync(context.outDir + '/hello/done.txt', context.base);\n",
      );

      const written = await writePluginFiles("out", site);
      expect(written).toEqual({ frames: ["goodfellow-plugin-hello"], steps: ["goodfellow-plugin-hello: Say hello"] });
      const page = await readFile(join(out, "admin/plugins/goodfellow-plugin-hello/index.html"), "utf8");
      expect(page).toContain("connect-src https://api.example.com;");
      expect(page).toContain('<script src="plugin.js"></script>');
      // What it bundles, with where its source is, beside it: here, only the site's own package.
      expect(page).toContain('<link rel="license" href="LICENSES.txt" />');
      const notices = await readFile(join(out, "admin/plugins/goodfellow-plugin-hello/LICENSES.txt"), "utf8");
      expect(notices).toContain("- plugin-site: no license named, source at https://www.npmjs.com/package/plugin-site");
      const code = await readFile(join(out, "admin/plugins/goodfellow-plugin-hello/plugin.js"), "utf8");
      expect(code).toContain("self.origin");
      expect(await readFile(join(out, "hello/done.txt"), "utf8")).toBe("/");
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });

  it("leaves sites without plugins alone, without loading their config", async () => {
    out = await mkdtemp(join(tmpdir(), "goodfellow-export-"));
    await writeFile(join(out, "goodfellow.config.tsx"), "throw new Error('loaded');\n");
    expect(await writePluginFiles("out", out)).toEqual({ frames: [], steps: [] });
  });
});

describe("renderedPages", () => {
  it("renders every page from the site's content and config, with no .next/, as next.config.ts serves them", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../.rendered-site-"));
    out = join(site, "public");
    try {
      await mkdir(join(site, "content/pages"), { recursive: true });
      await writeFile(join(site, "package.json"), '{ "name": "rendered-site", "type": "module" }');
      await writeFile(join(site, "content/site.json"), '{ "version": 1, "title": "St. Joseph" }\n');
      const page = (title: string) =>
        `${JSON.stringify({ version: 1, data: { root: { props: { title } }, content: [] } }, null, 2)}\n`;
      await writeFile(join(site, "content/pages/index.json"), page("Welcome"));
      await writeFile(join(site, "content/pages/about.json"), page("About us"));
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        'import { defineConfig } from "@goodfellow-cms/core";\nexport default defineConfig({ blocks: {} });\n',
      );
      // How withGoodfellow() marks its config, read without calling it.
      await writeFile(
        join(site, "next.config.mjs"),
        'const config = async () => ({});\nconfig[Symbol.for("goodfellow.siteServing")] = { basePath: "", trailingSlash: false };\nexport default config;\n',
      );
      const pages = await renderedPages(site);
      expect(pages.map((rendered) => rendered.url).sort()).toEqual(["/", "/about"]);
      const about = pages.find((rendered) => rendered.url === "/about")?.html ?? "";
      expect(about).toContain('<html lang="en"');
      expect(about).toContain("<title>About us");
      expect(about).toContain("data-pagefind-body");
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("writeEditorFrames", () => {
  it("bundles the editor's frames from the site's code alone, with a page that runs no inline scripts", async () => {
    // Inside the package, so the site's imports find its packages.
    const site = await mkdtemp(join(import.meta.dirname, "../.editor-site-"));
    out = join(site, "public");
    try {
      await writeFile(join(site, "package.json"), '{ "name": "editor-site", "type": "module" }');
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        // A server's variable, which browser code built by Next.js reads as undefined, as the frames must.
        'import { defineConfig } from "@goodfellow-cms/core";\nexport default defineConfig({ blocks: {}, ...(process.env.SERVER_ONLY ? { demo: true } : {}) });\n',
      );
      // No .next/: it runs before `next build` as well as after it.
      const dir = await writeEditorFrames("public", site);
      expect(dir).toBe(join(out, "admin/editor/frames/"));
      expect((await readdir(dir)).sort()).toEqual(["editor.css", "editor.js", "index.html", "tailwind-browser.js"]);
      const page = await readFile(join(dir, "index.html"), "utf8");
      // Its policy, which the server sends as a header too, needs no hashes of anything Next.js renders.
      expect(page).toContain(`content="${editorPolicy()}"`);
      // Its one script is the bundle, named by its address: nothing inline.
      expect(page.match(/<script\b[^>]*>/gi)).toEqual(['<script src="editor.js">']);
      // The prelude first, which stops it anywhere but a sandboxed frame (minified, so it reads a little differently).
      const code = await readFile(join(dir, "editor.js"), "utf8");
      expect(code).toMatch(/^\(\(\)=>\{if\(self\.origin!==/);
      // Browsers have no process: nothing in the bundle reads its environment.
      expect(code).not.toContain("process.env");
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("blockPageRender", () => {
  it("renders a page with a block from its own file and the site's config's, as blocks add checks it", async () => {
    const site = await mkdtemp(join(import.meta.dirname, "../.block-site-"));
    out = join(site, "out");
    try {
      await mkdir(join(site, "blocks/installed/greeting"), { recursive: true });
      await mkdir(join(site, "content/pages"), { recursive: true });
      await writeFile(join(site, "package.json"), '{ "name": "block-site", "type": "module" }');
      await writeFile(join(site, "content/site.json"), '{ "version": 1, "title": "St. Joseph" }\n');
      await writeFile(
        join(site, "goodfellow.config.tsx"),
        'import { defineConfig } from "@goodfellow-cms/core";\nexport default defineConfig({ blocks: {} });\n',
      );
      await writeFile(
        join(site, "blocks/installed/greeting/block.tsx"),
        "export default { fields: {}, render: ({ name }: { name: string }) => <p>Hello, {name}</p> };\n",
      );
      const html = await blockPageRender(site)(
        { version: 1, data: { root: { props: {} }, content: [{ type: "greeting", props: { id: "g", name: "Ann" } }] } },
        { name: "greeting", entry: "blocks/installed/greeting/block.tsx" },
      );
      expect(html).toContain("<p>Hello, <!-- -->Ann</p>");
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });
});
