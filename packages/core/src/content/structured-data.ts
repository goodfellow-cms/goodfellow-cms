/**
 * Structured data for search engines (schema.org, as JSON-LD): the site
 * itself on its home page, and on items' pages, events with their dates and
 * places, or articles with their dates. Search engines use it to show events
 * and news as such in their results. Its addresses must be full ones, so a
 * site has it only once its address is set.
 */
import { isEventLike, shownOccurrence, todayIn, zonedInstant, zonedTime, zoneOffset } from "../calendar.js";
import { absoluteUrl, getPageHead } from "../head.js";
import { type Collection, type Entry, richTextToPlainText } from "./collections.js";
import { dateField, entryDetails } from "./entry-details.js";
import { contentForPage, isLanguageHome } from "./languages.js";
import { findEntry, type Page, type SiteContent } from "./load.js";
import { markdownText } from "./markdown.js";

/** One schema.org thing, such as an `Event`. */
export type StructuredData = Record<string, unknown>;

const CONTEXT = "https://schema.org";

/** A wall-clock time as ISO 8601 with the time zone's offset: `2026-11-29T09:00:00-05:00`. All-day dates stay dates. */
export function zonedIso(local: string, timeZone: string | undefined): string {
  if (!local.includes("T")) return local;
  if (!timeZone) return `${local}:00`;
  const instant = zonedInstant(local, timeZone);
  const offset = zoneOffset(instant.getTime(), timeZone);
  const sign = offset < 0 ? "-" : "+";
  const hours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offset) % 60).padStart(2, "0");
  // The time as it is at that instant, which differs from `local` where clocks skip it, such as 2:30 the
  // night clocks go forward an hour, which happens at 3:30.
  return `${zonedTime(instant, timeZone)}:00${sign}${hours}:${minutes}`;
}

function full(siteUrl: string, address: string | undefined): string | undefined {
  if (!address) return undefined;
  return address.startsWith("/") && !address.startsWith("//") ? absoluteUrl(siteUrl, address) : address;
}

/** The site's own organization, as items name it as their organizer or publisher. */
function organization(content: SiteContent, siteUrl: string): StructuredData {
  const { settings } = content;
  const logo = full(siteUrl, settings.logo?.src);
  const contact = settings.contact;
  return {
    "@type": "Organization",
    name: settings.title,
    url: absoluteUrl(siteUrl, "/"),
    ...(logo && { logo }),
    ...(contact?.email && { email: contact.email }),
    ...(contact?.phone && { telephone: contact.phone }),
    ...(contact?.address && {
      address: { "@type": "PostalAddress", streetAddress: contact.address.replace(/\s*\n\s*/g, ", ") },
    }),
  };
}

/** A field's value as plain text, for places named in a field. */
function fieldText(collection: Collection, entry: Entry, field: string | undefined): string | undefined {
  const value = field ? entry.content.fields[field] : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (collection.settings.markdown?.body === field) return markdownText(value);
  const type = collection.settings.fields.find((candidate) => candidate.name === field)?.type;
  return type === "richtext" ? richTextToPlainText(value) : value.replace(/\s+/g, " ").trim();
}

function eventData(content: SiteContent, collection: Collection, entry: Entry, siteUrl: string, today: string) {
  const calendar = collection.settings.calendar;
  const event = calendar ? entry.content.fields[calendar.when] : undefined;
  if (!calendar || !isEventLike(event)) return undefined;
  const occurrence = shownOccurrence(event, today);
  if (!occurrence) return undefined;
  const { timeZone } = content.settings;
  const details = entryDetails(collection, entry);
  const place = fieldText(collection, entry, calendar.place);
  const image = full(siteUrl, details.image);
  return {
    "@type": "Event",
    name: details.title,
    inLanguage: content.settings.language,
    startDate: zonedIso(occurrence.start, timeZone),
    ...(occurrence.end && { endDate: zonedIso(occurrence.end, timeZone) }),
    eventStatus: `${CONTEXT}/EventScheduled`,
    ...(place && { location: { "@type": "Place", name: place, address: place } }),
    ...(details.summary && { description: details.summary }),
    ...(image && { image: [image] }),
    ...(entry.path && { url: absoluteUrl(siteUrl, entry.path) }),
    organizer: organization(content, siteUrl),
  };
}

