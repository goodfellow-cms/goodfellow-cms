// Who a page is for: everyone, or the site's members, which only a full-stack site's server can keep it to (see
// the docs' Full-stack Next.js page). Goodfellow only says which pages are members'; the site's own code decides
// who's a member and what everyone else sees. What builds publish beside the pages never carries members' pages or
// collections: the site's search, feeds, calendar files, and the content API leave them out.
import type { Collection } from "./collections.js";
import type { Page, SiteContent } from "./load.js";

/** Who can see a page: `everyone`, as where it's left out, or only the site's `members`. */
export const VISIBILITIES = ["everyone", "members"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The page setting that says who a page is for, which a collection's template gives its items' pages. */
export const VISIBILITY_PROP = "visibility";

/** Whether every item of a collection is for members only, as its `_collection.json` says. */
export function isMembersCollection(collection: Pick<Collection, "settings">): boolean {
  return collection.settings.visibility === "members";
}

/**
 * Whether a page is for members only: its settings say so (or, for an item's
 * page, its collection's template does), or it's an item of a collection that
 * is.
 */
export function isMembersOnly(
  page: Pick<Page, "content" | "entry">,
  collections: readonly Pick<Collection, "id" | "settings">[],
): boolean {
  const props = page.content.data.root.props as Record<string, unknown> | undefined;
  if (props?.[VISIBILITY_PROP] === "members") return true;
  const { entry } = page;
  const collection = entry && collections.find((candidate) => candidate.id === entry.collection);
  return collection ? isMembersCollection(collection) : false;
}

/** The pages of `pages` that are for members only. */
export function membersPages(content: Pick<SiteContent, "collections">, pages: readonly Page[]): Page[] {
  return pages.filter((page) => isMembersOnly(page, content.collections));
}

/**
 * The site as what's published beside its pages may show it: without the
 * pages and collections that are for members only.
 */
export function withoutMembersContent(content: SiteContent): SiteContent {
  const collections = content.collections.filter((collection) => !isMembersCollection(collection));
  const pages = content.pages.filter((page) => !isMembersOnly(page, content.collections));
  if (collections.length === content.collections.length && pages.length === content.pages.length) return content;
  return { ...content, collections, pages };
}
