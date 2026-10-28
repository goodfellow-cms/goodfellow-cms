import { addDays, changesOn, todayIn } from "@goodfellow-cms/core";
import { classNameField, SiteLink, useParts, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface FeedItem {
  title: string;
  link: string;
  date: string;
}

export interface FeedListProps {
  heading: string;
  feed: string;
  limit: number;
  showDates: boolean;
  moreLabel: string;
  moreHref: string;
  emptyText: string;
  className: string;
  /** Read from the feed when the site is built. */
  items?: FeedItem[];
}

/** How long a build reuses a feed it has read. */
const FEED_CACHE_MS = 600_000;
const FEED_LIMIT = 5_242_880;
const feedCache = new Map<string, { at: number; text: Promise<string> }>();

/** Fetches an RSS or Atom feed from an `https://` address, once every few minutes. */
async function fetchFeed(address: string): Promise<string> {
  const url = address.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("The feed's address must start with https://.");
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.at < FEED_CACHE_MS) return cached.text;
  const text = (async () => {
    const response = await fetch(url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`The feed's address answered ${response.status}.`);
    const body = await response.text();
    if (body.length > FEED_LIMIT) throw new Error("The feed is too large to read.");
    return body;
  })();
  feedCache.set(url, { at: Date.now(), text });
  text.catch(() => feedCache.delete(url));
  return text;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A tag's text, without CDATA markers, tags or entities. */
function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (match, name) => entities[name.toLowerCase()] ?? match)
    .trim();
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return decode(match?.[1] ?? "");
}

/** An Atom entry's link: its `alternate` one, or the first. */
function atomLink(xml: string): string {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)].map((match) => match[1] ?? "");
  const chosen = links.find((attrs) => !/rel=["'](?!alternate)/i.test(attrs)) ?? links[0] ?? "";
  return chosen.match(/href=["']([^"']+)["']/i)?.[1] ?? "";
}

/** The titles, links and dates of an RSS or Atom feed's items. Their text and descriptions are left out. */
export function readFeedItems(xml: string): FeedItem[] {
  const rss = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(([, item = ""]) => ({
    title: tag(item, "title"),
    link: tag(item, "link") || tag(item, "guid"),
    date: tag(item, "pubDate") || tag(item, "dc:date"),
  }));
  const items = rss.length
    ? rss
    : [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(([, entry = ""]) => ({
        title: tag(entry, "title"),
        link: atomLink(entry),
        date: tag(entry, "published") || tag(entry, "updated"),
      }));
  return items.filter((item) => item.title && /^https?:\/\//i.test(item.link));
}

function formatDate(date: string, timeZone: string | undefined, language: string | undefined): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(language || "en", { month: "long", day: "numeric", year: "numeric", timeZone });
}

/**
 * The latest items of another site's news feed (RSS or Atom), such as a podcast's episodes or a
 * news site's headlines: each one's title, linking to it, and its date. The feed is read when the
 * site is built, and the block asks for a rebuild the next day, so overnight builds keep it current.
 * Only titles, links and dates are shown, never the items' text.
 */
const FeedList: ComponentConfig<FeedListProps> = withParts(
  {
    label: "News feed",
    fields: {
      heading: { type: "text", label: "Heading (leave empty for none)", contentEditable: true },
      feed: { type: "text", label: "The feed's address (RSS or Atom)", placeholder: "https://example.org/feed.xml" },
      limit: { type: "number", label: "How many", min: 1, max: 50 },
      showDates: {
        type: "radio",
        label: "Show dates",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      },
      moreLabel: { type: "text", label: 'Link under the list, such as "View all" (leave empty for none)' },
      moreHref: { type: "text", label: "Where the link goes" },
      emptyText: { type: "text", label: "Text when the feed can't be read" },
      className: classNameField,
    },
    defaultProps: {
      heading: "",
      feed: "",
      limit: 5,
      showDates: true,
      moreLabel: "",
      moreHref: "",
      emptyText: "Nothing to show right now.",
      className: "",
    },
    resolveData: async ({ props }, { metadata }) => {
      if (typeof document !== "undefined" || !props.feed?.trim()) return { props: { ...props, items: undefined } };
      const site = metadata.site as { timeZone?: string; language?: string } | undefined;
      try {
        // Feeds change daily, so the overnight build should run again tomorrow.
        changesOn(addDays(todayIn(site?.timeZone), 1));
        const items = readFeedItems(await fetchFeed(props.feed))
          .slice(0, Math.max(1, props.limit || 5))
          .map((item) => ({ ...item, date: formatDate(item.date, site?.timeZone, site?.language) }));
        return { props: { ...props, items } };
      } catch (error) {
        console.warn(
          `The feed at ${props.feed} couldn't be read, so the page is built without it: ${(error as Error).message}`,
        );
        return { props: { ...props, items: [] } };
      }
    },
    render: ({ heading, feed, items, showDates, moreLabel, moreHref, emptyText, className, puck }) => {
      const part = useParts();
      return (
        <div className={part("gf-feed-list", "text-foreground", className)}>
          {heading && (
            <h2 className={part("gf-feed-list-heading", "font-heading text-2xl font-semibold")}>{heading}</h2>
          )}
          {items && items.length > 0 ? (
            <ul className={part("gf-feed-list-items", "mt-3 divide-y divide-border")}>
              {items.map((item, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two items can link to the same address
                <li key={`${index}-${item.link}`} className={part("gf-feed-list-item", "py-2")}>
                  <SiteLink href={item.link} className={part("gf-feed-list-link", "font-medium hover:underline")}>
                    {item.title}
                  </SiteLink>
                  {showDates && item.date && (
                    <span className={part("gf-feed-list-date", "block text-sm text-muted-foreground")}>
                      {item.date}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={part("gf-feed-list-empty", "mt-3 text-muted-foreground")}>
              {puck?.isEditing && feed ? `The latest items from ${feed} appear here on the site.` : emptyText}
            </p>
          )}
          {moreLabel && moreHref && (
            <SiteLink
              href={moreHref}
              className={part(
                "gf-feed-list-more",
                "mt-3 inline-block text-sm font-semibold text-primary hover:underline",
              )}
            >
              {moreLabel}
            </SiteLink>
          )}
        </div>
      );
    },
  },
  {
    "gf-feed-list": "News feed",
    "gf-feed-list-heading": "Heading",
    "gf-feed-list-items": "List",
    "gf-feed-list-item": "Item",
    "gf-feed-list-link": "Item's title",
    "gf-feed-list-date": "Item's date",
    "gf-feed-list-empty": "Text when empty",
    "gf-feed-list-more": "Link under the list",
  },
);

export default withKeywords(FeedList, ["rss", "atom", "feed", "news", "podcast", "headlines"]);
