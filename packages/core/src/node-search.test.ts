import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writePagesSearchIndex, writeSearchIndex } from "./node-search.js";

const page = (body: string, main = true) =>
  `<!DOCTYPE html><html lang="en"><head><title>Page</title></head><body><header>Site name</header>${
    main ? `<main data-pagefind-body="">${body}</main>` : `<main>${body}</main>`
  }</body></html>`;

describe("writeSearchIndex", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("indexes nothing when no page has a search block", async () => {
    await writeFile(join(dir, "index.html"), page("<h1>Home</h1>"));
    expect(await writeSearchIndex(dir)).toBeUndefined();
    expect(existsSync(join(dir, "pagefind"))).toBe(false);
  });

  it("indexes pages' main content when one has a search block, leaving out pages without it", async () => {
    await mkdir(join(dir, "about"));
    await mkdir(join(dir, "admin"));
    await writeFile(join(dir, "index.html"), page('<h1>Home</h1><div data-goodfellow-search=""></div>'));
    await writeFile(join(dir, "about/index.html"), page("<h1>About us</h1><p>We grow apples.</p>"));
    await writeFile(join(dir, "404.html"), page("<h1>Page not found</h1>", false));
    await writeFile(join(dir, "admin/index.html"), "<html><body>Admin</body></html>");

    expect(await writeSearchIndex(dir)).toBe(2);
    expect(existsSync(join(dir, "pagefind/pagefind.js"))).toBe(true);
    const entry = JSON.parse(await readFile(join(dir, "pagefind/pagefind-entry.json"), "utf8"));
    expect(Object.values(entry.languages).map((language) => (language as { page_count: number }).page_count)).toEqual([
      2,
    ]);
  }, 60_000);
});

describe("writePagesSearchIndex", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("indexes pages at the addresses given, into the folder given, replacing an older index", async () => {
    const indexDir = join(dir, "public/pagefind");
    await mkdir(indexDir, { recursive: true });
    await writeFile(join(indexDir, "stale.pf_fragment"), "old");
    const pages = [
      { url: "/", html: page('<h1>Home</h1><div data-goodfellow-search=""></div>') },
      { url: "/about/", html: page("<h1>About us</h1><p>We grow apples.</p>") },
      { url: "/404/", html: page("<h1>Page not found</h1>", false) },
    ];
    expect(await writePagesSearchIndex(pages, indexDir)).toBe(2);
    expect(existsSync(join(indexDir, "pagefind.js"))).toBe(true);
    expect(existsSync(join(indexDir, "stale.pf_fragment"))).toBe(false);
  }, 60_000);

  it("indexes nothing, and leaves no index, when no page has a search block", async () => {
    const indexDir = join(dir, "pagefind");
    await mkdir(indexDir);
    expect(await writePagesSearchIndex([{ url: "/", html: page("<h1>Home</h1>") }], indexDir)).toBeUndefined();
    expect(existsSync(indexDir)).toBe(false);
  });
});
