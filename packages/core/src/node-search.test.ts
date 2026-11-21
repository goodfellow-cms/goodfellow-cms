import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  builtPagePath,
  marksSearchContent,
  readSearchEngine,
  searchPageText,
  writePagesSearchIndex,
  writeSearchIndex,
} from "./node-search.js";

const page = (body: string, main = true, lang = "en") =>
  `<!DOCTYPE html><html lang="${lang}"><head><title>Page</title></head><body><header>Site name</header>${
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

describe("pages left out of search", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /** The page counts of the index in `indexDir`. */
  const pageCount = async (indexDir: string) => {
    const entry = JSON.parse(await readFile(join(indexDir, "pagefind-entry.json"), "utf8"));
    return Object.values(entry.languages).reduce<number>(
      (total, language) => total + (language as { page_count: number }).page_count,
      0,
    );
  };

  it("index pages whose file names hold characters globs read as patterns", async () => {
    await writeFile(join(dir, "index.html"), page('<h1>Home</h1><div data-goodfellow-search=""></div>'));
    await writeFile(join(dir, "notes[1].html"), page("<h1>Notes</h1>"));
    await writeFile(join(dir, "plans{a,b}.html"), page("<h1>Plans</h1>"));
    expect(await writeSearchIndex(dir)).toBe(3);
  }, 60_000);

  it("stay out when every page is, rather than the whole site going in, header and all", async () => {
    // Pagefind indexes every page whole when no page marks content to index.
    await mkdir(join(dir, "staff"));
    await writeFile(join(dir, "index.html"), page('<h1>Home</h1><div data-goodfellow-search=""></div>', false));
    await writeFile(join(dir, "staff/index.html"), page("<h1>Staff</h1><p>Door code 4321.</p>", false));
    await writeFile(join(dir, "404.html"), page("<h1>Page not found</h1>", false));
    expect(await writeSearchIndex(dir)).toBe(0);
    expect(await pageCount(join(dir, "pagefind"))).toBe(0);

    const indexDir = join(dir, "public/pagefind");
    const pages = [
      { url: "/", html: page('<h1>Home</h1><div data-goodfellow-search=""></div>', false) },
      { url: "/staff/", html: page("<h1>Staff</h1><p>Door code 4321.</p>", false) },
    ];
    expect(await writePagesSearchIndex(pages, indexDir)).toBe(0);
  }, 60_000);

  it("are told apart by the attribute on an element, never by its name in a page's text", () => {
    expect(marksSearchContent('<main class="gf-main" data-pagefind-body="">Hi</main>')).toBe(true);
    expect(marksSearchContent("<main data-pagefind-body>Hi</main>")).toBe(true);
    expect(marksSearchContent("<main><p>Mark it with <code>data-pagefind-body</code>.</p></main>")).toBe(false);
    expect(marksSearchContent("<main><code>&lt;main data-pagefind-body&gt;</code></main>")).toBe(false);
    expect(marksSearchContent('<main data-pagefind-body-extra="">Hi</main>')).toBe(false);
    // Nor in a comment or a script, which aren't elements.
    expect(marksSearchContent("<!-- <main data-pagefind-body> --><main>Staff notes</main>")).toBe(false);
    expect(marksSearchContent('<script>const m = "<main data-pagefind-body>";</script><main>Hi</main>')).toBe(false);
    expect(marksSearchContent('<!-- old --><main id="x" data-pagefind-body>Hi</main>')).toBe(true);
  });
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

describe("MiniSearch's index", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  /** A built site with a Search block, a page in Spanish, "Page not found", and a content API. */
  const site = async () => {
    await mkdir(join(dir, "about"));
    await mkdir(join(dir, "es"));
    await mkdir(join(dir, "api"));
    await writeFile(join(dir, "index.html"), page('<h1>Home</h1><div data-goodfellow-search=""></div>'));
    await writeFile(join(dir, "about/index.html"), page("<h1>About us</h1><p>We grow apples.</p>"));
    await writeFile(join(dir, "es/index.html"), page("<h1>Inicio</h1><p>Cultivamos manzanas.</p>", true, "es"));
    await writeFile(join(dir, "404.html"), page("<h1>Page not found</h1>", false));
    const file = { file: "x.json", hash: "0" };
    const languages = {
      en: { site: file, collections: file, header: file, footer: file },
      es: { site: file, collections: file, header: file, footer: file },
    };
    await writeFile(join(dir, "api/manifest.json"), JSON.stringify({ version: 1, languages, pages: [] }));
  };
  const read = async (path: string) => JSON.parse(await readFile(join(dir, path), "utf8"));

  it("is written for the website, in each language, named by hash, with no Pagefind", async () => {
    await site();
    expect(await writeSearchIndex(dir, { engine: "minisearch" })).toBe(3);
    expect(existsSync(join(dir, "pagefind"))).toBe(false);
    const files = readdirSync(join(dir, "minisearch/assets")).sort();
    expect(files).toEqual([
      expect.stringMatching(/^en\.[0-9a-f]{16}\.json$/),
      expect.stringMatching(/^es\.[0-9a-f]{16}\.json$/),
      expect.stringMatching(/^search\.[0-9a-f]{16}\.js$/),
    ]);
    const english = await read(`minisearch/assets/${files[0]}`);
    expect(english).toEqual({
      version: 1,
      language: "en",
      documents: [
        { path: "/", title: "Home", text: "Home" },
        { path: "/about/", title: "About us", text: "About us We grow apples." },
      ],
    });
    // The module the Search box loads names them, and isn't named by its hash itself.
    const module = await readFile(join(dir, "minisearch/minisearch.js"), "utf8");
    expect(module).toContain(`"./assets/${files[2]}"`);
    expect(module).toContain(`"en":"assets/${files[0]}"`);
    // The apps' copy, in the content API, with the manifest naming it.
    const manifest = await read("api/manifest.json");
    expect(manifest.languages.es.search.file).toBe(`search/${files[1]}`);
    expect(await read(`api/${manifest.languages.es.search.file}`)).toEqual(await read(`minisearch/assets/${files[1]}`));
  }, 60_000);

  it("is written only for apps beside Pagefind's with both, and not at all with Pagefind alone", async () => {
    await site();
    expect(await writeSearchIndex(dir, { engine: "both" })).toBe(3);
    expect(existsSync(join(dir, "pagefind/pagefind.js"))).toBe(true);
    expect(existsSync(join(dir, "minisearch"))).toBe(false);
    expect((await read("api/manifest.json")).languages.en.search.file).toMatch(/^search\/en\.[0-9a-f]{16}\.json$/);

    await writeFile(join(dir, "api/manifest.json"), JSON.stringify({ version: 1, languages: {}, pages: [] }));
    await writeSearchIndex(dir);
    expect(existsSync(join(dir, "api/search"))).toBe(false);
    expect(existsSync(join(dir, "minisearch"))).toBe(false);
  }, 60_000);

  it("names a file again only when its text changes", async () => {
    await site();
    await writeSearchIndex(dir, { engine: "minisearch" });
    const before = readdirSync(join(dir, "minisearch/assets")).sort();
    await writeSearchIndex(dir, { engine: "minisearch" });
    expect(readdirSync(join(dir, "minisearch/assets")).sort()).toEqual(before);
    await writeFile(join(dir, "about/index.html"), page("<h1>About us</h1><p>We grow pears.</p>"));
    await writeSearchIndex(dir, { engine: "minisearch" });
    const after = readdirSync(join(dir, "minisearch/assets")).sort();
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it("goes beside the folder given for a server's pages", async () => {
    const indexDir = join(dir, "public/pagefind");
    const pages = [
      { url: "/", html: page('<h1>Home</h1><div data-goodfellow-search=""></div>') },
      { url: "/about", html: page("<h1>About us</h1>") },
    ];
    expect(await writePagesSearchIndex(pages, indexDir, { engine: "minisearch" })).toBe(2);
    expect(existsSync(indexDir)).toBe(false);
    expect(existsSync(join(dir, "public/minisearch/minisearch.js"))).toBe(true);
  });
});

describe("searchPageText", () => {
  it("reads what's marked for search as Pagefind does, without what's left out of it", () => {
    const html =
      '<html lang="es"><head><title>Tab | Site</title><style>p{}</style></head><body><header>Menu</header>' +
      '<main data-pagefind-body=""><h1>Hola <em>mundo</em></h1><p>Uno&amp;dos</p><p>tres</p>' +
      '<script type="application/ld+json">{"a":1}</script><template><p>later</p></template>' +
      '<div data-pagefind-ignore=""><p>Photo: Ann</p></div><h1>Second</h1><a>About</a><a>Contact</a> <b>x</b>y</main>' +
      "<footer>Footer</footer></body></html>";
    expect(searchPageText(html, "/es/")).toEqual({
      language: "es",
      document: { path: "/es/", title: "Hola mundo", text: "Hola mundo Uno&dos tres Second About Contact xy" },
    });
  });

  it("takes the page's title where what's marked has no heading, and nothing where nothing is marked", () => {
    expect(
      searchPageText(
        "<html><head><title>Tab</title></head><body><main data-pagefind-body>Text</main></body></html>",
        "/a",
      )?.document.title,
    ).toBe("Tab");
    expect(searchPageText("<html><body><main>Text</main></body></html>", "/a")).toBeUndefined();
  });

  it("gives built pages their addresses from their files", () => {
    expect(builtPagePath("index.html")).toBe("/");
    expect(builtPagePath("about/index.html")).toBe("/about/");
    expect(builtPagePath("about.html")).toBe("/about");
  });
});

describe("readSearchEngine", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("reads the site's setting, and Pagefind where it says none or something else", async () => {
    expect(await readSearchEngine(dir)).toBe("pagefind");
    await mkdir(join(dir, "content"));
    await writeFile(join(dir, "content/site.json"), JSON.stringify({ search: { engine: "both" } }));
    expect(await readSearchEngine(dir)).toBe("both");
    await writeFile(join(dir, "content/site.json"), JSON.stringify({ search: { engine: "lunr" } }));
    expect(await readSearchEngine(dir)).toBe("pagefind");
  });
});

describe("the website's MiniSearch module", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-search-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it("answers as Pagefind's does, from the page's language's index", async () => {
    await mkdir(join(dir, "about"));
    await mkdir(join(dir, "es"));
    await writeFile(join(dir, "index.html"), page('<h1>Home</h1><div data-goodfellow-search=""></div>'));
    await writeFile(join(dir, "about/index.html"), page("<h1>About us</h1><p>We grow apples &amp; <b>pears</b>.</p>"));
    await writeFile(join(dir, "es/index.html"), page("<h1>Inicio</h1><p>Cultivamos manzanas.</p>", true, "es"));
    await writeSearchIndex(dir, { engine: "minisearch" });
    // The browser's fetch, reading the built files, and the page's <html lang>.
    const lang = { lang: "en" };
    vi.stubGlobal("document", { documentElement: lang });
    vi.stubGlobal("fetch", async (address: string) => {
      const text = await readFile(new URL(address), "utf8").catch(() => undefined);
      return { ok: text !== undefined, json: async () => JSON.parse(text ?? "null") };
    });
    const search = await import(pathToFileURL(join(dir, "minisearch/minisearch.js")).href);
    await search.options({ baseUrl: "/" });
    const { results } = await search.debouncedSearch("pears");
    expect(await Promise.all(results.map((result: { data(): Promise<unknown> }) => result.data()))).toEqual([
      { url: "/about/", meta: { title: "About us" }, excerpt: "About us We grow apples &amp; <mark>pears</mark>." },
    ]);
    lang.lang = "es";
    await search.destroy();
    expect((await search.debouncedSearch("manzanas")).results).toHaveLength(1);
    lang.lang = "fr";
    await expect(search.debouncedSearch("pears")).rejects.toThrow();
  });
});
