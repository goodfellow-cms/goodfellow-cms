// Who a page is for: everyone, or the site's members, which only a full-stack site's server can keep it to (see
// the docs' Full-stack Next.js page). Goodfellow only says which pages are members'; the site's own code decides
// who's a member and what everyone else sees. What builds publish beside the pages never carries members' pages or
// collections: the site's search, feeds, calendar files, and the content API leave them out.
import type { Collection } from "./collections.js";
import type { Page, SiteContent } from "./load.js";
import type { FileChange } from "./store.js";

/** Who can see a page: `everyone`, as where it's left out, or only the site's `members`. */
export const VISIBILITIES = ["everyone", "members"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** The page setting that says who a page is for, which a collection's template gives its items' pages. */
export const VISIBILITY_PROP = "visibility";

/**
 * Whether every item of a collection is for members only, as its `_collection.json` says: its own setting, or its
 * template's "Who can see this page", which every item's page has, so its items are left out of what builds publish
 * beside the pages either way.
 */
export function isMembersCollection(collection: Pick<Collection, "settings">): boolean {
  const template = collection.settings.template as { root?: { props?: Record<string, unknown> } } | undefined;
  return collection.settings.visibility === "members" || template?.root?.props?.[VISIBILITY_PROP] === "members";
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

/** Who a page file says its page is for, from its JSON: `members`, or `everyone` where it doesn't say. */
function pageVisibility(text: string | undefined): Visibility {
  if (text === undefined) return "everyone";
  try {
    const props = (JSON.parse(text) as { data?: { root?: { props?: Record<string, unknown> } } }).data?.root?.props;
    return props?.[VISIBILITY_PROP] === "members" ? "members" : "everyone";
  } catch {
    return "everyone";
  }
}

/**
 * The pages in `changes` whose "Who can see this page" changes, a new page's included, which, like a collection's
 * settings, only a site's owners may change: making a members' page public publishes it to everyone, its search
 * entry and content API file included. Deleting a members' page counts too, since the same address could then be
 * published again for everyone; moving one does both, as its new file is a new members' page. A full-stack site's
 * server refuses them from anyone else (`appApi()`). Pages sent as bytes are read as text, so sending one that
 * way never skips the check; `read` gives a file as it was.
 */
export async function visibilityChanges(
  changes: readonly FileChange[],
  read: (path: string) => Promise<string | undefined>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const change of changes) {
    if (!change.path.startsWith("content/pages/") || !change.path.endsWith(".json")) continue;
    const before = pageVisibility(await read(change.path));
    if ("delete" in change) {
      if (before === "members") changed.push(change.path);
      continue;
    }
    let text: string;
    if ("content" in change) text = change.content;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(change.bytes);
      } catch {
        text = "";
      }
    }
    if (pageVisibility(text) !== before) changed.push(change.path);
  }
  return changed;
}
