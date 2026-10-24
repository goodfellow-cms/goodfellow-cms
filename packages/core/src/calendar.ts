/**
 * Events: the value of a collection's event field ("Date and time"), its
 * repeats, the dates it happens on, and the time zone it's in.
 *
 * Times are written as the site's own wall-clock times (`2026-12-24T19:00`),
 * in its time zone (`timeZone` in `content/site.json`). Arithmetic on them is
 * done as if they were UTC, so a weekly 9:00 event stays at 9:00 across
 * daylight saving changes; only `zonedInstant()` and `zonedTime()` turn them
 * into instants and back.
 *
 * Repeats are expanded by ical.js, Mozilla's iCalendar library, from the same
 * rules the site's calendar files give other calendars (`repeatRule()`).
 */

import ICAL from "ical.js";
import { changesOn } from "./build-record.js";

export const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** How an event repeats. */
export interface EventRepeat {
  /** Every `interval` days, weeks, months or years. */
  every: "day" | "week" | "month" | "year";
  /** Defaults to 1. */
  interval?: number;
  /** For weekly repeats, the days of the week it happens on. Defaults to the start's. */
  days?: Weekday[];
  /**
   * For monthly repeats: on the start's date (`date`, the default), on the same
   * weekday of the month, such as the second Tuesday (`weekday`), or on the
   * last such weekday of the month (`last`).
   */
  on?: "date" | "weekday" | "last";
  /** The last date it can happen on, as `YYYY-MM-DD`. */
  until?: string;
  /** Dates it doesn't happen on, as `YYYY-MM-DD`. */
  skip?: string[];
}

/** The value of an event field. */
export interface EventValue {
  /** `YYYY-MM-DD` for an all-day event, or `YYYY-MM-DDTHH:MM`, in the site's time zone. */
  start: string;
  /** In the same form as `start`. For an all-day event, its last day. */
  end?: string;
  repeat?: EventRepeat;
}

/** One time an event happens. */
export interface Occurrence {
  /** In the same form as the event's `start`. */
  start: string;
  end?: string;
  allDay: boolean;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A wall-clock date or time as milliseconds, as if it were UTC. `undefined` if it isn't one. */
export function wallClock(value: string): number | undefined {
  const match = DATE_TIME.exec(value) ?? DATE.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour = "0", minute = "0"] = match.map((part) => part ?? "0");
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const date = new Date(ms);
  // Rejects dates that don't exist, such as February 30, and times such as 25:00.
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month) - 1) return undefined;
  if (Number(hour) > 23 || Number(minute) > 59) return undefined;
  return ms;
}

/** Milliseconds as a wall-clock date (`YYYY-MM-DD`) or time (`YYYY-MM-DDTHH:MM`). */
export function formatWallClock(ms: number, withTime: boolean): string {
  const iso = new Date(ms).toISOString();
  return withTime ? iso.slice(0, 16) : iso.slice(0, 10);
}

/** Whether a value is a date (`YYYY-MM-DD`) rather than a date and time. */
export function isAllDay(value: string): boolean {
  return DATE.test(value);
}

/** The date part of a date or a date and time. */
export function datePart(value: string): string {
  return value.slice(0, 10);
}

