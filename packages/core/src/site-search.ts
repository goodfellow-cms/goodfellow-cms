/**
 * Searching a site with MiniSearch, the same way on the website and in apps:
 * both read the same index file (`SearchFile`, which builds write from the
 * pages as Pagefind reads them) through this module, so the same words find
 * the same pages, in the same order, with the same excerpts. No DOM, no React:
 * apps run it on Hermes, and builds bundle it for the website's Search box.
 */
import MiniSearch, { type SearchResult } from "minisearch";

/** The version of `SearchFile`'s shape; a reader leaves a file of another alone. */
export const SEARCH_FILE_VERSION = 1;

/** At most this many results show, on the website and in apps alike. */
export const SEARCH_RESULTS = 8;

/** About how many words an excerpt shows. */
export const EXCERPT_WORDS = 30;

/** A page the index has: its address on the site, its title, and its text, as visitors read it. */
export interface SearchDocument {
  path: string;
  title: string;
  text: string;
}

/** One language's search index: what builds write, `minisearch/assets/<code>.<hash>.json` and `api/search/…`. */
export interface SearchFile {
  version: typeof SEARCH_FILE_VERSION;
  /** The language's code, as the pages' `<html lang>` has it. */
  language: string;
  documents: SearchDocument[];
}

/** A piece of an excerpt: words as the page has them, marked where they're what was searched for. */
export interface ExcerptPart {
  text: string;
  match?: true;
}

/** A page found, with an excerpt around the first place it has what was searched for. */
export interface SiteSearchResult {
  path: string;
  title: string;
  excerpt: ExcerptPart[];
}

/** Searches one language's index. */
export interface SiteSearch {
  search(query: string): SiteSearchResult[];
}

/** Whether `value` is a search file this release reads. */
export function isSearchFile(value: unknown): value is SearchFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<SearchFile>;
  return (
    file.version === SEARCH_FILE_VERSION &&
    typeof file.language === "string" &&
    Array.isArray(file.documents) &&
    file.documents.every(
      (document) =>
        document !== null &&
        typeof document === "object" &&
        typeof document.path === "string" &&
        typeof document.title === "string" &&
        typeof document.text === "string",
    )
  );
}

/** What separates words: spaces, line breaks, and punctuation, as MiniSearch splits them by default. */
const BETWEEN_WORDS = /[\n\r\p{Z}\p{P}]+/u;

/** A word, for excerpts: what's between `BETWEEN_WORDS`. */
const WORD = /[^\n\r\p{Z}\p{P}]+/gu;

/**
 * A word as the index keeps it: in lower case and without accents, so "Café"
 * and "cafe" find each other. `toLowerCase()`, not the locale's, so it's the
 * same on every computer and phone.
 */
export function searchTerm(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every word of `text`, as the index keeps them. */
function terms(text: string): string[] {
  return text
    .split(BETWEEN_WORDS)
    .filter(Boolean)
    .map(searchTerm)
    .filter((term) => term.length > 0);
}

/** Searches `file`: pages with every word typed, the last and each a word's beginning, allowing small typos in long ones. */
export function siteSearch(file: SearchFile): SiteSearch {
  const index = new MiniSearch<SearchDocument & { id: number }>({
    fields: ["title", "text"],
    storeFields: [],
    tokenize: terms,
    // Words are already as the index keeps them.
    processTerm: (term) => term,
    searchOptions: {
      tokenize: terms,
      processTerm: (term) => term,
      combineWith: "AND",
      prefix: true,
      // About a typo in every five letters, and none in words shorter than five, which typos mostly turn into others.
      fuzzy: (term) => (term.length < 5 ? false : 0.2),
      boost: { title: 2 },
    },
  });
  index.addAll(file.documents.map((document, id) => ({ ...document, id })));
  return {
    search(query) {
      if (terms(query).length === 0) return [];
      return index
        .search(query)
        .slice(0, SEARCH_RESULTS)
        .flatMap((result) => {
          const document = file.documents[result.id as number];
          return document ? [{ path: document.path, title: document.title, excerpt: excerpt(document, result) }] : [];
        });
    },
  };
}

/**
 * About `EXCERPT_WORDS` words of the page's text, starting a little before the
 * first word the search matched, with the words it matched marked; the start
 * of the text where only the title matched.
 */
function excerpt(document: SearchDocument, result: SearchResult): ExcerptPart[] {
  const matched = new Set(result.terms);
  const words = [...document.text.matchAll(WORD)].map((found) => ({
    start: found.index,
    end: found.index + found[0].length,
    match: matched.has(searchTerm(found[0])),
  }));
  if (words.length === 0) return [];
  const first = words.findIndex((word) => word.match);
  const from = Math.max(0, (first === -1 ? 0 : first) - Math.floor(EXCERPT_WORDS / 4));
  const shown = words.slice(from, from + EXCERPT_WORDS);
  const parts: ExcerptPart[] = [];
  const add = (text: string, match: boolean) => {
    if (!text) return;
    // Not `at()`, which the website's MiniSearch would need browsers from 2022 for.
    const last = parts[parts.length - 1];
    if (last && !last.match && !match) last.text += text;
    else parts.push(match ? { text, match: true } : { text });
  };
  let at = shown[0]?.start ?? 0;
  for (const word of shown) {
    add(document.text.slice(at, word.start), false);
    add(document.text.slice(word.start, word.end), word.match);
    at = word.end;
  }
  // The text's end, such as its last full stop, where the excerpt reaches it.
  if (from + shown.length === words.length) add(document.text.slice(at).trimEnd(), false);
  return parts;
}

/** An excerpt as HTML: its text escaped, its matches in `<mark>`, as Pagefind gives them. */
export function excerptHtml(parts: readonly ExcerptPart[]): string {
  const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return parts.map((part) => (part.match ? `<mark>${escaped(part.text)}</mark>` : escaped(part.text))).join("");
}
