/**
 * Calendar files (iCalendar, `.ics`): writing a site's events for visitors to
 * subscribe to or add to their calendars, and reading a calendar kept
 * elsewhere, such as a public Google Calendar, when the site is built.
 *
 * ical.js, Mozilla's iCalendar library, reads and writes the files and
 * expands their repeats. What it can't do is describe a time zone from its
 * name, so the `VTIMEZONE`s here are worked out from `Intl`.
 */

import ICAL from "ical.js";
import {
  addDays,
  datePart,
  type EventValue,
  formatWallClock,
  isAllDay,
  isTimeZone,
  MAX_STEPS,
  type Occurrence,
  repeatRule,
  WEEKDAYS,
  wallClock,
  zonedInstant,
  zonedTime,
  zoneOffset,
} from "./calendar.js";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// Writing ---------------------------------------------------------------------

/** One of the site's events, for a calendar file. */
export interface CalendarEvent {
  /** Stays the same for as long as the event exists, so calendars update it rather than add it again. */
  uid: string;
  title: string;
  event: EventValue;
  place?: string;
  description?: string;
  /** Its page on the site, as a full address. */
  url?: string;
}

export interface CalendarFileOptions {
  /** The calendar's name, as calendar apps show it. */
  name: string;
  /** The site's time zone. Without one, times are written as they are, for each visitor's own time zone. */
  timeZone?: string;
  /** When the file is written. */
  now?: Date;
}

/** A wall-clock date or time as ical.js's time, without a time zone. */
function icalTime(value: string): ICAL.Time {
  const date = new Date(wallClock(value) ?? 0);
  return ICAL.Time.fromData({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    ...(!isAllDay(value) && { hour: date.getUTCHours(), minute: date.getUTCMinutes() }),
  });
}

/** A property with a date or time, in the site's time zone where it has one. */
function timeProperty(name: string, values: string[], timeZone: string | undefined): ICAL.Property {
  const property = new ICAL.Property(name);
  if (timeZone && !isAllDay(values[0] ?? "")) property.setParameter("tzid", timeZone);
  const times = values.map(icalTime);
  property.resetType(times[0]?.icaltype ?? "date-time");
  if (times.length === 1 && times[0]) property.setValue(times[0]);
  else property.setValues(times);
  return property;
}

/** Calendar apps' own properties for a calendar's name and time zone, which ical.js would write without escaping. */
const CALENDAR_TEXT = ["x-wr-calname", "x-wr-timezone"];

function describeCalendarText(): void {
  const properties = ICAL.design.icalendar.property as Record<string, { defaultType: string }>;
  for (const name of CALENDAR_TEXT) properties[name] ??= { defaultType: "text" };
}

/**
 * Text with every line break as `\n`, which ical.js escapes: it leaves a lone
 * carriage return as it is, which some calendar apps take for the end of a
 * line, so text could start lines of its own.
 */
function text(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function eventComponent(item: CalendarEvent, timeZone: string | undefined, stamp: ICAL.Time): ICAL.Component {
  const { event } = item;
  const vevent = new ICAL.Component("vevent");
  vevent.addPropertyWithValue("uid", item.uid);
  vevent.addPropertyWithValue("dtstamp", stamp);
  vevent.addProperty(timeProperty("dtstart", [event.start], timeZone));
  if (isAllDay(event.start)) {
    // An all-day event's end is the day after its last day.
    vevent.addProperty(timeProperty("dtend", [addDays(event.end ?? event.start, 1)], timeZone));
  } else if (event.end) {
    vevent.addProperty(timeProperty("dtend", [event.end], timeZone));
  }
  const rule = repeatRule(event, timeZone);
  if (rule) vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(rule));
  const skip = event.repeat?.skip ?? [];
  if (rule && skip.length > 0) {
    const time = event.start.slice(10);
    vevent.addProperty(
      timeProperty(
        "exdate",
        skip.map((date) => `${date}${time}`),
        timeZone,
      ),
    );
  }
  vevent.addPropertyWithValue("summary", text(item.title));
  if (item.place) vevent.addPropertyWithValue("location", text(item.place));
  if (item.description) vevent.addPropertyWithValue("description", text(item.description));
  if (item.url) vevent.addPropertyWithValue("url", item.url);
  return vevent;
}

