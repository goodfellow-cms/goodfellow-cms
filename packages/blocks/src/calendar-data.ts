import {
  addDays,
  type Collection,
  changesOn,
  datePart,
  datesInMonth,
  dayAfter,
  type Entry,
  type EventValue,
  entryTitle,
  eventFilePath,
  type FeedOccurrence,
  formatDate,
  formatTime,
  isAllDay,
  isEventLike,
  markdownText,
  monthOf,
  occurrences,
  repeatRule,
  richTextToPlainText,
  type SiteSettings,
  zonedInstant,
} from "@goodfellow-cms/core";

// What the Calendar block shows, with no React, so its web and native versions share it.
/** One time something happens, from a collection or another calendar, ready to show. */
export interface CalendarItem {
  key: string;
  start: string;
  end?: string;
  allDay: boolean;
  title: string;
  /** Its page on the site, or its own address in another calendar. */
  href?: string;
  place?: string;
  summary?: string;
  /** For a collection's events, the event itself and its calendar file, for adding it to calendars. */
  event?: EventValue;
  file?: string;
}

type View = "list" | "month";
type WeekStart = "sunday" | "monday";

export interface CalendarProps {
  /** The calendar collection whose events it shows, or empty for none. */
  collection: string;
  /** Another calendar's `.ics` address, such as a public Google Calendar's, read when the site is built. */
  feed: string;
  view: View;
  /** For a list: at most this many, or 0 for all. */
  limit: number;
  /** For a list: how many days ahead it looks. */
  days: number;
  /** For a month at a time: how many months have pages before and after the current one. */
  monthsBefore: number;
  monthsAfter: number;
  weekStart: WeekStart;
  addLabel: string;
  otherCalendarsLabel: string;
  subscribeLabel: string;
  previousLabel: string;
  nextLabel: string;
  emptyText: string;
  /** The other calendar's events, filled in when the site is built. Not a field: editors never see or change it. */
  feedEvents?: FeedOccurrence[];
  className: string;
}

/** A month's last date, as `YYYY-MM-DD`. */
export function lastDate(month: string): string {
  return datesInMonth(month).at(-1) ?? `${month}-28`;
}

function plainField(collection: Collection, field: string | undefined, value: unknown): string | undefined {
  if (!field || typeof value !== "string" || !value.trim()) return undefined;
  if (collection.settings.markdown?.body === field) return markdownText(value);
  const type = collection.settings.fields.find((candidate) => candidate.name === field)?.type;
  return type === "richtext" ? richTextToPlainText(value) : value.trim();
}

/** A collection's events between two dates, one item for each time each happens. */
export function collectionItems(collection: Collection | undefined, from: string, to: string): CalendarItem[] {
  const calendar = collection?.settings.calendar;
  if (!collection || !calendar) return [];
  return collection.entries.flatMap((entry) => {
    const event = entry.content.fields[calendar.when];
    if (!isEventLike(event)) return [];
    const place = plainField(collection, calendar.place, entry.content.fields[calendar.place ?? ""]);
    const summary = plainField(collection, calendar.summary, entry.content.fields[calendar.summary ?? ""]);
    return occurrences(event, { from, to }).map(
      (occurrence): CalendarItem => ({
        key: `${collection.id}/${entry.slug}/${occurrence.start}`,
        ...occurrence,
        title: entryTitle(entry),
        ...(entry.path && { href: entry.path }),
        ...(place && { place }),
        ...(summary && { summary }),
        event,
        file: eventFilePath(collection.id, entry.slug),
      }),
    );
  });
}

export function feedItems(feed: FeedOccurrence[] | undefined, from: string, to: string): CalendarItem[] {
  return (feed ?? [])
    .filter((item) => datePart(item.end ?? item.start) >= from && datePart(item.start) <= to)
    .map((item) => ({
      key: `feed/${item.uid}/${item.start}`,
      start: item.start,
      ...(item.end && { end: item.end }),
      allDay: item.allDay,
      title: item.title,
      ...(item.url && { href: item.url }),
      ...(item.place && { place: item.place }),
      ...(item.description && { summary: item.description }),
    }));
}

/**
 * When a list of the days from `from` to `to` would show something else as the
 * days go by: once an event on it is over, or once the next of a collection's
 * events comes within `days`.
 */
export function listChanges(collection: Collection | undefined, items: CalendarItem[], to: string, days: number): void {
  for (const item of items) changesOn(dayAfter(item));
  const when = collection?.settings.calendar?.when;
  if (!collection || !when) return;
  for (const entry of collection.entries) {
    const event = entry.content.fields[when];
    if (!isEventLike(event)) continue;
    // An event of several days can start within the list and end after it, so it's on it already: the next to
    // come within it is the first that starts after it.
    const next = occurrences(event, { from: addDays(to, 1), to: "9999-12-31", limit: 2 }).find(
      (occurrence) => datePart(occurrence.start) > to,
    );
    if (next) changesOn(addDays(datePart(next.start), -days));
  }
}

