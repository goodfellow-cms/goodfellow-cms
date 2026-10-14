/**
 * Credits for the site's media (`content/media.json`): who made a photo, where
 * it came from and its license, such as for a photo the AI assistant added
 * from Openverse. Pages show the credits of the photos they use, as the
 * photos' licenses require.
 */
import { z } from "zod";
import type { SiteContent } from "./load.js";

/** Only web addresses are linked, so a credit can't link anywhere else. */
const webAddress = z
  .string()
  .refine((value) => /^https?:\/\//i.test(value), "must start with https:// or http://")
  .optional();

export const photoCreditSchema = z.object({
  /** The photo's title, such as "Melton Mowbray church - choir". */
  title: z.string().default(""),
  /** Who made it, as they're named where it came from. */
  creator: z.string().default(""),
  creatorUrl: webAddress,
  /** Where it came from, such as "Flickr". */
  source: z.string().default(""),
  /** The photo's own page there. */
  sourceUrl: webAddress,
  /** The license's name, such as "CC BY 2.0". */
  license: z.string(),
  licenseUrl: webAddress,
});

export const mediaFileSchema = z.object({
  version: z.literal(1),
  /** Each credited file's credit, by its address, such as `/media/choir.jpg`. */
  credits: z.record(z.string(), photoCreditSchema).default({}),
});

export type PhotoCredit = z.output<typeof photoCreditSchema>;
export type MediaFile = z.output<typeof mediaFileSchema>;

/** A credit with the address of the file it's for, as a page lists it. */
export interface PageCredit extends PhotoCredit {
  url: string;
}

/** Characters that can continue an address, so `/media/a.jpg` isn't found in `/media/a.jpg.old`. */
const ADDRESS_CHARACTER = /[\w.~%/-]/;

/** Whether `text` uses the file at `url`, as an address on its own. */
function mentions(text: string, url: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(url, from);
    if (at === -1) return false;
    const next = text[at + url.length];
    if (next === undefined || !ADDRESS_CHARACTER.test(next)) return true;
    from = at + 1;
  }
}

/** The ids of the collections blocks show, from their `collection` props, such as a Collection list's. */
function shownCollections(value: unknown, found: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) shownCollections(item, found);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "collection" && typeof item === "string") found.add(item);
      else shownCollections(item, found);
    }
  }
  return found;
}

/**
 * The credits of the media a page uses: in its content, header and footer
 * (`data`, as prepared to render), and in the items of the collections its
 * blocks show. In the order the site's credits list them.
 */
export function pageCredits(
  content: Pick<SiteContent, "credits" | "collections">,
  data: readonly unknown[],
): PageCredit[] {
  const credits = Object.entries(content.credits ?? {});
  if (credits.length === 0) return [];
  const collections = shownCollections(data, new Set());
  const shown = content.collections
    .filter((collection) => collections.has(collection.id))
    .map((collection) => collection.entries.map((entry) => entry.content.fields));
  const text = JSON.stringify([data, shown]);
  return credits.filter(([url]) => mentions(text, url)).map(([url, credit]) => ({ url, ...credit }));
}