/** The years a calendar's events need its time zone's rules for. */
function yearsFor(events: CalendarEvent[], now: Date): [number, number] {
  const thisYear = now.getUTCFullYear();
  let first = thisYear;
  for (const { event } of events) {
    const year = Number(event.start.slice(0, 4));
    if (Number.isFinite(year) && year < first) first = year;
  }
  return [Math.max(first, thisYear - 5), thisYear + 2];
}

/** Writes a calendar file of a site's events. */
export function calendarFile(events: CalendarEvent[], options: CalendarFileOptions): string {
  const now = options.now ?? new Date();
  const timeZone = isTimeZone(options.timeZone) ? options.timeZone : undefined;
  describeCalendarText();
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//Goodfellow//Calendar//EN");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  calendar.addPropertyWithValue("method", "PUBLISH");
  calendar.addPropertyWithValue("x-wr-calname", text(options.name));
  if (timeZone) {
    calendar.addPropertyWithValue("x-wr-timezone", timeZone);
    const timed = events.some(({ event }) => !isAllDay(event.start));
    if (timed) calendar.addSubcomponent(timeZoneComponent(timeZone, yearsFor(events, now)));
  }
  const stamp = ICAL.Time.fromJSDate(now, true);
  for (const item of events) calendar.addSubcomponent(eventComponent(item, timeZone, stamp));

  // Lines may be 75 bytes long, with the space that continues a folded line, which ical.js doesn't count.
  const foldLength = ICAL.foldLength;
  ICAL.foldLength = 74;
  try {
    return `${calendar.toString()}\r\n`;
  } finally {
    ICAL.foldLength = foldLength;
  }
}

// Time zone definitions -------------------------------------------------------

interface Transition {
  /** The instant the clocks change. */
  at: number;
  from: number;
  to: number;
}

/** When a time zone's offset changes during a year. */
function transitions(timeZone: string, year: number): Transition[] {
  const found: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let previous = Date.UTC(year, 0, 1);
  let offset = zoneOffset(previous, timeZone);
  for (let at = previous + DAY / 4; at <= end; at += DAY / 4) {
    const next = zoneOffset(at, timeZone);
    if (next !== offset) {
      // Narrows it down to the minute.
      let low = previous;
      let high = at;
      while (high - low > MINUTE) {
        const middle = low + Math.floor((high - low) / MINUTE / 2) * MINUTE;
        if (zoneOffset(middle, timeZone) === offset) low = middle;
        else high = middle;
      }
      found.push({ at: high, from: offset, to: next });
      offset = next;
    }
    previous = at;
  }
  return found;
}

/** A transition's yearly rule: the month, weekday and which one of it, such as the last Sunday of March. */
interface YearlyRule {
  month: number;
  weekday: number;
  n: number;
  time: string;
}

function ruleOf(transition: Transition): YearlyRule {
  const local = transition.at + transition.from * MINUTE;
  const date = new Date(local);
  const day = date.getUTCDate();
  const days = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    month: date.getUTCMonth(),
    weekday: (date.getUTCDay() + 6) % 7,
    n: day + 7 > days ? -1 : Math.ceil(day / 7),
    time: formatWallClock(local, true).slice(11),
  };
}

function sameRule(a: YearlyRule, b: YearlyRule): boolean {
  return a.month === b.month && a.weekday === b.weekday && a.n === b.n && a.time === b.time;
}

function utcOffset(minutes: number): ICAL.UtcOffset {
  return new ICAL.UtcOffset({
    factor: minutes < 0 ? -1 : 1,
    hours: Math.floor(Math.abs(minutes) / 60),
    minutes: Math.abs(minutes) % 60,
  });
}

