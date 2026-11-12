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

/** A block in Puck's data, found by its shape wherever it is: a page's content, a slot, or a drop zone. */
interface PlacedBlock {
  type: string;
  props: Record<string, unknown>;
}

function isPlacedBlock(value: unknown): value is PlacedBlock {
  const block = value as PlacedBlock | null;
  return (
    typeof block === "object" &&
    block !== null &&
    typeof block.type === "string" &&
    typeof block.props === "object" &&
    block.props !== null
  );
}

/** The first block of `type` anywhere in `value`, in the order a page shows them. */
function firstBlockOf(value: unknown, type: string): PlacedBlock | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstBlockOf(item, type);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (isPlacedBlock(value) && value.type === type) return value;
  for (const item of Object.values(value)) {
    const found = firstBlockOf(item, type);
    if (found) return found;
  }
  return undefined;
}

/** The ids of every block anywhere in `value`. */
function blockIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) blockIds(item, ids);
  } else if (value && typeof value === "object") {
    if (isPlacedBlock(value) && typeof value.props.id === "string") ids.add(value.props.id);
    for (const item of Object.values(value)) blockIds(item, ids);
  }
  return ids;
}

/** Puck's data, as far as what's for members needs to know it. */
interface PageData {
  root?: unknown;
  content?: unknown[];
  zones?: Record<string, unknown[]>;
}

/**
 * What everyone but a members-only page's members sees of it: its blocks
 * before the first `paywall` block (by its name in the site's `blocks`), and
 * that block, which says what the rest is for and how to have it. A paywall
 * inside a block (in its slot, or a drop zone) ends the teaser before that
 * block, since what else it holds may be for members. A page with no paywall
 * block shows only one, with its own words, so nothing an editor didn't choose
 * is shown. Drop zones go with their blocks, and synced blocks should already
 * be in place (`expandSyncedBlocks()`), since a paywall can be in one.
 */
export function teaserData<T extends PageData>(data: T, paywall: string): T {
  const content = data.content ?? [];
  const at = content.findIndex((block) => firstBlockOf(block, paywall) !== undefined);
  const placed = at === -1 ? undefined : firstBlockOf(content[at], paywall);
  const shown = at === -1 ? [] : content.slice(0, at);
  const block = placed ?? { type: paywall, props: { id: `${paywall}-teaser` } };
  const kept = blockIds(shown);
  const zones = data.zones
    ? Object.fromEntries(
        Object.entries(data.zones).filter(([key]) => kept.has(key.slice(0, Math.max(0, key.lastIndexOf(":"))))),
      )
    : undefined;
  return { ...data, content: [...shown, block], ...(zones && { zones }) };
}

/** `value` without any block of `type`, in slots and drop zones too. */
function withoutBlocksOf<T>(value: T, type: string): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isPlacedBlock(item) && item.type === type))
      .map((item) => withoutBlocksOf(item, type)) as T;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutBlocksOf(item, type)])) as T;
}

/**
 * A page's data as its members see it, or anyone sees a page for everyone:
 * without its `paywall` blocks, which are only for what others see of it
 * (`teaserData()`).
 */
export function withoutPaywall<T extends PageData>(data: T, paywall: string): T {
  return firstBlockOf(data, paywall) ? withoutBlocksOf(data, paywall) : data;
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
 * entry and content API file included. A full-stack site's server refuses them from anyone else (`appApi()`). Pages
 * sent as bytes are read as text, so sending one that way never skips the check; `read` gives a file as it was.
 */
export async function visibilityChanges(
  changes: readonly FileChange[],
  read: (path: string) => Promise<string | undefined>,
): Promise<string[]> {
  const changed: string[] = [];
  for (const change of changes) {
    if (!change.path.startsWith("content/pages/") || !change.path.endsWith(".json") || "delete" in change) continue;
    let text: string;
    if ("content" in change) text = change.content;
    else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(change.bytes);
      } catch {
        text = "";
      }
    }
    if (pageVisibility(text) !== pageVisibility(await read(change.path))) changed.push(change.path);
  }
  return changed;
}
