import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Parser } from "htmlparser2";
import { SEARCH_ATTRIBUTE, SEARCH_INDEX_DIR } from "./search.js";

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
 * Writes a Pagefind search index of a built site into `<outDir>/pagefind/`, if any
 * of its pages has a search block; other sites don't get one. Only pages that
 * mark content to index are in it (`marksSearchContent()`). Returns how many
 * pages were indexed, or `undefined` if the site has no search.
 */
export async function writeSearchIndex(outDir: string): Promise<number | undefined> {
  const pages = (await readdir(outDir, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".html") && !file.startsWith("admin/") && !file.startsWith(`${SEARCH_INDEX_DIR}/`));
  const indexDir = join(outDir, SEARCH_INDEX_DIR);
  await rm(indexDir, { recursive: true, force: true });
  const read = await Promise.all(
    pages.map(async (file) => ({ file, html: await readFile(join(outDir, file), "utf8") })),
  );
  if (!read.some((page) => page.html.includes(SEARCH_ATTRIBUTE))) return undefined;
  // Each page is given by its path in the site, from which Pagefind works out its address as it would indexing the
  // folder; a glob of their names would read characters such as `[` and `{` in them as patterns.
  return indexWith(indexDir, async (index) => {
    const errors: string[] = [];
    for (const { file, html } of read.filter((page) => marksSearchContent(page.html))) {
      const added = await index.addHTMLFile({ sourcePath: file, content: html });
      errors.push(...added.errors);
    }
    return { errors };
  });
}

/**
 * Writes a Pagefind search index of `pages` into `indexDir`, such as a
 * full-stack Next.js site's prerendered pages into `public/pagefind/`, if any of
 * them has a search block. Only pages that mark content to index are in it
 * (`marksSearchContent()`). Returns how many pages were indexed, or `undefined`
 * if the site has no search.
 */
export async function writePagesSearchIndex(pages: SearchPage[], indexDir: string): Promise<number | undefined> {
  await rm(indexDir, { recursive: true, force: true });
  if (!pages.some((page) => page.html.includes(SEARCH_ATTRIBUTE))) return undefined;
  return indexWith(indexDir, async (index) => {
    const errors: string[] = [];
    for (const page of pages.filter((candidate) => marksSearchContent(candidate.html))) {
      const added = await index.addHTMLFile({ url: page.url, content: page.html });
      errors.push(...added.errors);
    }
    return { errors };
  });
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