export function sortItems(items: CalendarItem[]): CalendarItem[] {
  // All-day events come before timed ones on the same day.
  const key = (item: CalendarItem) => (item.allDay ? `${item.start}T00:00!` : item.start);
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
}

/** The times on a day's line: "7:00 PM – 9:00 PM"; for an all-day event, the days it lasts, if more than one. */
export function timeText(item: CalendarItem, language: string): string {
  if (item.allDay) {
    if (!item.end || item.end === item.start) return "";
    return `${formatDate(item.start, language, "medium")} – ${formatDate(item.end, language, "medium")}`;
  }
  const start = formatTime(item.start, language);
  if (!item.end) return start;
  return datePart(item.end) === datePart(item.start)
    ? `${start} – ${formatTime(item.end, language)}`
    : `${start} – ${formatDate(datePart(item.end), language, "medium")}, ${formatTime(item.end, language)}`;
}

// Adding to calendars -----------------------------------------------------------

function compact(value: string): string {
  return value.replace(/[-:]/g, "");
}

/** A Google Calendar link that adds an event, with its repeats. */
export function googleCalendarLink(item: CalendarItem, settings: SiteSettings, siteUrl?: string): string {
  const params = new URLSearchParams({ action: "TEMPLATE", text: item.title });
  if (item.allDay) {
    params.set("dates", `${compact(item.start)}/${compact(addDays(item.end ?? item.start, 1))}`);
  } else {
    const end = item.end ?? `${datePart(item.start)}T${item.start.slice(11)}`;
    params.set("dates", `${compact(item.start)}00/${compact(end)}00`);
    if (settings.timeZone) params.set("ctz", settings.timeZone);
  }
  const details = [item.summary, item.href && siteUrl ? new URL(item.href, siteUrl).href : item.href]
    .filter(Boolean)
    .join("\n\n");
  if (details) params.set("details", details);
  if (item.place) params.set("location", item.place);
  const rule = item.event && repeatRule(item.event, settings.timeZone);
  if (rule) params.set("recur", `RRULE:${rule}`);
  return `https://calendar.google.com/calendar/render?${params}`;
}

/** An Outlook.com link that adds an event. Outlook's links can't repeat, so it adds the first time. */
export function outlookLink(item: CalendarItem, settings: SiteSettings): string {
  const params = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: item.title });
  if (item.allDay) {
    params.set("startdt", item.start);
    params.set("enddt", addDays(item.end ?? item.start, 1));
    params.set("allday", "true");
  } else {
    params.set("startdt", zonedInstant(item.start, settings.timeZone).toISOString());
    params.set("enddt", zonedInstant(item.end ?? item.start, settings.timeZone).toISOString());
  }
  if (item.place) params.set("location", item.place);
  if (item.summary) params.set("body", item.summary);
  return `https://outlook.live.com/calendar/0/action/compose?${params}`;
}

/**
 * What a calendar shows on a page: a month (the page's, or today's) or the
 * days from today, and its events then, in order. A list's `limit` isn't
 * applied, since what it would show next depends on the rest.
 */
export function calendarShows(
  props: Pick<CalendarProps, "view" | "days" | "feedEvents">,
  collection: Collection | undefined,
  today: string,
  pageMonth?: string,
): { month?: string; from: string; to: string; items: CalendarItem[] } {
  const month = props.view === "month" ? (pageMonth ?? monthOf(today)) : undefined;
  const from = month ? `${month}-01` : today;
  const to = month ? lastDate(month) : addDays(today, Math.max(1, props.days));
  const items = sortItems([...collectionItems(collection, from, to), ...feedItems(props.feedEvents, from, to)]);
  return { ...(month && { month }), from, to, items };
}

/** An item's event, for adding it to calendars from its page, or nothing where its collection isn't a calendar. */
export function entryCalendarItem(collection: Collection, entry: Entry): CalendarItem | undefined {
  const calendar = collection.settings.calendar;
  const event = calendar ? entry.content.fields[calendar.when] : undefined;
  if (!calendar || !isEventLike(event)) return undefined;
  const place = plainField(collection, calendar.place, entry.content.fields[calendar.place ?? ""]);
  const summary = plainField(collection, calendar.summary, entry.content.fields[calendar.summary ?? ""]);
  return {
    key: entry.slug,
    start: event.start,
    ...(event.end && { end: event.end }),
    allDay: isAllDay(event.start),
    title: entryTitle(entry),
    ...(entry.path && { href: entry.path }),
    ...(place && { place }),
    ...(summary && { summary }),
    event,
    file: eventFilePath(collection.id, entry.slug),
  };
}
