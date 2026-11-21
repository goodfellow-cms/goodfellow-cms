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
  const pages = (await readdir(outDir, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        file.endsWith(".html") &&
        !file.startsWith("admin/") &&
        !file.startsWith(`${SEARCH_INDEX_DIR}/`) &&
        !file.startsWith(`${MINISEARCH_DIR}/`),
    );
  const indexDir = join(outDir, SEARCH_INDEX_DIR);
  await rm(indexDir, { recursive: true, force: true });
  await removeMiniSearch(outDir);
  const read = await Promise.all(
    pages.map(async (file) => ({ file, html: await readFile(join(outDir, file), "utf8") })),
  );
  if (!read.some((page) => page.html.includes(SEARCH_ATTRIBUTE))) return undefined;
  const marked = read.filter((page) => marksSearchContent(page.html));
  let indexed: number | undefined;
  if (webSearchEngine(engine) === "pagefind") {
    // Each page is given by its path in the site, from which Pagefind works out its address as it would indexing
    // the folder; a glob of their names would read characters such as `[` and `{` in them as patterns.
    indexed = await indexWith(indexDir, async (index) => {
      const errors: string[] = [];
      for (const { file, html } of marked) {
        const added = await index.addHTMLFile({ sourcePath: file, content: html });
        errors.push(...added.errors);
      }
      return { errors };
    });
  }
  const mini = miniSearchFor(engine);
  if (mini.web || mini.apps) {
    const documents = await writeMiniSearch(
      outDir,
      marked.map(({ file, html }) => ({ url: builtPagePath(file), html })),
      mini,
    );
    indexed ??= documents;
  }
  return indexed;
}

/**
 * Writes the search index of `pages` into `indexDir`, such as a full-stack
 * Next.js site's prerendered pages into `public/pagefind/`, if any of them has
 * a search block. Only pages that mark content to index are in it
 * (`marksSearchContent()`). With `engine`, as `writeSearchIndex()`, MiniSearch's
 * files go beside `indexDir` (`public/minisearch/`, `public/api/`). Returns how
 * many pages were indexed, or `undefined` if the site has no search.
 */
