/**
 * Site search. Builds index a site's pages only when one of them has a search
 * block, which says so with this attribute. Third-party blocks that search with
 * Pagefind add it too.
 */
export const SEARCH_ATTRIBUTE = "data-goodfellow-search";

/** Where builds write Pagefind's search index, relative to the site's address. Search blocks load Pagefind from here. */
export const SEARCH_INDEX_DIR = "pagefind";

/**
 * Where builds write MiniSearch's index for the website, relative to the
 * site's address: `minisearch/minisearch.js`, which the Search box loads as it
 * loads Pagefind's, and the files it names in `assets/`, each named by its hash.
 */
export const MINISEARCH_DIR = "minisearch";

/** The folder of `MINISEARCH_DIR`'s files named by their hash, which hosts send with long caching. */
export const MINISEARCH_ASSETS_DIR = `${MINISEARCH_DIR}/assets`;

/** The module the Search box loads in place of Pagefind's where the website searches with MiniSearch. */
export const MINISEARCH_MODULE = `${MINISEARCH_DIR}/minisearch.js`;

/**
 * What searches the site (`content/site.json`'s `search.engine`): Pagefind on
 * the website and nothing more (the default, `pagefind`), MiniSearch on the
 * website and in apps from one index, so both find the same (`minisearch`),
 * or Pagefind on the website and MiniSearch in apps (`both`), which can find
 * differently.
 */
export const SEARCH_ENGINES = ["pagefind", "minisearch", "both"] as const;

export type SearchEngine = (typeof SEARCH_ENGINES)[number];

/** The attribute the Search box carries where the website searches with MiniSearch, which `searchScript()` reads. */
export const SEARCH_ENGINE_ATTRIBUTE = "data-gf-search-engine";

/** What searches a site with `settings`: Pagefind where it doesn't say. */
export function searchEngine(settings: { search?: { engine?: SearchEngine } | undefined }): SearchEngine {
  return settings.search?.engine ?? "pagefind";
}

/** What the website searches with: Pagefind unless the site searches with MiniSearch alone. */
export function webSearchEngine(engine: SearchEngine): "pagefind" | "minisearch" {
  return engine === "minisearch" ? "minisearch" : "pagefind";
}

/** Whether builds write MiniSearch's index: for the website, for apps (the content API), or both. */
export function miniSearchFor(engine: SearchEngine): { web: boolean; apps: boolean } {
  return { web: engine === "minisearch", apps: engine !== "pagefind" };
}
