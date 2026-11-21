import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Parser } from "htmlparser2";
import { type ApiManifest, CONTENT_API_DIR, CONTENT_API_MANIFEST } from "./content-api.js";
import {
  hashText,
  MINISEARCH_ASSETS_DIR,
  MINISEARCH_DIR,
  MINISEARCH_MODULE,
  miniSearchFor,
  SEARCH_ATTRIBUTE,
  SEARCH_ENGINE_ATTRIBUTE,
  SEARCH_ENGINES,
  SEARCH_INDEX_DIR,
  type SearchEngine,
  webSearchEngine,
} from "./index.js";
import { SEARCH_FILE_VERSION, type SearchDocument, type SearchFile } from "./site-search.js";

/**
 * Whether a page marks content to index (`data-pagefind-body`, on an element). Only such pages are given to Pagefind:
 * it leaves pages without the mark out only while some page has it, and with none indexes every page whole, headers,
 * footers, "Page not found", and pages left out of search included. The page is read as HTML, so the name in its text,
 * a comment, or a script never counts.
 */
export function marksSearchContent(html: string): boolean {
  let marked = false;
  const parser = new Parser({
    onopentag(_name, attributes) {
      if (!marked && Object.hasOwn(attributes, "data-pagefind-body")) {
        marked = true;
        parser.pause();
      }
    },
  });
  parser.end(html);
  return marked;
}

/**
 * Whether a page has a block that searches with Pagefind itself: an element marked `SEARCH_ATTRIBUTE` that neither
 * says nor holds an element saying it searches with MiniSearch (`SEARCH_ENGINE_ATTRIBUTE`, as the Search box does),
 * as another's block that loads `/pagefind/pagefind.js` would. Such a site keeps Pagefind's index whatever its setting,
 * so the block goes on working.
 */
export function searchesWithPagefind(html: string): boolean {
  let found = false;
  const open: Array<{ marked: boolean; mini: boolean }> = [];
  const parser = new Parser({
    onopentag(_name, attributes) {
      const mini = attributes[SEARCH_ENGINE_ATTRIBUTE] === "minisearch";
      if (mini) for (const element of open) element.mini = true;
      open.push({ marked: Object.hasOwn(attributes, SEARCH_ATTRIBUTE), mini });
    },
    onclosetag() {
      const element = open.pop();
      if (element?.marked && !element.mini) {
        found = true;
        parser.pause();
      }
    },
  });
  parser.end(html);
  return found;
}

/** `searchesWithPagefind()`, read only for pages whose text has `SEARCH_ATTRIBUTE` at all. */
function usesPagefind(html: string): boolean {
  return html.includes(SEARCH_ATTRIBUTE) && searchesWithPagefind(html);
}

/** A built page to index: its address on the site, and its HTML. */
export interface SearchPage {
  url: string;
  html: string;
}

/**
 * Writes the search index of a built site, if any of its pages has a search
 * block; other sites don't get one. Only pages that mark content to index are
 * in it (`marksSearchContent()`). `engine` (`content/site.json`'s
 * `search.engine`) says which: Pagefind's into `<outDir>/pagefind/`, MiniSearch's
 * for the website into `<outDir>/minisearch/`, MiniSearch's for apps into the
 * content API where the build wrote one (`writeMiniSearch()`), or both kinds.
 * Returns how many pages were indexed, or `undefined` if the site has no search.
 */
