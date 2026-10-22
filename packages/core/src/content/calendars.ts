/**
 * Calendars in a site: how many months a month-at-a-time Calendar block gives
 * pages (see `withPages`), and the calendar files builds write for collections
 * of events.
 */

import { isEventLike } from "../calendar.js";
import { absoluteUrl } from "../head.js";
import { type CalendarEvent, calendarFile } from "../ics.js";
import { type Collection, entryTitle, richTextToPlainText } from "./collections.js";
import { contentInLanguage, settingsPrefix, siteLanguages } from "./languages.js";
import type { SiteContent } from "./load.js";
import { markdownText } from "./markdown.js";

/** Where builds put calendar files: `/calendars/<collection>.ics`, and `/calendars/<collection>/<slug>.ics` for each event. */
export const CALENDARS_DIR = "calendars";

/** The most months a calendar gives pages before or after the current one. */
export const MAX_CALENDAR_MONTHS = 36;

/**
 * The address of the calendar file of a collection's events, which visitors
 * subscribe to. In the site's other languages, it's under the language's code
 * (`prefix`, see `settingsPrefix()`), with the events in that language.
 */
export function calendarFilePath(collection: string, prefix = ""): string {
  return `${prefix}/${CALENDARS_DIR}/${collection}.ics`;
}

/** The address of one event's calendar file, for adding it to a calendar. */
export function eventFilePath(collection: string, slug: string): string {
  return `/${CALENDARS_DIR}/${collection}/${slug}.ics`;
}

/** How many months a month-at-a-time calendar shows before and after the current one. */
export interface CalendarMonths {
  before: number;
  after: number;
}

function monthCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, MAX_CALENDAR_MONTHS)
    : fallback;
}

/** The months a Calendar block set to a month at a time shows, read from its props. */
export function calendarMonths(props: Record<string, unknown>): CalendarMonths {
  return { before: monthCount(props.monthsBefore, 1), after: monthCount(props.monthsAfter, 12) };
}

/** The collections that are calendars: ones whose settings name their event field. */
export function calendarCollections(content: Pick<SiteContent, "collections">): Collection[] {
  return content.collections.filter((collection) => collection.settings.calendar);
}

/** A field's value as a calendar's plain text: summaries lose their formatting. */
function plainValue(collection: Collection, field: string | undefined, value: unknown): string | undefined {
  if (!field || typeof value !== "string" || !value.trim()) return undefined;
  if (collection.settings.markdown?.body === field) return markdownText(value);
  const type = collection.settings.fields.find((candidate) => candidate.name === field)?.type;
  return type === "richtext" ? richTextToPlainText(value) : value.trim();
}

/** One of a collection's events, with the entry it's from. */
export interface CollectionEvent extends CalendarEvent {
  slug: string;
}

/** A calendar collection's events, for its calendar files. */
export function collectionEvents(collection: Collection, siteUrl?: string): CollectionEvent[] {
  const calendar = collection.settings.calendar;
  if (!calendar) return [];
  const host = siteUrl ? new URL(siteUrl).hostname : "goodfellow.invalid";
  return collection.entries.flatMap((entry): CollectionEvent[] => {
    const event = entry.content.fields[calendar.when];
    if (!isEventLike(event)) return [];
    const place = plainValue(collection, calendar.place, entry.content.fields[calendar.place ?? ""]);
    const description = plainValue(collection, calendar.summary, entry.content.fields[calendar.summary ?? ""]);
    return [
      {
        slug: entry.slug,
        uid: `${collection.id}-${entry.slug}@${host}`,
        title: entryTitle(entry),
        event,
        ...(place && { place }),
        ...(description && { description }),
        ...(siteUrl && entry.path && { url: absoluteUrl(siteUrl, entry.path) }),
      },
    ];
  });
}

/** A file a build writes, by its address on the site. */
export interface BuildFile {
  path: string;
  content: string;
}

/**
 * The calendar files a build writes: one for each calendar collection, which
 * visitors subscribe to, and one for each of its events, which visitors add to
 * their calendars. A site in several languages has a collection's file for
 * each, with the events in that language.
 */
export function calendarFiles(content: SiteContent, now = new Date()): BuildFile[] {
  return siteLanguages(content.settings).flatMap((language) =>
    languageCalendarFiles(contentInLanguage(content, language.code), now),
  );
}

function languageCalendarFiles(content: SiteContent, now: Date): BuildFile[] {
  const { settings } = content;
  const options = { timeZone: settings.timeZone, now };
  const prefix = settingsPrefix(settings);
  return calendarCollections(content).flatMap((collection) => {
    const events = collectionEvents(collection, settings.url);
    const name = `${collection.settings.name} – ${settings.title}`;
    // A site in one language has a file for each collection; in several, one for each language that has events.
    if (prefix && events.length === 0) return [];
    return [
      { path: calendarFilePath(collection.id, prefix), content: calendarFile(events, { ...options, name }) },
      ...events.map(({ slug, ...event }) => ({
        path: eventFilePath(collection.id, slug),
        content: calendarFile([event], { ...options, name: event.title }),
      })),
    ];
  });
}