function articleData(content: SiteContent, collection: Collection, entry: Entry, siteUrl: string) {
  if (!dateField(collection)) return undefined;
  const details = entryDetails(collection, entry);
  if (!details.date) return undefined;
  const image = full(siteUrl, details.image);
  const publisher = organization(content, siteUrl);
  return {
    "@type": "Article",
    inLanguage: content.settings.language,
    // Search engines show headlines of up to 110 characters.
    headline: details.title.length > 110 ? `${details.title.slice(0, 109)}…` : details.title,
    datePublished: details.date,
    ...(details.summary && { description: details.summary }),
    ...(image && { image: [image] }),
    ...(entry.path && { url: absoluteUrl(siteUrl, entry.path), mainEntityOfPage: absoluteUrl(siteUrl, entry.path) }),
    author: publisher,
    publisher,
  };
}

/**
 * What search engines are told about a page, as schema.org things: the site
 * and its organization on the home page, an event on a calendar item's page,
 * an article on a dated item's page, and nothing on other pages, pages that
 * blocks add, and pages hidden from search engines.
 */
/**
 * Whether search engines are told about a page: only with the Site address,
 * never for a page hidden from them, or one a block adds.
 */
export function describesPage(content: SiteContent, page: Page): boolean {
  const { settings } = contentForPage(content, page);
  if (!settings.url || getPageHead(settings, page).noIndex) return false;
  return !(page.view && page.view.path !== page.path);
}

/**
 * The page's structured data with what its blocks say about themselves
 * (`withStructuredData()` in `@goodfellow-cms/react`): every block's
 * `FAQPage` becomes one, with all their questions, since search engines read
 * one a page; anything else is added as it is.
 */
export function withBlocksData(items: readonly StructuredData[], blocks: readonly StructuredData[]): StructuredData[] {
  const questions = blocks
    .filter((item) => item["@type"] === "FAQPage")
    .flatMap((item) => (Array.isArray(item.mainEntity) ? item.mainEntity : []));
  const others = blocks.filter((item) => item["@type"] !== "FAQPage");
  return [...items, ...others, ...(questions.length > 0 ? [{ "@type": "FAQPage", mainEntity: questions }] : [])];
}

export function structuredData(
  content: SiteContent,
  page: Page,
  today = todayIn(content.settings.timeZone),
): StructuredData[] {
  // In the page's language: its home page is the site in that language, and its items are that language's.
  content = contentForPage(content, page);
  const { settings } = content;
  const siteUrl = settings.url;
  if (!siteUrl || !describesPage(content, page)) return [];
  if (isLanguageHome(settings, page.path) && !page.entry) {
    return [
      {
        "@type": "WebSite",
        name: settings.title,
        url: absoluteUrl(siteUrl, page.path),
        ...(settings.description && { description: settings.description }),
        inLanguage: settings.language,
      },
      organization(content, siteUrl),
    ];
  }
  if (!page.entry) return [];
  const found = findEntry(content, page.entry.collection, page.entry.slug);
  if (!found) return [];
  const { collection, entry } = found;
  const item = collection.settings.calendar
    ? eventData(content, collection, entry, siteUrl, today)
    : articleData(content, collection, entry, siteUrl);
  return item ? [item] : [];
}

/**
 * A page's structured data as the text of a `<script type="application/ld+json">`,
 * or `undefined` for none. `<` is escaped, so no value can end the script.
 */
export function structuredDataScript(items: readonly StructuredData[]): string | undefined {
  if (items.length === 0) return undefined;
  const data = items.length === 1 ? { "@context": CONTEXT, ...items[0] } : { "@context": CONTEXT, "@graph": items };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
