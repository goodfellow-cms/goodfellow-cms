/**
 * Reads a WordPress site from its address, through WordPress's REST API,
 * which answers anyone, browsers on other sites included, for what the site
 * shows its visitors: published pages and posts, as they're shown, their
 * categories and tags, and the media library. Menus need signing in, so they
 * aren't read.
 */
import { plainText } from "./html.js";
import {
  decodedSlug,
  type WordPressItem,
  type WordPressItemType,
  type WordPressMedia,
  WordPressReadError,
  type WordPressSite,
  type WordPressTerm,
  wordPressDate,
} from "./model.js";

/** How many things WordPress gives in each answer, its most. */
const PER_PAGE = 100;
/** The most answers read for any one kind of thing, so a site that doesn't stop can't keep a read going. */
const MAX_PAGES = 200;

/** The part of `fetch` reading a site uses, so core needs no DOM types. Pass the browser's or Node's `fetch`. */
export type WordPressFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> }>;

export interface FetchWordPressOptions {
  fetch?: WordPressFetch;
  /** Called as each kind of content is read, such as to show progress. */
  onProgress?(kind: "site" | "pages" | "posts" | "categories" | "tags" | "media", read: number): void;
}

interface Rendered {
  rendered?: string;
}

interface RestItem {
  id: number;
  date?: string;
  slug?: string;
  status?: string;
  link?: string;
  title?: Rendered;
  content?: Rendered;
  excerpt?: Rendered;
  parent?: number;
  menu_order?: number;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
}

interface RestTerm {
  id: number;
  name?: string;
  slug?: string;
  parent?: number;
  link?: string;
}

interface RestMedia {
  id: number;
  source_url?: string;
  alt_text?: string;
  title?: Rendered;
  caption?: Rendered;
}

/** `example.org/blog/` → `https://example.org/blog`. */
export function wordPressAddress(input: string): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/wp-json$/, "")}`;
  } catch {
    return undefined;
  }
}

/**
 * Reads a WordPress site from its address, such as `https://example.org`.
 * Throws `WordPressReadError`: `unreachable` when nothing answers or its
 * answer can't be read, `not-wordpress` when it isn't WordPress's API.
 */