function observance(transition: Transition, rule?: string): ICAL.Component {
  const component = new ICAL.Component(transition.to > transition.from ? "daylight" : "standard");
  component.addPropertyWithValue("dtstart", icalTime(formatWallClock(transition.at + transition.from * MINUTE, true)));
  component.addPropertyWithValue("tzoffsetfrom", utcOffset(transition.from));
  component.addPropertyWithValue("tzoffsetto", utcOffset(transition.to));
  if (rule) component.addPropertyWithValue("rrule", ICAL.Recur.fromString(rule));
  return component;
}

/** A `VTIMEZONE` for a time zone, with yearly rules where its changes follow them. */
function timeZoneComponent(timeZone: string, [first, last]: [number, number]): ICAL.Component {
  const zone = new ICAL.Component("vtimezone");
  zone.addPropertyWithValue("tzid", timeZone);
  const years: Transition[][] = [];
  for (let year = first; year <= last; year++) years.push(transitions(timeZone, year));
  const all = years.flat();

  if (all.length === 0) {
    const offset = zoneOffset(Date.UTC(last, 0, 1), timeZone);
    zone.addSubcomponent(observance({ at: Date.UTC(1970, 0, 1) - offset * MINUTE, from: offset, to: offset }));
    return zone;
  }

  // Zones whose clocks change on the same weekday of the same month each year get one rule for each change.
  const pattern = years[0]?.map(ruleOf) ?? [];
  const regular =
    pattern.length > 0 &&
    years.every(
      (changes) =>
        changes.length === pattern.length &&
        changes.every((change, index) => {
          const expected = pattern[index];
          return expected !== undefined && sameRule(ruleOf(change), expected);
        }),
    );
  if (regular) {
    for (const [index, rule] of pattern.entries()) {
      const firstChange = years[0]?.[index];
      if (!firstChange) continue;
      const day = (WEEKDAYS[rule.weekday] ?? "mo").toUpperCase();
      zone.addSubcomponent(observance(firstChange, `FREQ=YEARLY;BYMONTH=${rule.month + 1};BYDAY=${rule.n}${day}`));
    }
  } else {
    for (const change of all) zone.addSubcomponent(observance(change));
  }
  return zone;
}

// Reading ---------------------------------------------------------------------

/** One time an event in another calendar happens, in the site's time zone. */
export interface FeedOccurrence extends Occurrence {
  uid: string;
  title: string;
  place?: string;
  description?: string;
  url?: string;
}

export interface FeedOptions {
  /** The site's time zone, which the occurrences are given in. */
  timeZone?: string;
  /** The first and last dates to include, as `YYYY-MM-DD`. */
  from: string;
  to: string;
}

/** A feed's calendars, or none if it isn't one. */
function parseCalendars(text: string): ICAL.Component[] {
  try {
    const parsed = ICAL.parse(text);
    // One calendar, or a list of them.
    const roots = (typeof parsed[0] === "string" ? [parsed] : parsed) as unknown[];
    return roots.map((root) => new ICAL.Component(root as never)).filter((root) => root.name === "vcalendar");
  } catch {
    return [];
  }
}

/**
 * Describes the time zones a calendar names but doesn't describe, as most do
 * for the zones `Intl` knows, so ical.js can tell when their times happen.
 */
function addMissingZones(calendar: ICAL.Component, years: [number, number]): void {
  const described = new Set(
    calendar.getAllSubcomponents("vtimezone").map((zone) => String(zone.getFirstPropertyValue("tzid"))),
  );
  for (const event of calendar.getAllSubcomponents("vevent")) {
    for (const property of event.getAllProperties()) {
      const tzid = property.getParameter("tzid");
      const name = Array.isArray(tzid) ? tzid[0] : tzid;
      if (!name || described.has(name) || !isTimeZone(name)) continue;
      calendar.addSubcomponent(timeZoneComponent(name, years));
      described.add(name);
    }
  }
}

/** The site's own times for a feed's: dates stay dates, and times without a time zone are the site's. */
function siteTime(time: ICAL.Time, siteZone: string | undefined): string {
  const date = `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  if (time.isDate) return date;
  if (time.zone === ICAL.Timezone.localTimezone) {
    return `${date}T${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  }
  return zonedTime(new Date(time.toUnixTime() * 1000), siteZone);
}

