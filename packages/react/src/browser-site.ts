import { isMembersCollection } from "@goodfellow-cms/core";
import type { SiteContextValue } from "./site-types.js";

/**
 * The site as the browser may have it, for Client Components: without the collections that are for members only,
 * or the page's item and collection where the item is one of theirs. Next.js sends a Client Component's props to the
 * browser with every page, the pages everyone gets included, so members' items would otherwise reach visitors who
 * only see a teaser, or none. Blocks rendered on the server still see the whole site.
 */
export function browserSite(value: SiteContextValue): SiteContextValue {
  const members = new Set(value.collections.filter(isMembersCollection).map((collection) => collection.id));
  if (members.size === 0) return value;
  const { entry, collection, ...rest } = value;
  const keepsEntry = !entry || !members.has(entry.collection);
  return {
    ...rest,
    collections: value.collections.filter((candidate) => !members.has(candidate.id)),
    ...(keepsEntry && entry && { entry }),
    ...(keepsEntry && collection && !members.has(collection.id) && { collection }),
  };
}
