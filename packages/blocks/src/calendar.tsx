import {
  addDays,
  addMonths,
  type Collection,
  calendarFilePath,
  calendarMonths,
  changesOn,
  datePart,
  datesInMonth,
  dayAfter,
  type EventValue,
  entryTitle,
  eventFilePath,
  type FeedOccurrence,
  formatDate,
  formatMonth,
  formatTime,
  isAllDay,
  isEventLike,
  markdownText,
  monthOf,
  monthsAround,
  occurrences,
  readCalendar,
  repeatRule,
  richTextToPlainText,
  type SiteSettings,
  todayIn,
  variantPath,
  WEEKDAYS,
  weekdayName,
  weekdayOf,
  withPages,
  zonedInstant,
} from "@goodfellow-cms/core";
import { classNameField, cx, SiteLink, templateOnly, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import { pagesNotice } from "./listing.js";
import { options } from "./options.js";
import { ADD_TO_CALENDAR_PARTS, CALENDAR_PARTS } from "./parts.js";

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
function lastDate(month: string): string {
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

function feedItems(feed: FeedOccurrence[] | undefined, from: string, to: string): CalendarItem[] {
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
function listChanges(collection: Collection | undefined, items: CalendarItem[], to: string, days: number): void {
  for (const item of items) changesOn(dayAfter(item));
  const when = collection?.settings.calendar?.when;
  if (!collection || !when) return;
  for (const entry of collection.entries) {
    const event = entry.content.fields[when];
    if (!isEventLike(event)) continue;
    const [next] = occurrences(event, { from: addDays(to, 1), to: "9999-12-31", limit: 1 });
    if (next) changesOn(addDays(datePart(next.start), -days));
  }
}

function sortItems(items: CalendarItem[]): CalendarItem[] {
  // All-day events come before timed ones on the same day.
  const key = (item: CalendarItem) => (item.allDay ? `${item.start}T00:00!` : item.start);
  return [...items].sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title));
}

/** The times on a day's line: "7:00 PM – 9:00 PM"; for an all-day event, the days it lasts, if more than one. */
function timeText(item: CalendarItem, language: string): string {
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

function AddLinks({
  item,
  label,
  otherLabel,
  className,
}: {
  item: CalendarItem;
  label: string;
  otherLabel: string;
  className?: string;
}) {
  const { settings } = useSite();
  const part = useParts();
  if (!label) return null;
  const link = part("gf-add-to-calendar-link", "hover:underline");
  return (
    <details className={part("gf-add-to-calendar", "group text-sm", className)}>
      <summary
        className={part("gf-add-to-calendar-label", "cursor-pointer text-primary underline-offset-2 hover:underline")}
      >
        {label}
      </summary>
      <ul className={part("gf-add-to-calendar-links", "mt-2 flex flex-col gap-1 border-l-2 border-border pl-3")}>
        <li>
          <SiteLink href={googleCalendarLink(item, settings, settings.url)} className={link}>
            Google Calendar
          </SiteLink>
        </li>
        <li>
          <SiteLink href={outlookLink(item, settings)} className={link}>
            Outlook.com
          </SiteLink>
        </li>
        {item.file && otherLabel && (
          <li>
            <SiteLink href={item.file} download className={link}>
              {otherLabel}
            </SiteLink>
          </li>
        )}
      </ul>
    </details>
  );
}

/** Links for subscribing to a collection's calendar file, so visitors' calendars keep up with it. */
function SubscribeLinks({ collection, label, otherLabel }: { collection: string; label: string; otherLabel: string }) {
  const { settings } = useSite();
  const part = useParts();
  if (!label) return null;
  const file = calendarFilePath(collection);
  const address = settings.url ? new URL(file.slice(1), `${settings.url.replace(/\/?$/, "/")}`).href : undefined;
  const webcal = address?.replace(/^https?:/, "webcal:");
  return (
    <details className={part("gf-calendar-subscribe", "mt-6 text-sm")}>
      <summary
        className={part(
          "gf-calendar-subscribe-label",
          "cursor-pointer text-primary underline-offset-2 hover:underline",
        )}
      >
        {label}
      </summary>
      <ul className={part("gf-calendar-subscribe-links", "mt-2 flex flex-col gap-1 border-l-2 border-border pl-3")}>
        {webcal && (
          <li>
            <SiteLink
              href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`}
              className={part("gf-calendar-subscribe-link")}
            >
              Google Calendar
            </SiteLink>
          </li>
        )}
        {webcal && (
          <li>
            <SiteLink href={webcal} className={part("gf-calendar-subscribe-link")}>
              {otherLabel}
            </SiteLink>
          </li>
        )}
        <li>
          <SiteLink href={file} download className={part("gf-calendar-subscribe-link")}>
            {webcal ? `${file.slice(file.lastIndexOf("/") + 1)}` : otherLabel}
          </SiteLink>
        </li>
      </ul>
    </details>
  );
}

// The views -------------------------------------------------------------------

function ItemTitle({ item }: { item: CalendarItem }) {
  const part = useParts();
  return item.href ? (
    <SiteLink href={item.href} className={part("gf-calendar-event-title", "font-medium hover:underline")}>
      {item.title}
    </SiteLink>
  ) : (
    <span className={part("gf-calendar-event-title", "font-medium")}>{item.title}</span>
  );
}

function ListView({ items, props }: { items: CalendarItem[]; props: CalendarProps }) {
  const { settings } = useSite();
  const part = useParts();
  const language = settings.language;
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const date = datePart(item.start);
    byDate.set(date, [...(byDate.get(date) ?? []), item]);
  }
  return (
    <ol className={part("gf-calendar-days", "flex flex-col gap-6")}>
      {[...byDate].map(([date, dayItems]) => (
        <li key={date} className={part("gf-calendar-day")}>
          <h2 className={part("gf-calendar-day-heading", "font-heading text-lg font-semibold")}>
            <time dateTime={date}>{formatDate(date, language)}</time>
          </h2>
          <ul className={part("gf-calendar-events", "mt-2 flex flex-col divide-y divide-border")}>
            {dayItems.map((item) => (
              <li key={item.key} className={part("gf-calendar-event", "flex flex-col gap-1 py-3 sm:flex-row sm:gap-6")}>
                <span className={part("gf-calendar-event-time", "shrink-0 text-muted-foreground sm:w-44")}>
                  {timeText(item, language)}
                </span>
                <div className={part("gf-calendar-event-body", "flex flex-col gap-1")}>
                  <ItemTitle item={item} />
                  {item.place && (
                    <span className={part("gf-calendar-event-place", "text-sm text-muted-foreground")}>
                      {item.place}
                    </span>
                  )}
                  {item.summary && (
                    <p className={part("gf-calendar-event-summary", "line-clamp-3 text-sm text-muted-foreground")}>
                      {item.summary}
                    </p>
                  )}
                  {item.event && <AddLinks item={item} label={props.addLabel} otherLabel={props.otherCalendarsLabel} />}
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

function MonthView({
  month,
  items,
  props,
  today,
  isEditing,
}: {
  month: string;
  items: CalendarItem[];
  props: CalendarProps & { id?: string };
  today: string;
  isEditing: boolean;
}) {
  const { settings, path, view } = useSite();
  const part = useParts();
  const language = settings.language;
  const order = props.weekStart === "monday" ? WEEKDAYS : (["su", "mo", "tu", "we", "th", "fr", "sa"] as const);
  const dates = datesInMonth(month);
  // Empty days before the 1st and after the month's last day fill out its first and last weeks.
  const leading = order.indexOf(weekdayOf(dates[0] ?? `${month}-01`));
  const trailing = (7 - ((leading + dates.length) % 7)) % 7;
  const blank = (key: string) => (
    <li key={key} aria-hidden="true" className={part("gf-calendar-month-blank", "bg-muted", "hidden sm:block")} />
  );

  // Month pages are the calendar's page with the month after it; the page itself shows the current month. Only
  // the block the page's other pages are for links to them (see `currentListing()`).
  const linked = view !== undefined && view.block === props.id;
  const page = linked ? view.path : path;
  const { before, after } = calendarMonths(props as unknown as Record<string, unknown>);
  const current = monthOf(today);
  const previous = addMonths(month, -1);
  const next = addMonths(month, 1);
  const hasPage = (candidate: string) =>
    linked && candidate >= addMonths(current, -before) && candidate <= addMonths(current, after);
  const linkTo = (candidate: string) => (candidate === current ? page : variantPath(page, candidate));

  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    // Events lasting several days show on each of them.
    for (let date = datePart(item.start); date <= datePart(item.end ?? item.start); date = addDays(date, 1)) {
      if (date.startsWith(month)) byDate.set(date, [...(byDate.get(date) ?? []), item]);
      if (date > lastDate(month)) break;
    }
  }

  return (
    <div className={part("gf-calendar-month", "flex flex-col gap-4")}>
      {isEditing && !linked && (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          {pagesNotice(view, "month")}
        </p>
      )}
      {/* Equal columns either side keep the month's name in the middle, with or without links beside it. */}
      <div className={part("gf-calendar-month-header", "grid grid-cols-[1fr_auto_1fr] items-center gap-4")}>
        {hasPage(previous) ? (
          <SiteLink
            href={linkTo(previous)}
            className={part("gf-calendar-month-link", "text-sm text-primary hover:underline", "justify-self-start")}
            aria-label={props.previousLabel}
          >
            ← {formatMonth(previous, language)}
          </SiteLink>
        ) : (
          <span />
        )}
        <h2 className={part("gf-calendar-month-title", "text-center font-heading text-2xl font-bold")}>
          {formatMonth(month, language)}
        </h2>
        {hasPage(next) ? (
          <SiteLink
            href={linkTo(next)}
            className={part(
              "gf-calendar-month-link",
              "text-right text-sm text-primary hover:underline",
              "justify-self-end",
            )}
            aria-label={props.nextLabel}
          >
            {formatMonth(next, language)} →
          </SiteLink>
        ) : (
          <span />
        )}
      </div>
      <div
        aria-hidden="true"
        className={part(
          "gf-calendar-weekdays",
          "grid-cols-7 gap-px text-center text-sm text-muted-foreground",
          "hidden sm:grid",
        )}
      >
        {order.map((day) => (
          <span key={day}>{weekdayName(day, language)}</span>
        ))}
      </div>
      <ol
        className={part(
          "gf-calendar-month-days",
          "grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-7",
        )}
      >
        {Array.from({ length: leading }, (_, index) => blank(`before-${index}`))}
        {dates.map((date) => {
          const dayItems = byDate.get(date) ?? [];
          return (
            <li
              key={date}
              className={part(
                "gf-calendar-month-day",
                "flex-col gap-1 bg-background p-2 sm:min-h-24",
                // Which days show on phones, and today's mark, whatever the theme gives days.
                dayItems.length ? "flex" : "hidden sm:flex",
                date === today && "ring-2 ring-primary ring-inset",
              )}
            >
              <time dateTime={date} className={part("gf-calendar-month-date", "text-sm font-semibold")}>
                <span className="sm:hidden">{formatDate(date, language)}</span>
                <span className="hidden sm:inline">{Number(date.slice(8))}</span>
              </time>
              {dayItems.length > 0 && (
                <ul className={part("gf-calendar-month-events", "flex flex-col gap-1 text-sm")}>
                  {dayItems.map((item) => (
                    <li key={item.key} className={part("gf-calendar-month-event", "leading-snug")}>
                      {!item.allDay && datePart(item.start) === date && (
                        <span className={part("gf-calendar-event-time", "text-muted-foreground")}>
                          {formatTime(item.start, language)}{" "}
                        </span>
                      )}
                      <ItemTitle item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        {Array.from({ length: trailing }, (_, index) => blank(`after-${index}`))}
      </ol>
      {byDate.size === 0 && props.emptyText && (
        <p className={part("gf-calendar-empty", "text-muted-foreground")}>{props.emptyText}</p>
      )}
    </div>
  );
}

function CalendarView({ isEditing, ...props }: CalendarProps & { id?: string; isEditing: boolean }) {
  const { collections, settings, view } = useSite();
  const part = useParts();
  const pageMonth = view && view.block === props.id ? view.month : undefined;
  const collection = collections.find((candidate) => candidate.id === props.collection);
  const today = todayIn(settings.timeZone);

  if (!collection?.settings.calendar && !props.feed) {
    return isEditing ? (
      <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", props.className)}>
        Choose a collection of events, or another calendar's address.
      </p>
    ) : null;
  }

  const month = props.view === "month" ? (pageMonth ?? monthOf(today)) : undefined;
  const from = month ? `${month}-01` : today;
  const to = month ? lastDate(month) : addDays(today, Math.max(1, props.days));
  let items = sortItems([...collectionItems(collection, from, to), ...feedItems(props.feedEvents, from, to)]);
  // A month marks today, so it's different every day; a list once something on it is over or comes within it.
  if (month) changesOn(addDays(today, 1));
  else listChanges(collection, items, to, Math.max(1, props.days));
  if (!month && props.limit > 0) items = items.slice(0, props.limit);

  return (
    <div className={part("gf-calendar", "flex flex-col", props.className)}>
      {props.feed && isEditing && (
        <p className="mb-4 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
          Events from {props.feed} are added when the site is built.
        </p>
      )}
      {month ? (
        <MonthView month={month} items={items} props={props} today={today} isEditing={isEditing} />
      ) : items.length > 0 ? (
        <ListView items={items} props={props} />
      ) : (
        props.emptyText && <p className={part("gf-calendar-empty", "text-muted-foreground")}>{props.emptyText}</p>
      )}
      {collection?.settings.calendar && (
        <SubscribeLinks
          collection={collection.id}
          label={props.subscribeLabel}
          otherLabel={props.otherCalendarsLabel}
        />
      )}
    </div>
  );
}

// Reading other calendars -------------------------------------------------------

/** How long a build reuses another calendar it has read. */
const FEED_CACHE_MS = 10 * 60_000;
const FEED_LIMIT = 10 * 1024 * 1024;
const feedCache = new Map<string, { at: number; text: Promise<string> }>();

/** Fetches another calendar's file, from an `https://` or `webcal://` address, once every few minutes. */
export async function fetchFeed(address: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = address.trim().replace(/^webcals?:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) throw new Error("The calendar's address must start with https:// or webcal://.");
  const cached = feedCache.get(url);
  if (cached && Date.now() - cached.at < FEED_CACHE_MS) return cached.text;
  const text = (async () => {
    const response = await fetcher(url, { headers: { accept: "text/calendar" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`The calendar's address answered ${response.status}.`);
    const body = await response.text();
    if (body.length > FEED_LIMIT) throw new Error("The calendar is too large to read.");
    return body;
  })();
  feedCache.set(url, { at: Date.now(), text });
  text.catch(() => feedCache.delete(url));
  return text;
}

/** The dates a calendar shows, for reading another calendar's events. */
function feedWindow(props: CalendarProps, today: string): { from: string; to: string } {
  if (props.view === "month") {
    const { before, after } = calendarMonths(props as unknown as Record<string, unknown>);
    return { from: `${addMonths(monthOf(today), -before)}-01`, to: lastDate(addMonths(monthOf(today), after)) };
  }
  return { from: today, to: addDays(today, Math.max(1, props.days)) };
}

/** Another calendar's events, for a Calendar block's props. Problems are printed, and leave the calendar without them. */
export async function readFeed(
  props: CalendarProps,
  settings: Pick<SiteSettings, "timeZone">,
  fetcher?: typeof fetch,
): Promise<FeedOccurrence[] | undefined> {
  if (!props.feed.trim()) return undefined;
  try {
    const today = todayIn(settings.timeZone);
    // Another calendar may change at any time, so the site is built again tomorrow at the latest.
    changesOn(addDays(today, 1));
    return readCalendar(await fetchFeed(props.feed, fetcher), {
      timeZone: settings.timeZone,
      ...feedWindow(props, today),
    });
  } catch (error) {
    console.warn(
      `The calendar at ${props.feed} couldn't be read, so the page is built without it: ${(error as Error).message}`,
    );
    return undefined;
  }
}

const calendarFields: Fields<CalendarProps> = {
  collection: { type: "select", label: "Events", options: [] },
  feed: { type: "text", label: "Another calendar's address (.ics), such as a public Google Calendar's" },
  view: { type: "radio", label: "Show", options: options({ list: "A list", month: "A month at a time" }) },
  limit: { type: "number", label: "How many (0 for all)", min: 0 },
  days: { type: "number", label: "How many days ahead", min: 1 },
  monthsBefore: { type: "number", label: "Earlier months visitors can see", min: 0, max: 36 },
  monthsAfter: { type: "number", label: "Later months visitors can see", min: 0, max: 36 },
  weekStart: { type: "radio", label: "Weeks start on", options: options({ sunday: "Sunday", monday: "Monday" }) },
  addLabel: { type: "text", label: '"Add to calendar" link (leave empty for none)' },
  subscribeLabel: { type: "text", label: '"Subscribe" link (leave empty for none)' },
  otherCalendarsLabel: { type: "text", label: "Name for other calendar apps" },
  previousLabel: { type: "text", label: "Previous month's link, for screen readers" },
  nextLabel: { type: "text", label: "Next month's link, for screen readers" },
  emptyText: { type: "text", label: "Text when there's nothing to show" },
  className: classNameField,
};

/**
 * Upcoming events, as a list or a month at a time, from a calendar collection,
 * another calendar's `.ics` address, or both. A month at a time gives the page
 * a page for each month around today's (see `withPages`), which builds write.
 */
const calendar: ComponentConfig<CalendarProps> = {
  label: "Calendar",
  fields: calendarFields,
  defaultProps: {
    collection: "",
    feed: "",
    view: "list",
    limit: 10,
    days: 90,
    monthsBefore: 1,
    monthsAfter: 12,
    weekStart: "sunday",
    addLabel: "Add to calendar",
    subscribeLabel: "Subscribe to this calendar",
    otherCalendarsLabel: "Apple Calendar and others",
    previousLabel: "Previous month",
    nextLabel: "Next month",
    emptyText: "Nothing is planned yet.",
    className: "",
  },
  resolveFields: ({ props }, { fields, metadata }) => {
    const collections = ((metadata.collections as Collection[] | undefined) ?? []).filter(
      (collection) => collection.settings.calendar,
    );
    const resolved: Partial<Fields<CalendarProps>> = {
      ...fields,
      collection: {
        type: "select",
        label: "Events",
        options: [{ label: "None", value: "" }, ...collections.map((c) => ({ label: c.settings.name, value: c.id }))],
      },
    };
    if (props.view === "month") {
      delete resolved.limit;
      delete resolved.days;
      delete resolved.addLabel;
    } else {
      delete resolved.monthsBefore;
      delete resolved.monthsAfter;
      delete resolved.weekStart;
      delete resolved.previousLabel;
      delete resolved.nextLabel;
    }
    return resolved as Fields<CalendarProps>;
  },
  // Other calendars are read where pages are built, never in the editor: browsers can't read most of them,
  // and their events aren't part of the page's content.
  resolveData: async ({ props }, { metadata }) => {
    if (typeof document !== "undefined" || !props.feed?.trim()) return { props: { ...props, feedEvents: undefined } };
    const settings = (metadata.site as SiteSettings | undefined) ?? { timeZone: undefined };
    return { props: { ...props, feedEvents: await readFeed(props, settings) } };
  },
  render: ({ puck, ...props }) => <CalendarView {...props} isEditing={puck.isEditing} />,
};

export const Calendar = withPages(withParts(calendar, CALENDAR_PARTS), (props: CalendarProps, { content, today }) => {
  if (props.view !== "month") return [];
  const { before, after } = calendarMonths(props as unknown as Record<string, unknown>);
  return monthsAround(today, before, after).map((month) => ({
    suffix: month,
    month,
    title: formatMonth(month, content.settings.language),
  }));
});

export interface AddToCalendarProps {
  addLabel: string;
  otherCalendarsLabel: string;
  className: string;
}

function AddToCalendarView({ addLabel, otherCalendarsLabel, className }: AddToCalendarProps) {
  const { collection, entry } = useSite();
  const calendar = collection?.settings.calendar;
  if (!entry || !collection) {
    return (
      <p className={cx("rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground", className)}>
        {calendar ? addLabel : "This collection isn't a calendar yet: choose its dates in its settings."}
      </p>
    );
  }
  const event = calendar ? entry.content.fields[calendar.when] : undefined;
  if (!calendar || !isEventLike(event)) return null;
  const place = plainField(collection, calendar.place, entry.content.fields[calendar.place ?? ""]);
  const summary = plainField(collection, calendar.summary, entry.content.fields[calendar.summary ?? ""]);
  const item: CalendarItem = {
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
  return <AddLinks item={item} label={addLabel} otherLabel={otherCalendarsLabel} className={className} />;
}

const addToCalendar: ComponentConfig<AddToCalendarProps> = {
  label: "Add to calendar",
  fields: {
    addLabel: { type: "text", label: "Link" },
    otherCalendarsLabel: { type: "text", label: "Name for other calendar apps" },
    className: classNameField,
  },
  defaultProps: { addLabel: "Add to calendar", otherCalendarsLabel: "Apple Calendar and others", className: "" },
  render: (props) => <AddToCalendarView {...props} />,
};

/** Links that add the entry's event to visitors' calendars. Only offered in collection templates. */
export const AddToCalendar = templateOnly(withParts(addToCalendar, ADD_TO_CALENDAR_PARTS));