export async function writePagesSearchIndex(
  pages: SearchPage[],
  indexDir: string,
  { engine = "pagefind" }: { engine?: SearchEngine } = {},
): Promise<number | undefined> {
  const outDir = dirname(indexDir);
  await rm(indexDir, { recursive: true, force: true });
  await removeMiniSearch(outDir);
  if (!pages.some((page) => page.html.includes(SEARCH_ATTRIBUTE))) return undefined;
  const marked = pages.filter((candidate) => marksSearchContent(candidate.html));
  let indexed: number | undefined;
  if (webSearchEngine(engine) === "pagefind") {
    indexed = await indexWith(indexDir, async (index) => {
      const errors: string[] = [];
      for (const page of marked) {
        const added = await index.addHTMLFile({ url: page.url, content: page.html });
        errors.push(...added.errors);
      }
      return { errors };
    });
  }
  const mini = miniSearchFor(engine);
  if (mini.web || mini.apps) indexed ??= await writeMiniSearch(outDir, marked, mini);
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
 * page's `<title>`. `undefined` for a page with nothing marked.
 */
export function searchPageText(html: string, path: string): SearchPageText | undefined {
  let language = "";
  let found = false;
  let text = "";
  let heading: string | undefined;
  let headingDone = false;
  let title = "";
  /** Whether an element has just ended, with no text since. */
  let touching = false;
  const open: Array<{ name: string; body: boolean; ignore: boolean; heading: boolean }> = [];
  const inBody = () => open.some((element) => element.body);
  const ignored = () => open.some((element) => element.ignore);
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "html" && attributes.lang) language = attributes.lang;
        const body = Object.hasOwn(attributes, "data-pagefind-body");
        if (body) found = true;
        const firstHeading = name === "h1" && !headingDone && heading === undefined && (body || inBody()) && !ignored();
        if (firstHeading) heading = "";
        open.push({
          name,
          body,
          ignore: NOT_TEXT.has(name) || Object.hasOwn(attributes, "data-pagefind-ignore"),
          heading: firstHeading,
        });
        // Words end where elements meet, as two links side by side do, though not where one starts after a word.
        if (!INLINE.has(name) || touching) text += " ";
        touching = false;
      },
      ontext(chunk) {
        touching = false;
        if (open.at(-1)?.name === "title" && !inBody()) title += chunk;
        if (!inBody() || ignored()) return;
        text += chunk;
        if (heading !== undefined && !headingDone) heading += chunk;
      },
      onclosetag(name) {
        const element = open.pop();
        if (element?.heading) headingDone = true;
        if (!INLINE.has(name)) text += " ";
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

/** Takes out MiniSearch's files of a build before, so none is left over from another index or engine. */
async function removeMiniSearch(outDir: string): Promise<void> {
  await rm(join(outDir, MINISEARCH_DIR), { recursive: true, force: true });
  await rm(join(outDir, CONTENT_API_DIR, API_SEARCH_DIR), { recursive: true, force: true });
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

/** A file's name with its hash: `en.3f2a9c01b4d7e6f0.json`. */
async function hashedName(stem: string, extension: string, text: string): Promise<string> {
  return `${stem}.${(await hashText(text)).slice(0, 16)}.${extension}`;
}

/**
 * Writes MiniSearch's index of `pages` (`searchPageText()`), a `SearchFile` for
 * each language, every file named by its hash so hosts can send it with long
 * caching (`CACHED_FOLDERS`):
 *
 * - `web`: `minisearch/assets/<code>.<hash>.json` and `search.<hash>.js` (the
 *   website's MiniSearch), and `minisearch/minisearch.js`, which names them, for
 *   the Search box to load as it loads Pagefind.
 * - `apps`: `api/search/<code>.<hash>.json` for each language the content API
 *   has, which its manifest names as the language's `search`, where the build
 *   wrote a content API.
 *
 * Returns how many pages are in it.
 */
export async function writeMiniSearch(
  outDir: string,
  pages: SearchPage[],
  { web, apps }: { web: boolean; apps: boolean },
): Promise<number> {
  await removeMiniSearch(outDir);
  const byLanguage = new Map<string, SearchDocument[]>();
  for (const page of pages) {
    const found = searchPageText(page.html, page.url);
    if (!found || !FILE_LANGUAGE.test(found.language)) continue;
    byLanguage.set(found.language, [...(byLanguage.get(found.language) ?? []), found.document]);
  }
  const files = await Promise.all(
    [...byLanguage].map(async ([language, documents]) => {
      const file: SearchFile = {
        version: SEARCH_FILE_VERSION,
        language,
        documents: documents.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      };
      const text = `${JSON.stringify(file)}\n`;
      return { language, text, name: await hashedName(language, "json", text), count: documents.length };
    }),
  );
  if (web) {
    const assets = join(outDir, MINISEARCH_ASSETS_DIR);
    await mkdir(assets, { recursive: true });
    for (const file of files) await writeFile(join(assets, file.name), file.text);
    const module = await miniSearchModule();
    const moduleName = await hashedName("search", "js", module);
    await writeFile(join(assets, moduleName), module);
    const assetsFolder = MINISEARCH_ASSETS_DIR.slice(MINISEARCH_DIR.length + 1);
    const named = Object.fromEntries(files.map((file) => [file.language, `${assetsFolder}/${file.name}`]));
    await writeFile(
      join(outDir, MINISEARCH_MODULE),
      [
        "// Written by Goodfellow's build: the site's search, whose files are named by their content.",
        `import { pagefindLike } from "./${assetsFolder}/${moduleName}";`,
        `const search = pagefindLike(${JSON.stringify(named)}, import.meta.url);`,
        "export const options = search.options;",
        "export const destroy = search.destroy;",
        "export const debouncedSearch = search.debouncedSearch;",
        "",
      ].join("\n"),
    );
  }
  if (apps) {
    const manifestPath = join(outDir, CONTENT_API_MANIFEST.slice(1));
    const manifest = await readFile(manifestPath, "utf8")
      .then((text) => JSON.parse(text) as ApiManifest)
      .catch(() => undefined);
    if (manifest) {
      const folder = join(outDir, CONTENT_API_DIR, API_SEARCH_DIR);
      await mkdir(folder, { recursive: true });
      for (const file of files) {
        const language = manifest.languages[file.language];
        if (!language) continue;
        await writeFile(join(folder, file.name), file.text);
        language.search = { file: `${API_SEARCH_DIR}/${file.name}`, hash: await hashText(file.text) };
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    }
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