export async function writeSearchIndex(
  outDir: string,
  { engine = "pagefind" }: { engine?: SearchEngine } = {},
): Promise<number | undefined> {
  const files = (await readdir(outDir, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        file.endsWith(".html") &&
        !file.startsWith("admin/") &&
        !file.startsWith(`${SEARCH_INDEX_DIR}/`) &&
        !file.startsWith(`${MINISEARCH_DIR}/`),
    );
  const pages = await Promise.all(
    files.map(async (file) => ({
      url: builtPagePath(file),
      html: await readFile(join(outDir, file), "utf8"),
      // Pagefind is given each page by its path in the site, from which it works out its address as it would
      // indexing the folder; a glob of their names would read characters such as `[` and `{` in them as patterns.
      sourcePath: file,
    })),
  );
  return indexPages(outDir, join(outDir, SEARCH_INDEX_DIR), pages, engine);
}

/**
 * Writes the search index of `pages` into `indexDir`, such as a full-stack
 * Next.js site's prerendered pages into `public/pagefind/`, if any of them has
 * a search block. Only pages that mark content to index are in it
 * (`marksSearchContent()`). With `engine`, as `writeSearchIndex()`, MiniSearch's
 * files go beside `indexDir` (`public/minisearch/`, `public/api/`). Returns how
 * many pages were indexed, or `undefined` if the site has no search.
 */
export function writePagesSearchIndex(
  pages: SearchPage[],
  indexDir: string,
  { engine = "pagefind" }: { engine?: SearchEngine } = {},
): Promise<number | undefined> {
  return indexPages(dirname(indexDir), indexDir, pages, engine);
}

/**
 * What both of the above write, from the pages of the site in `outDir`, each
 * given to Pagefind by its `sourcePath` where it has one, else by its address.
 * Each page is read once, for MiniSearch's text where it's written, which says
 * whether it marks content too, and only pages with a search block again, for
 * a block that searches with Pagefind itself (`searchesWithPagefind()`).
 */
async function indexPages(
  outDir: string,
  indexDir: string,
  pages: Array<SearchPage & { sourcePath?: string }>,
  engine: SearchEngine,
): Promise<number | undefined> {
  // Nothing is left over from a build before, of either engine, whatever this one writes.
  await rm(indexDir, { recursive: true, force: true });
  await removeMiniSearch(outDir);
  if (!pages.some((page) => page.html.includes(SEARCH_ATTRIBUTE))) return undefined;
  const mini = miniSearchFor(engine);
  const withMini = mini.web || mini.apps;
  const marked = pages.flatMap((page) => {
    const text = withMini ? searchPageText(page.html, page.url) : undefined;
    return (withMini ? text : marksSearchContent(page.html)) ? [{ page, text }] : [];
  });
  let indexed: number | undefined;
  if (webSearchEngine(engine) === "pagefind" || pages.some((page) => usesPagefind(page.html))) {
    indexed = await indexWith(indexDir, async (index) => {
      const errors: string[] = [];
      for (const { page } of marked) {
        const added = await index.addHTMLFile(
          page.sourcePath === undefined
            ? { url: page.url, content: page.html }
            : { sourcePath: page.sourcePath, content: page.html },
        );
        errors.push(...added.errors);
      }
      return { errors };
    });
  }
  if (withMini) {
    // Written whatever Pagefind indexed, as the apps' index is with `both`; `??=` alone would skip the call.
    const documents = await writeMiniSearch(
      outDir,
      marked.flatMap(({ text }) => (text ? [text] : [])),
      mini,
    );
    indexed ??= documents;
  }
  return indexed;
}

/** A built page's address, from its file: `index.html` is `/`, `about/index.html` `/about/`, `about.html` `/about`. */
export function builtPagePath(file: string): string {
  if (file === "index.html") return "/";
  if (file.endsWith("/index.html")) return `/${file.slice(0, -"index.html".length)}`;
  return `/${file.replace(/\.html$/, "")}`;
}

/** Elements whose text isn't what the page says to its visitors. */
const NOT_TEXT = new Set(["script", "style", "template", "noscript", "svg", "math", "iframe", "object", "select"]);

/** Elements inside a run of text, which words go on across, where every other element ends a word. */
const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

/** A page's language, as its `<html lang>` says, and what search finds it by. */
export interface SearchPageText {
  language: string;
  document: SearchDocument;
}

/**
 * What MiniSearch's index has of a built page, read as Pagefind reads it: the
 * text of what's marked `data-pagefind-body`, leaving out what's marked
 * `data-pagefind-ignore` (photo credits, consent placeholders), scripts,
 * styles, and templates, and its title from the first `<h1>` in it, else the
 * page's own `<title>` (the first outside the body, never an SVG's). `undefined` for a page with nothing marked.
 */
export function searchPageText(html: string, path: string): SearchPageText | undefined {
  let language = "";
  let found = false;
  let text = "";
  let heading: string | undefined;
  let headingDone = false;
  let title = "";
  /** Whether the page's own `<title>` has been read, after which no other is. */
  let titleDone = false;
  /** Whether an element has just ended, with no text since. */
  let touching = false;
  const open: Array<{ name: string; body: boolean; ignore: boolean; heading: boolean }> = [];
  const inBody = () => open.some((element) => element.body);
  // Where words end, in the text and in the heading being read, so `<h1>Our<br>Parish</h1>` is two words in both.
  const space = () => {
    text += " ";
    if (heading !== undefined && !headingDone) heading += " ";
  };
  const ignored = () => open.some((element) => element.ignore);
  // The page's own `<title>`, never one in the body, such as an SVG's, which names a picture.
  const pageTitle = () =>
    open.at(-1)?.name === "title" && !open.some((element) => ["body", "svg", "math"].includes(element.name));
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "html" && attributes.lang) language = attributes.lang;
        const body = Object.hasOwn(attributes, "data-pagefind-body");
        if (body) found = true;
        // An `<h1>` left out of search, itself or by what holds it, is never the title.
        const firstHeading =
          name === "h1" &&
          heading === undefined &&
          (body || inBody()) &&
          !ignored() &&
          !Object.hasOwn(attributes, "data-pagefind-ignore");
        if (firstHeading) heading = "";
        open.push({
          name,
          body,
          ignore: NOT_TEXT.has(name) || Object.hasOwn(attributes, "data-pagefind-ignore"),
          heading: firstHeading,
        });
        // Words end where elements meet, as two links side by side do, though not where one starts after a word.
        if (!INLINE.has(name) || touching) space();
        touching = false;
      },
      ontext(chunk) {
        touching = false;
        if (!titleDone && pageTitle()) title += chunk;
        if (!inBody() || ignored()) return;
        text += chunk;
        if (heading !== undefined && !headingDone) heading += chunk;
      },
      onclosetag(name) {
        if (name === "title" && pageTitle()) titleDone = true;
        const element = open.pop();
        if (element?.heading) headingDone = true;
        if (!INLINE.has(name)) space();
        touching = true;
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  if (!found) return undefined;
  const squash = (value: string) => value.replace(/\s+/g, " ").trim();
  return {
    language,
    document: { path, title: squash(heading ?? "") || squash(title) || path, text: squash(text) },
  };
}

