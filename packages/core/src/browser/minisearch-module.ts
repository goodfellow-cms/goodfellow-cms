/**
 * The website's MiniSearch, as builds bundle it into `minisearch/assets/`: it
 * answers the Search box's script as Pagefind's module does (`options()`,
 * `destroy()`, `debouncedSearch()`, and results whose `data()` gives the
 * page's `url`, `meta.title`, and `excerpt`), so the script loads either the
 * same way. It searches with `siteSearch()`, as apps do, from the index in the
 * page's language (`<html lang>`), loaded the first time it's asked.
 * `minisearch/minisearch.js`, which builds write beside it, names the files.
 */
import { excerptHtml, isSearchFile, SEARCH_FILE_VERSION, type SiteSearch, siteSearch } from "../site-search.js";

/** A result as Pagefind's module gives one. */
export interface PagefindResult {
  data(): Promise<{ url: string; meta: { title: string }; excerpt: string }>;
}

/** What the Search box's script calls, as Pagefind's module has it. */
export interface PagefindLike {
  options(options: unknown): Promise<void>;
  destroy(): Promise<void>;
  debouncedSearch(query: string): Promise<{ results: PagefindResult[] }>;
}

/** Just what this module uses of the browser, since core has no DOM types. */
interface Browser {
  document?: { documentElement?: { lang?: string } };
  fetch(address: string): Promise<{ ok: boolean; json(): Promise<unknown> }>;
}

/** The page's language, as `<html lang>` says it. */
function pageLanguage(): string {
  return (globalThis as unknown as Browser).document?.documentElement?.lang ?? "";
}

/**
 * Searches the index files in `files` (by language code, each relative to
 * `from`, the address of the module that names them), as the Search box asks
 * Pagefind to.
 */
export function pagefindLike(files: Readonly<Record<string, string>>, from: string): PagefindLike {
  const folder = from.slice(0, from.lastIndexOf("/") + 1);
  let loaded: { language: string; search: Promise<SiteSearch> } | undefined;
  const load = (): Promise<SiteSearch> => {
    const language = pageLanguage();
    if (loaded?.language === language) return loaded.search;
    const file = Object.hasOwn(files, language) ? files[language] : undefined;
    const search = file
      ? (globalThis as unknown as Browser).fetch(folder + file).then(async (response) => {
          const index = response.ok ? await response.json() : undefined;
          if (!isSearchFile(index)) throw new Error(`The search index for ${language} can't be read`);
          return siteSearch(index);
        })
      : // A language with no pages to search finds nothing, as Pagefind does, rather than search being unavailable.
        Promise.resolve(siteSearch({ version: SEARCH_FILE_VERSION, language, documents: [] }));
    // A failed load is asked again next time, as the script does for Pagefind.
    search.catch(() => {
      if (loaded?.search === search) loaded = undefined;
    });
    loaded = { language, search };
    return search;
  };
  return {
    options: async () => {},
    destroy: async () => {
      loaded = undefined;
    },
    debouncedSearch: async (query) => {
      const search = await load();
      return {
        results: search.search(query).map((result) => ({
          data: async () => ({ url: result.path, meta: { title: result.title }, excerpt: excerptHtml(result.excerpt) }),
        })),
      };
    },
  };
}