export async function fetchWordPressSite(address: string, options: FetchWordPressOptions = {}): Promise<WordPressSite> {
  const doFetch = options.fetch ?? (globalThis as unknown as { fetch: WordPressFetch }).fetch.bind(globalThis);
  const site = wordPressAddress(address);
  if (!site) throw new WordPressReadError("unreachable", `${address} isn't a web address.`);

  // Sites without pretty addresses answer at ?rest_route= instead of /wp-json/.
  let route = (path: string, query = "") => `${site}/wp-json${path}${query ? `?${query}` : ""}`;
  const get = async (url: string): Promise<{ data: unknown; totalPages: number }> => {
    let response: Awaited<ReturnType<WordPressFetch>>;
    try {
      response = await doFetch(url, { headers: { Accept: "application/json" } });
    } catch {
      throw new WordPressReadError("unreachable", `${site} couldn't be reached, or doesn't let other sites read it.`);
    }
    if (!response.ok) {
      throw new WordPressReadError(
        response.status === 404 ? "not-wordpress" : "unreachable",
        `${url} answered ${response.status}.`,
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new WordPressReadError("not-wordpress", `${url} didn't answer with WordPress's API.`);
    }
    return { data, totalPages: Number(response.headers.get("x-wp-totalpages") ?? "") || 0 };
  };

  let index: { name?: string; description?: string; home?: string; url?: string; namespaces?: string[] };
  try {
    index = (await get(route("/"))).data as typeof index;
  } catch (error) {
    if (!(error instanceof WordPressReadError) || error.problem !== "not-wordpress") throw error;
    route = (path: string, query = "") => `${site}/?rest_route=${encodeURIComponent(path)}${query ? `&${query}` : ""}`;
    index = (await get(route("/"))).data as typeof index;
  }
  if (!index || typeof index !== "object" || !Array.isArray(index.namespaces) || !index.namespaces.includes("wp/v2")) {
    throw new WordPressReadError("not-wordpress", `${site} isn't a WordPress site, or its API is turned off.`);
  }
  options.onProgress?.("site", 1);

  const all = async <T>(kind: "pages" | "posts" | "categories" | "tags" | "media", fields: string): Promise<T[]> => {
    const results: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let answer: { data: unknown; totalPages: number };
      try {
        answer = await get(route(`/wp/v2/${kind}`, `per_page=${PER_PAGE}&page=${page}&_fields=${fields}`));
      } catch (error) {
        // WordPress answers 400 for a page past the last.
        if (page > 1 && error instanceof WordPressReadError) break;
        throw error;
      }
      if (!Array.isArray(answer.data)) break;
      results.push(...(answer.data as T[]));
      options.onProgress?.(kind, results.length);
      if (answer.data.length < PER_PAGE || (answer.totalPages > 0 && page >= answer.totalPages)) break;
    }
    return results;
  };

  const itemFields = "id,date,slug,status,link,title,content,excerpt,parent,menu_order,featured_media";
  const pages = await all<RestItem>("pages", itemFields);
  const posts = await all<RestItem>("posts", `${itemFields},categories,tags`);
  const categories = await all<RestTerm>("categories", "id,name,slug,parent,link");
  const tags = await all<RestTerm>("tags", "id,name,slug,link");
  const media = await all<RestMedia>("media", "id,source_url,alt_text,title,caption");

  const slugs = (terms: RestTerm[]) => new Map(terms.map((term) => [term.id, decodedSlug(term.slug ?? "")]));
  const categorySlugs = slugs(categories);
  const tagSlugs = slugs(tags);
  const item = (type: WordPressItemType, entry: RestItem): WordPressItem => ({
    id: entry.id,
    type,
    status: entry.status ?? "publish",
    title: plainText(entry.title?.rendered ?? ""),
    slug: decodedSlug(entry.slug ?? ""),
    link: entry.link ?? "",
    date: wordPressDate(entry.date),
    parent: entry.parent ?? 0,
    order: entry.menu_order ?? 0,
    content: entry.content?.rendered ?? "",
    rendered: true,
    excerpt: entry.excerpt?.rendered ?? "",
    categories: (entry.categories ?? []).flatMap((id) => categorySlugs.get(id) ?? []),
    tags: (entry.tags ?? []).flatMap((id) => tagSlugs.get(id) ?? []),
    ...(entry.featured_media && { image: entry.featured_media }),
  });
  const term = (entry: RestTerm, parents: Map<number, string>): WordPressTerm => ({
    name: plainText(entry.name ?? ""),
    slug: decodedSlug(entry.slug ?? ""),
    ...(entry.parent && parents.get(entry.parent) && { parent: parents.get(entry.parent) }),
    ...(entry.link && { link: entry.link }),
  });

  return {
    title: plainText(index.name ?? ""),
    description: plainText(index.description ?? ""),
    url: (wordPressAddress(index.home ?? index.url ?? "") ?? site).replace(/\/+$/, ""),
    items: [...pages.map((entry) => item("page", entry)), ...posts.map((entry) => item("post", entry))],
    categories: categories.map((entry) => term(entry, categorySlugs)),
    tags: tags.map((entry) => term(entry, tagSlugs)),
    media: media.map(
      (entry): WordPressMedia => ({
        id: entry.id,
        url: entry.source_url ?? "",
        title: plainText(entry.title?.rendered ?? ""),
        alt: entry.alt_text?.trim() ?? "",
        caption: plainText(entry.caption?.rendered ?? ""),
      }),
    ),
    reusableBlocks: {},
    other: {},
    source: "address",
  };
}