/** A language code a file can be named by, as `<html lang>` has the site's: `en`, `pt-BR`. */
const FILE_LANGUAGE = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/;

/** The folder the content API keeps each language's search index in, from its manifest's. */
const API_SEARCH_DIR = "search";

/**
 * Takes out MiniSearch's files of a build before, so none is left over from another index or engine, and the content
 * API manifest's names for them, so apps are never sent to a file that's gone.
 */
async function removeMiniSearch(outDir: string): Promise<void> {
  await rm(join(outDir, MINISEARCH_DIR), { recursive: true, force: true });
  await rm(join(outDir, CONTENT_API_DIR, API_SEARCH_DIR), { recursive: true, force: true });
  const manifestPath = join(outDir, CONTENT_API_MANIFEST.slice(1));
  const manifest = await readManifest(manifestPath);
  if (!manifest || !Object.values(manifest.languages).some((language) => language.search)) return;
  for (const language of Object.values(manifest.languages)) delete language.search;
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
}

/** The content API's manifest a build wrote, or `undefined` where it wrote none. */
function readManifest(path: string): Promise<ApiManifest | undefined> {
  return readFile(path, "utf8")
    .then((text) => JSON.parse(text) as ApiManifest)
    .catch(() => undefined);
}

/** The website's MiniSearch, bundled with core (`src/browser/minisearch-module.ts`). */
async function miniSearchModule(): Promise<string> {
  // Beside this file in the package; the tests run from `src/`, so they read the built one.
  for (const path of ["./browser/minisearch.js", "../dist/browser/minisearch.js"]) {
    const text = await readFile(new URL(path, import.meta.url), "utf8").catch(() => undefined);
    if (text !== undefined) return text;
  }
  throw new Error("Goodfellow's MiniSearch module is missing: build @goodfellow-cms/core again");
}

/** A file's name with its text's hash (`hashText()`): `en.3f2a9c01b4d7e6f0.json`. */
function hashedName(stem: string, extension: string, hash: string): string {
  return `${stem}.${hash.slice(0, 16)}.${extension}`;
}

/**
 * Writes MiniSearch's index of `pages` (as `searchPageText()` reads them), a `SearchFile` for
 * each language, every file named by its hash so hosts can send it with long
 * caching (`CACHED_FOLDERS`):
 *
 * - `apps`: `api/search/<code>.<hash>.json` for each language the content API
 *   has, which its manifest names as the language's `search`, where the build
 *   wrote a content API.
 * - `web`: `minisearch/assets/search.<hash>.js` (the website's MiniSearch), and
 *   `minisearch/minisearch.js`, which names it and each language's index, for
 *   the Search box to load as it loads Pagefind: the apps' file where there is
 *   one, so no index is written twice, else `minisearch/assets/<code>.<hash>.json`.
 *
 * Returns how many pages are in it. Its callers take out the files written before (`removeMiniSearch()`).
 */
