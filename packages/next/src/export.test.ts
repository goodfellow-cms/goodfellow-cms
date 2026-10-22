import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPages, exportedPages, fixSegmentFiles, writeRedirectFiles } from "./export.js";

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
    expect(html).toContain('content="0; url=/site/about"');
    expect(html).toContain('href="https://example.org/site/about"');
    expect(existsSync(join(out, "out/about/index.html"))).toBe(false);
    expect(await readFile(join(out, "out/events/2026-10.html"), "utf8")).toBe("month");
    // Cloudflare Pages sends the same redirects itself, leaving out the addresses the export has pages at.
    expect(await readFile(join(out, "out/_redirects"), "utf8")).toBe(
      "/site/about-us /site/about 301\n/site/about-us/ /site/about 301\n",
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
