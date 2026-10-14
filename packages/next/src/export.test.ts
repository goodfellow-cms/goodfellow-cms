import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixSegmentFiles, writeRedirectFiles } from "./export.js";

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

    expect(await writeRedirectFiles(join(out, "out"), join(out, "site"))).toBe(1);
    const html = await readFile(join(out, "out/about-us/index.html"), "utf8");
    expect(html).toContain('content="0; url=/site/about"');
    expect(html).toContain('href="https://example.org/site/about"');
    expect(existsSync(join(out, "out/about/index.html"))).toBe(false);
    expect(await readFile(join(out, "out/events/2026-10.html"), "utf8")).toBe("month");
  });
});