async function writeMiniSearch(
  outDir: string,
  pages: SearchPageText[],
  { web, apps }: { web: boolean; apps: boolean },
): Promise<number> {
  const byLanguage = new Map<string, SearchDocument[]>();
  // A page whose `<html lang>` is missing or odd is still found, as Pagefind finds it, from pages saying the same.
  for (const found of pages) {
    const documents = byLanguage.get(found.language);
    if (documents) documents.push(found.document);
    else byLanguage.set(found.language, [found.document]);
  }
  const files = await Promise.all(
    [...byLanguage].map(async ([language, documents]) => {
      const file: SearchFile = {
        version: SEARCH_FILE_VERSION,
        language,
        documents: documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      };
      const text = `${JSON.stringify(file)}\n`;
      // Files are named by the language only where it's a code a file's name can hold.
      const stem = FILE_LANGUAGE.test(language) ? language : "pages";
      const hash = await hashText(text);
      return { language, text, hash, name: hashedName(stem, "json", hash), count: documents.length };
    }),
  );
  // The apps' copy first, so the website's module names it rather than a second file of the same text: each
  // language's index is in the content API where the build wrote one with that language, else in `assets/`.
  const shared = new Map<string, string>();
  if (apps) {
    const manifestPath = join(outDir, CONTENT_API_MANIFEST.slice(1));
    const manifest = await readManifest(manifestPath);
    if (manifest) {
      const folder = join(outDir, CONTENT_API_DIR, API_SEARCH_DIR);
      await mkdir(folder, { recursive: true });
      for (const file of files) {
        const language = manifest.languages[file.language];
        if (!language) continue;
        await writeFile(join(folder, file.name), file.text);
        language.search = { file: `${API_SEARCH_DIR}/${file.name}`, hash: file.hash };
        shared.set(file.language, `../${CONTENT_API_DIR}/${API_SEARCH_DIR}/${file.name}`);
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    }
  }
  if (web) {
    const assets = join(outDir, MINISEARCH_ASSETS_DIR);
    await mkdir(assets, { recursive: true });
    const assetsFolder = MINISEARCH_ASSETS_DIR.slice(MINISEARCH_DIR.length + 1);
    const named: Record<string, string> = {};
    for (const file of files) {
      const kept = shared.get(file.language);
      if (kept === undefined) await writeFile(join(assets, file.name), file.text);
      named[file.language] = kept ?? `${assetsFolder}/${file.name}`;
    }
    const module = await miniSearchModule();
    const moduleName = hashedName("search", "js", await hashText(module));
    await writeFile(join(assets, moduleName), module);
    await writeFile(
      join(outDir, MINISEARCH_MODULE),
      [
        "// Written by Goodfellow's build: the site's search, whose files are named by their content.",
        `import { pagefindLike } from "./${assetsFolder}/${moduleName}";`,
        `const search = pagefindLike(${JSON.stringify(named)}, import.meta.url, () => document.documentElement.lang || "");`,
        "export const options = search.options;",
        "export const destroy = search.destroy;",
        "export const debouncedSearch = search.debouncedSearch;",
        "",
      ].join("\n"),
    );
  }
  return files.reduce((total, file) => total + file.count, 0);
}

/**
 * What searches a site, from its `content/site.json` under `root`: Pagefind
 * where it doesn't say, or where the file can't be read, as builds treat it.
 */
export async function readSearchEngine(root = "."): Promise<SearchEngine> {
  const settings = await readFile(join(root, "content", "site.json"), "utf8")
    .then((text) => JSON.parse(text) as { search?: { engine?: unknown } })
    .catch(() => undefined);
  const engine = settings?.search?.engine;
  return SEARCH_ENGINES.find((known) => known === engine) ?? "pagefind";
}

type PagefindIndex = NonNullable<Awaited<ReturnType<typeof import("pagefind")["createIndex"]>>["index"]>;

/** Makes an index with `add`, writes it into `indexDir` and says how many pages it has. */
async function indexWith(
  indexDir: string,
  add: (index: PagefindIndex) => Promise<{ errors: string[] }>,
): Promise<number> {
  // Loaded only when needed: Pagefind runs a program of its own.
  const pagefind = await import("pagefind");
  try {
    const { index, errors } = await pagefind.createIndex({});
    if (!index) throw new Error(`Pagefind couldn't start: ${errors.join("; ")}`);
    // Pages mark the content to index with data-pagefind-body, so headers, footers, and "Page not found" are left out;
    // `add` gives Pagefind only pages with the mark, since with none Pagefind would index every page whole.
    const added = await add(index);
    if (added.errors.length > 0) throw new Error(`Pagefind couldn't index the site: ${added.errors.join("; ")}`);
    // Pagefind's writeFiles can answer before every file is on disk, so the index is written here instead.
    const built = await index.getFiles();
    if (built.errors.length > 0) throw new Error(`Pagefind couldn't write the index: ${built.errors.join("; ")}`);
    for (const file of built.files) {
      const path = join(indexDir, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    // The pages indexed, which leaves out those without content marked for it.
    const entryFile = built.files.find((file) => file.path === "pagefind-entry.json");
    if (!entryFile) throw new Error("Pagefind didn't make pagefind-entry.json");
    const entry = JSON.parse(new TextDecoder().decode(entryFile.content)) as {
      languages: Record<string, { page_count: number }>;
    };
    return Object.values(entry.languages).reduce((total, language) => total + language.page_count, 0);
  } finally {
    await pagefind.close();
  }
}