/** When a feed's time happens, for knowing when to stop expanding a repeat. */
function instantOf(time: ICAL.Time, siteZone: string | undefined): number {
  return time.zone === ICAL.Timezone.localTimezone || time.isDate
    ? zonedInstant(siteTime(time, siteZone), siteZone).getTime()
    : time.toUnixTime() * 1000;
}

/**
 * ical.js moves a yearly February 29 to March 1 in other years, where other
 * calendars skip them, so a feed's plain yearly rule on that date says it in full.
 */
function keepLeapDay(event: ICAL.Event): void {
  const start = event.startDate;
  if (start.month !== 2 || start.day !== 29) return;
  for (const property of event.component.getAllProperties("rrule")) {
    const rule = property.getFirstValue() as ICAL.Recur;
    if (rule.freq !== "YEARLY" || Object.keys(rule.parts).length > 0) continue;
    rule.setComponent("BYMONTH", [2]);
    rule.setComponent("BYMONTHDAY", [29]);
  }
}

function textOf(event: ICAL.Event, name: string): string | undefined {
  const value = event.component.getFirstPropertyValue(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The events in a calendar file between two dates, in the site's time zone,
 * oldest first. Repeats, skipped dates, changed and cancelled occurrences are
 * followed. Anything a feed says that can't be read is left out.
 */
export function readCalendar(text: string, options: FeedOptions): FeedOccurrence[] {
  const siteZone = isTimeZone(options.timeZone) ? options.timeZone : undefined;
  // A day either side, since moving to the site's time zone can change an occurrence's date.
  const stop = zonedInstant(addDays(options.to, 2), siteZone).getTime();
  const years: [number, number] = [Number(options.from.slice(0, 4)) - 1, Number(options.to.slice(0, 4)) + 1];
  const found: FeedOccurrence[] = [];

  for (const calendar of parseCalendars(text)) {
    addMissingZones(calendar, years);
    const events: ICAL.Event[] = [];
    const changes: ICAL.Event[] = [];
    for (const component of calendar.getAllSubcomponents("vevent")) {
      try {
        const event = new ICAL.Event(component);
        // Checks its start can be read, since ical.js reads times only when they're asked for.
        if (!event.startDate) continue;
        (event.isRecurrenceException() ? changes : events).push(event);
      } catch {}
    }
    // Changed occurrences replace the ones their RECURRENCE-ID names; ones without their event stand alone.
    for (const change of changes) {
      const event = events.find((candidate) => candidate.uid === change.uid && candidate.isRecurring());
      if (event) event.relateException(change);
      else events.push(change);
    }

    const add = (item: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
      if (textOf(item, "status")?.toUpperCase() === "CANCELLED") return;
      const first = siteTime(start, siteZone);
      // An all-day event's end is the day after its last day.
      const last = start.isDate && end.isDate ? addDays(siteTime(end, siteZone), -1) : siteTime(end, siteZone);
      const ends = last > first ? last : undefined;
      if (datePart(ends ?? first) < options.from || datePart(first) > options.to) return;
      const url = textOf(item, "url");
      const place = textOf(item, "location");
      const description = textOf(item, "description");
      found.push({
        uid: item.uid ?? first,
        title: textOf(item, "summary") ?? "(no title)",
        start: first,
        ...(ends && { end: ends }),
        allDay: start.isDate,
        ...(place && { place }),
        ...(description && { description }),
        ...(url && /^https?:\/\//i.test(url) && { url }),
      });
    };

    for (const event of events) {
      try {
        if (!event.isRecurring()) {
          add(event, event.startDate, event.endDate);
          continue;
        }
        keepLeapDay(event);
        const iterator = event.iterator();
        for (let steps = 0; steps < MAX_STEPS; steps++) {
          const next = iterator.next();
          if (!next || instantOf(next, siteZone) > stop) break;
          const details = event.getOccurrenceDetails(next);
          add(details.item, details.startDate, details.endDate);
        }
      } catch {
        // Leaves out an event whose times or repeats can't be read.
      }
    }
  }
  return found.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