/** Adds days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  return formatWallClock((wallClock(date) ?? 0) + days * DAY, false);
}

/** Adds months to a `YYYY-MM` month. */
export function addMonths(month: string, months: number): string {
  const [year = 0, number = 1] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Monday is 0, as in `WEEKDAYS`. */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

/** The weekday of a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[weekdayIndex(wallClock(date) ?? 0)] ?? "mo";
}

// Time zones ------------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** Whether a time zone is one this computer knows, such as `America/New_York`. */
export function isTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone === "") return false;
  try {
    zoneFormat(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock time in a time zone at an instant, as milliseconds as if it were UTC. */
function wallClockAt(instant: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of zoneFormat(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year ?? 1970,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
}

/** A time zone's offset from UTC at an instant, in minutes: -300 for New York in winter. */
export function zoneOffset(instant: number, timeZone: string | undefined): number {
  if (!timeZone || !isTimeZone(timeZone)) return 0;
  return Math.round((wallClockAt(instant, timeZone) - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/**
 * The instant a wall-clock time is in a time zone, or in UTC without one. A
 * time skipped when the clocks go forward becomes the same time an hour later.
 */
export function zonedInstant(local: string, timeZone: string | undefined): Date {
  const clock = wallClock(local) ?? 0;
  if (!timeZone || !isTimeZone(timeZone)) return new Date(clock);
  const first = clock - zoneOffset(clock, timeZone) * MINUTE;
  const second = clock - zoneOffset(first, timeZone) * MINUTE;
  return new Date(zoneOffset(second, timeZone) === zoneOffset(first, timeZone) ? second : Math.max(first, second));
}

/** The wall-clock time in a time zone (or UTC without one) at an instant, as `YYYY-MM-DDTHH:MM`. */
export function zonedTime(instant: Date, timeZone: string | undefined): string {
  const ms = instant.getTime();
  return formatWallClock(timeZone && isTimeZone(timeZone) ? wallClockAt(ms, timeZone) : ms, true);
}

/** Today's date in a time zone (or UTC without one), as `YYYY-MM-DD`. */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  return datePart(zonedTime(now, timeZone));
}

// Event values ----------------------------------------------------------------

/** Whether a value has an event's shape, without checking it further. */
export function isEventLike(value: unknown): value is EventValue {
  return !!value && typeof value === "object" && typeof (value as { start?: unknown }).start === "string";
}

/** What's wrong with an event field's value, in plain words, or `undefined` if nothing is. */
export function eventValueProblem(value: unknown): string | undefined {
  if (!isEventLike(value)) return "must have a start date";
  const { start, end, repeat } = value;
  const startMs = wallClock(start);
  if (startMs === undefined) return "must start on a date written as YYYY-MM-DD, or YYYY-MM-DDTHH:MM with a time";
  if (end !== undefined) {
    const endMs = wallClock(end);
    if (endMs === undefined || isAllDay(end) !== isAllDay(start)) {
      return "must end on a date, or a date and time, written the same way as its start";
    }
    if (endMs < startMs) return "must end after it starts";
  }
  if (repeat === undefined) return undefined;
  if (!repeat || typeof repeat !== "object" || !["day", "week", "month", "year"].includes(repeat.every)) {
    return "must repeat every day, week, month or year";
  }
  if (repeat.interval !== undefined && (!Number.isInteger(repeat.interval) || repeat.interval < 1)) {
    return "must repeat every 1 or more days, weeks, months or years";
  }
  if (repeat.days !== undefined) {
    if (!Array.isArray(repeat.days) || repeat.days.some((day) => !WEEKDAYS.includes(day))) {
      return "must repeat on days of the week written as mo, tu, we, th, fr, sa or su";
    }
  }
  if (repeat.on !== undefined && !["date", "weekday", "last"].includes(repeat.on)) {
    return "must repeat monthly on its date, its weekday or the last such weekday";
  }
  if (repeat.until !== undefined && (!DATE.test(repeat.until) || wallClock(repeat.until) === undefined)) {
    return "must stop repeating on a date written as YYYY-MM-DD";
  }
  if (repeat.skip !== undefined) {
    if (!Array.isArray(repeat.skip) || repeat.skip.some((date) => !DATE.test(date) || wallClock(date) === undefined)) {
      return "must skip dates written as YYYY-MM-DD";
    }
  }
  return undefined;
}

/** An event value with only what it needs: no empty end, no repeat details that don't apply. */
export function cleanEventValue(value: EventValue): EventValue {
  const { start, end, repeat } = value;
  const cleaned: EventValue = { start };
  if (end && end !== start) cleaned.end = end;
  if (repeat) {
    const tidy: EventRepeat = { every: repeat.every };
    if (repeat.interval && repeat.interval > 1) tidy.interval = repeat.interval;
    if (repeat.every === "week" && repeat.days?.length) {
      tidy.days = WEEKDAYS.filter((day) => repeat.days?.includes(day));
    }
    if (repeat.every === "month" && repeat.on && repeat.on !== "date") tidy.on = repeat.on;
    if (repeat.until) tidy.until = repeat.until;
    if (repeat.skip?.length) tidy.skip = [...new Set(repeat.skip)].sort();
    cleaned.repeat = tidy;
  }
  return cleaned;
}

// Repeats ---------------------------------------------------------------------

const ICS_DAYS: Record<Weekday, string> = { mo: "MO", tu: "TU", we: "WE", th: "TH", fr: "FR", sa: "SA", su: "SU" };

/** `2026-12-24T19:00` → `20261224T190000`; `2026-12-24` → `20261224`, as calendar files write them. */
function icsLocal(value: string): string {
  const date = value.slice(0, 10).replace(/-/g, "");
  return isAllDay(value) ? date : `${date}T${value.slice(11, 13)}${value.slice(14, 16)}00`;
}

/** An instant as calendar files write it in UTC: `20261224T190000Z`. */
function icsUtc(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * An event's repeat as a calendar rule (`RRULE`), such as `FREQ=WEEKLY;BYDAY=SU`.
 * With a time zone, a timed event's `UNTIL` is in UTC, as calendar files need;
 * without one, it's the wall-clock end of its last day.
 */
export function repeatRule(event: EventValue, timeZone?: string): string | undefined {
  const repeat = event.repeat;
  if (!repeat) return undefined;
  const parts = [`FREQ=${{ day: "DAILY", week: "WEEKLY", month: "MONTHLY", year: "YEARLY" }[repeat.every]}`];
  if (repeat.interval && repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  const startMs = wallClock(event.start) ?? 0;
  const weekday = WEEKDAYS[weekdayIndex(startMs)] ?? "mo";
  if (repeat.every === "week" && repeat.days?.length) {
    parts.push(`BYDAY=${repeat.days.map((day) => ICS_DAYS[day]).join(",")}`);
  }
  if (repeat.every === "month" && repeat.on === "weekday") {
    parts.push(`BYDAY=${Math.ceil(new Date(startMs).getUTCDate() / 7)}${ICS_DAYS[weekday]}`);
  }
  if (repeat.every === "month" && repeat.on === "last") parts.push(`BYDAY=-1${ICS_DAYS[weekday]}`);
  // Said in full, since some calendars, ical.js among them, otherwise move February 29 to March 1 in other years.
  if (repeat.every === "year" && event.start.slice(5, 10) === "02-29") parts.push("BYMONTH=2;BYMONTHDAY=29");
  if (repeat.until) {
    if (isAllDay(event.start)) parts.push(`UNTIL=${icsLocal(repeat.until)}`);
    else if (timeZone && isTimeZone(timeZone)) {
      parts.push(`UNTIL=${icsUtc(zonedInstant(`${repeat.until}T23:59`, timeZone))}`);
    } else parts.push(`UNTIL=${icsLocal(`${repeat.until}T23:59`)}`);
  }
  return parts.join(";");
}

/** The longest any expansion runs, so a mistyped repeat can't stall a build. */
export const MAX_STEPS = 20_000;

export interface OccurrenceOptions {
  /** The first date to include, as `YYYY-MM-DD`: occurrences that end on or after it. */
  from: string;
  /** The last date to include, as `YYYY-MM-DD`: occurrences that start on or before it. */
  to: string;
  /** At most this many. */
  limit?: number;
}

/**
 * The times an event happens between two dates, oldest first. An occurrence
 * that started before `from` but hasn't ended is included.
 */
export function occurrences(event: EventValue, options: OccurrenceOptions): Occurrence[] {
  const startMs = wallClock(event.start);
  if (startMs === undefined) return [];
  const allDay = isAllDay(event.start);
  const endMs = event.end === undefined ? undefined : wallClock(event.end);
  const duration = endMs === undefined || endMs < startMs ? undefined : endMs - startMs;
  const fromMs = wallClock(options.from);
  const lastMs = wallClock(options.to);
  // Dates that don't exist, such as November 31, would leave the expansion without an end.
  if (fromMs === undefined || lastMs === undefined) return [];
  const toMs = lastMs + DAY - 1;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const skip = new Set(event.repeat?.skip ?? []);

  const found: Occurrence[] = [];
  /** Adds one start, and says whether to go on. */
  const take = (ms: number): boolean => {
    if (ms > toMs) return false;
    const last = ms + (duration ?? 0);
    const ends = allDay ? last + DAY - 1 : last;
    if (ends >= fromMs && !skip.has(formatWallClock(ms, false))) {
      found.push({
        start: formatWallClock(ms, !allDay),
        ...(duration !== undefined && duration > 0 && { end: formatWallClock(ms + duration, !allDay) }),
        allDay,
      });
    }
    return found.length < limit;
  };

  const rule = repeatRule(event);
  if (!rule) {
    take(startMs);
    return found;
  }
  // Wall-clock times, without a time zone, as everything here is.
  const start = new Date(startMs);
  const iterator = ICAL.Recur.fromString(rule).iterator(
    ICAL.Time.fromData({
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      day: start.getUTCDate(),
      ...(!allDay && { hour: start.getUTCHours(), minute: start.getUTCMinutes() }),
    }),
  );
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const next = iterator.next();
    if (!next) break;
    if (!take(Date.UTC(next.year, next.month - 1, next.day, next.hour, next.minute))) break;
  }
  return found;
}

/**
 * The occurrence to show for an event, such as on its own page: its next one
 * on or after a date, or, once none are left, its first.
 */
export function shownOccurrence(event: EventValue, today: string): Occurrence | undefined {
  const first = occurrences(event, { from: "1000-01-01", to: "9999-12-31", limit: 1 })[0];
  if (!event.repeat) return first;
  const next = occurrences(event, { from: today, to: "9999-12-31", limit: 1 })[0];
  // The one after shows once this one is over.
  if (next) changesOn(dayAfter(next));
  return next ?? first;
}

/** Whether an event happens, or is still going on, on or after a date. */
export function isUpcoming(event: EventValue, today: string): boolean {
  const [next] = occurrences(event, { from: today, to: "9999-12-31", limit: 1 });
  if (next) changesOn(dayAfter(next));
  return next !== undefined;
}

/** The first date an occurrence is over on. */
export function dayAfter(occurrence: Occurrence): string {
  return addDays(datePart(occurrence.end ?? occurrence.start), 1);
}

// Writing dates and times -----------------------------------------------------

function safeFormat(language: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(language, { ...options, timeZone: "UTC" });
  } catch {
    return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" });
  }
}

/** A date, written out in a language: "Thursday, December 24, 2026". */
export function formatDate(date: string, language = "en", style: "full" | "long" | "medium" = "full"): string {
  const ms = wallClock(date);
  return ms === undefined ? date : safeFormat(language, { dateStyle: style }).format(new Date(ms));
}

/** A time of day, written in a language: "7:00 PM". */
export function formatTime(dateTime: string, language = "en"): string {
  const ms = wallClock(dateTime);
  return ms === undefined ? dateTime : safeFormat(language, { timeStyle: "short" }).format(new Date(ms));
}

/** A month, written out in a language: "December 2026". */
export function formatMonth(month: string, language = "en"): string {
  const ms = wallClock(`${month}-01`);
  return ms === undefined ? month : safeFormat(language, { year: "numeric", month: "long" }).format(new Date(ms));
}

/** A weekday's short name in a language, Monday first: "Mon". */
export function weekdayName(weekday: Weekday, language = "en", style: "short" | "long" = "short"): string {
  // 2024-01-01 was a Monday.
  return safeFormat(language, { weekday: style }).format(new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(weekday))));
}

/** When an occurrence happens, in words: "Thursday, December 24, 2026, 7:00 PM – 9:00 PM". */
export function formatOccurrence(occurrence: Occurrence, language = "en"): string {
  const { start, end, allDay } = occurrence;
  if (allDay) {
    if (!end || end === start) return formatDate(start, language);
    return `${formatDate(start, language)} – ${formatDate(end, language)}`;
  }
  const from = `${formatDate(datePart(start), language)}, ${formatTime(start, language)}`;
  if (!end) return from;
  const until = datePart(end) === datePart(start) ? formatTime(end, language) : formatOccurrenceStart(end, language);
  return `${from} – ${until}`;
}

function formatOccurrenceStart(dateTime: string, language: string): string {
  return `${formatDate(datePart(dateTime), language)}, ${formatTime(dateTime, language)}`;
}

// Month pages -----------------------------------------------------------------

/** The `YYYY-MM` month a date is in. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whether text is a month written as `YYYY-MM`, such as a month page's last part. */
export function isMonth(text: string): boolean {
  return MONTH.test(text);
}

/** The months from `before` months before a date's month to `after` months after it, oldest first. */
export function monthsAround(today: string, before: number, after: number): string[] {
  const current = monthOf(today);
  changesOn(`${addMonths(current, 1)}-01`);
  const months: string[] = [];
  for (let offset = -Math.max(0, before); offset <= Math.max(0, after); offset++) {
    months.push(addMonths(current, offset));
  }
  return months;
}

/** The dates in a month, as `YYYY-MM-DD`. */
export function datesInMonth(month: string): string[] {
  const [year = 1970, number = 1] = month.split("-").map(Number);
  return Array.from(
    { length: daysInMonth(year, number - 1) },
    (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}
