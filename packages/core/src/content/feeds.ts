/**
 * Feeds of a site's collections, in RSS 2.0 and Atom, which feed readers and
 * other sites follow: `/feeds/<collection>.rss` and `/feeds/<collection>.atom`
 * for each collection whose items have pages and a date, such as news, newest
 * first. Calendars have calendar files instead. Feeds need full addresses, so
 * a site has them only once its address is set.
 */
import { zonedInstant } from "../calendar.js";
import { absoluteUrl } from "../head.js";
import type { BuildFile } from "./calendars.js";
import type { Collection } from "./collections.js";
import { dateField, entryDetails } from "./entry-details.js";
import type { SiteContent } from "./load.js";

/** Where builds put feeds. */
export const FEEDS_DIR = "feeds";

/** The most items a feed lists, newest first. */
export const FEED_LENGTH = 50;

export type FeedFormat = "rss" | "atom";

/** The address of a collection's feed. */
export function feedPath(collection: string, format: FeedFormat = "rss"): string {
  return `/${FEEDS_DIR}/${collection}.${format}`;
}

/** The collections that have feeds: ones whose items have pages and a date field, apart from calendars. */
export function feedCollections(content: Pick<SiteContent, "collections" | "settings">): Collection[] {
  if (!content.settings.url) return [];
  return content.collections.filter(
    (collection) =>
      collection.settings.path !== undefined &&
      !collection.settings.calendar &&
      dateField(collection) !== undefined &&
      collection.entries.length > 0,
  );
}

/** A feed's title: the collection's name, then the site's. */
export function feedTitle(collection: Collection, siteTitle: string): string {
  return `${collection.settings.name} – ${siteTitle}`;
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

function xml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);
}

interface FeedItem {
  title: string;
  url: string;
  /** When it was published, if its collection dates its items. */
  published?: Date;
  summary?: string;
}

/** A collection's items as a feed lists them: newest first, with undated ones last. */
function feedItems(content: SiteContent, collection: Collection): FeedItem[] {
  const { url = "", timeZone } = content.settings;
  const items = collection.entries.flatMap((entry): FeedItem[] => {
    if (!entry.path) return [];
    const details = entryDetails(collection, entry);
    return [
      {
        title: details.title,
        url: absoluteUrl(url, entry.path),
        ...(details.date && { published: zonedInstant(details.date, timeZone) }),
        ...(details.summary && { summary: details.summary }),
      },
    ];
  });
  return items.sort((a, b) => (b.published?.getTime() ?? 0) - (a.published?.getTime() ?? 0)).slice(0, FEED_LENGTH);
}

function rssFeed(content: SiteContent, collection: Collection, items: FeedItem[]): string {
  const { settings } = content;
  const site = settings.url ?? "";
  const self = absoluteUrl(site, feedPath(collection.id, "rss"));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xml(feedTitle(collection, settings.title))}</title>`,
    `    <link>${xml(absoluteUrl(site, "/"))}</link>`,
    `    <description>${xml(settings.description || settings.title)}</description>`,
    `    <language>${xml(settings.language)}</language>`,
    `    <atom:link href="${xml(self)}" rel="self" type="application/rss+xml"/>`,
  ];
  for (const item of items) {
    lines.push(
      "    <item>",
      `      <title>${xml(item.title)}</title>`,
      `      <link>${xml(item.url)}</link>`,
      `      <guid isPermaLink="true">${xml(item.url)}</guid>`,
      ...(item.published ? [`      <pubDate>${item.published.toUTCString()}</pubDate>`] : []),
      ...(item.summary ? [`      <description>${xml(item.summary)}</description>`] : []),
      "    </item>",
    );
  }
  lines.push("  </channel>", "</rss>");
  return `${lines.join("\n")}\n`;
}

function atomFeed(content: SiteContent, collection: Collection, items: FeedItem[], now: Date): string {
  const { settings } = content;
  const site = settings.url ?? "";
  const self = absoluteUrl(site, feedPath(collection.id, "atom"));
  // Atom needs a time each item and the feed were last changed: when they were published, or else the build's.
  const updated = (item: FeedItem) => (item.published ?? now).toISOString();
  const newest = items.reduce<Date | undefined>(
    (latest, item) => (item.published && (!latest || item.published > latest) ? item.published : latest),
    undefined,
  );
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(settings.language)}">`,
    `  <title>${xml(feedTitle(collection, settings.title))}</title>`,
    ...(settings.description ? [`  <subtitle>${xml(settings.description)}</subtitle>`] : []),
    `  <id>${xml(self)}</id>`,
    `  <link rel="self" type="application/atom+xml" href="${xml(self)}"/>`,
    `  <link rel="alternate" type="text/html" href="${xml(absoluteUrl(site, "/"))}"/>`,
    `  <updated>${(newest ?? now).toISOString()}</updated>`,
    `  <author><name>${xml(settings.title)}</name></author>`,
  ];
  for (const item of items) {
    lines.push(
      "  <entry>",
      `    <title>${xml(item.title)}</title>`,
      `    <id>${xml(item.url)}</id>`,
      `    <link rel="alternate" type="text/html" href="${xml(item.url)}"/>`,
      ...(item.published ? [`    <published>${item.published.toISOString()}</published>`] : []),
      `    <updated>${updated(item)}</updated>`,
      ...(item.summary ? [`    <summary>${xml(item.summary)}</summary>`] : []),
      "  </entry>",
    );
  }
  lines.push("</feed>");
  return `${lines.join("\n")}\n`;
}

/** The feeds a build writes: RSS and Atom for each collection that has them. */
export function feedFiles(content: SiteContent, now = new Date()): BuildFile[] {
  return feedCollections(content).flatMap((collection) => {
    const items = feedItems(content, collection);
    return [
      { path: feedPath(collection.id, "rss"), content: rssFeed(content, collection, items) },
      { path: feedPath(collection.id, "atom"), content: atomFeed(content, collection, items, now) },
    ];
  });
}

/** What pages link to so feed readers find the site's feeds: each collection's RSS feed, with its title. */
export function feedLinks(
  content: Pick<SiteContent, "collections" | "settings">,
): Array<{ title: string; href: string }> {
  return feedCollections(content).map((collection) => ({
    title: feedTitle(collection, content.settings.title),
    href: feedPath(collection.id, "rss"),
  }));
}
