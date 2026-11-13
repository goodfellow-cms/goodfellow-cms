import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudflareSiteHeaders, editorPolicy, startsWithGuard } from "@goodfellow-cms/core";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockPageRender,
  checkPages,
  exportedPages,
  fixSegmentFiles,
  guardExport,
  nextDistDir,
  renderedPages,
  writeEditorFrames,
  writeExportHeaders,
  writeFeedFiles,
  writeImageFiles,
  writePluginFiles,
  writeRedirectFiles,
} from "./export.js";
import { DIST_DIR_RECORD, IMAGE_SIZES_MARK } from "./image-sizes-mark.js";

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
        'export default (options: { title: string }) => ({ items: async () => [{ slug: "welder", fields: { title: options.title, posted: "2026-11-01" } }] });\n',
      );
      expect(await writeFeedFiles(out, site)).toBe(2);
      expect(await readFile(join(out, "feeds/jobs.rss"), "utf8")).toContain("https://example.org/jobs/welder/");
      // The item's exported page is checked, as the source's.
      const pages = [{ url: "/jobs/welder/", html: '<main class="gf-main"><img src="/media/x.jpg"></main>' }];
      expect((await checkPages(pages, site)).map((problem) => [problem.kind, problem.file])).toContainEqual([
        "no-alt",
        "source:jobs/welder",
      ]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
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
