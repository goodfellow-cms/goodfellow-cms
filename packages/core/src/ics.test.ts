import { describe, expect, it } from "vitest";
import { repeatRule } from "./calendar.js";
import { calendarFile, readCalendar } from "./ics.js";

const now = new Date("2026-10-10T12:00:00Z");

/** A calendar file's lines, unfolded. */
function lines(text: string): string[] {
  return text.replace(/\r\n /g, "").split("\r\n");
}

describe("writing calendar files", () => {
  it("writes events with their repeats, skipped dates and time zone", () => {
    const text = calendarFile(
      [
        {
          uid: "events-mass@parish.example.org",
          title: "Sunday Mass, with music; all welcome",
          event: {
            start: "2026-10-04T09:00",
            end: "2026-10-04T10:00",
            repeat: { every: "week", days: ["su"], skip: ["2026-12-27"], until: "2027-06-27" },
          },
          place: "Church",
          url: "https://parish.example.org/events/mass",
        },
        {
          uid: "events-fair@parish.example.org",
          title: "Fall fair",
          event: { start: "2026-10-17", end: "2026-10-18" },
        },
      ],
      { name: "Events", timeZone: "America/New_York", now },
    );
    expect(text.endsWith("\r\n")).toBe(true);
    const all = lines(text);
    expect(all).toContain("X-WR-TIMEZONE:America/New_York");
    expect(all).toContain("DTSTART;TZID=America/New_York:20261004T090000");
    expect(all).toContain("DTEND;TZID=America/New_York:20261004T100000");
    expect(all).toContain("RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270628T035900Z");
    expect(all).toContain("EXDATE;TZID=America/New_York:20261227T090000");
    expect(all).toContain("SUMMARY:Sunday Mass\\, with music\\; all welcome");
    // An all-day event's end is the day after its last day.
    expect(all).toContain("DTSTART;VALUE=DATE:20261017");
    expect(all).toContain("DTEND;VALUE=DATE:20261019");
    expect(all).toContain("DTSTAMP:20261010T120000Z");
    // New York's clocks change on the second Sunday of March and the first Sunday of November.
    expect(all).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(all).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(all).toContain("TZOFFSETTO:-0400");
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("writes repeats as calendar rules", () => {
    expect(repeatRule({ start: "2026-10-13T19:00", repeat: { every: "month", on: "weekday", interval: 2 } })).toBe(
      "FREQ=MONTHLY;INTERVAL=2;BYDAY=2TU",
    );
    expect(repeatRule({ start: "2026-10-30", repeat: { every: "month", on: "last", until: "2027-03-31" } })).toBe(
      "FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270331",
    );
    expect(repeatRule({ start: "2026-10-30" })).toBeUndefined();
  });

  it("writes times as they are without a time zone, and zones without changes plainly", () => {
    const floating = lines(
      calendarFile([{ uid: "a", title: "A", event: { start: "2026-10-04T09:00" } }], { name: "A" }),
    );
    expect(floating).toContain("DTSTART:20261004T090000");
    expect(floating.some((line) => line.startsWith("BEGIN:VTIMEZONE"))).toBe(false);
    const tokyo = lines(
      calendarFile([{ uid: "a", title: "A", event: { start: "2026-10-04T09:00" } }], {
        name: "A",
        timeZone: "Asia/Tokyo",
        now,
      }),
    );
    expect(tokyo).toContain("TZOFFSETTO:+0900");
    expect(tokyo.filter((line) => line.startsWith("BEGIN:STANDARD"))).toHaveLength(1);
  });

  it("never lets text start a line of its own", () => {
    const text = calendarFile(
      [{ uid: "a", title: "A\rBEGIN:VEVENT", place: "B\r\nX:Y", event: { start: "2026-10-04" } }],
      { name: "N\rBEGIN:VTODO" },
    );
    expect(text).not.toMatch(/\r(?!\n)/);
    expect(lines(text)).toContain("X-WR-CALNAME:N\\nBEGIN:VTODO");
    expect(lines(text)).toContain("SUMMARY:A\\nBEGIN:VEVENT");
    expect(lines(text)).toContain("LOCATION:B\\nX:Y");
  });
});

describe("reading calendar files", () => {
  const window = { from: "2026-10-01", to: "2026-12-31" };

  it("reads back what it writes", () => {
    const text = calendarFile(
      [
        {
          uid: "mass",
          title: "Sunday Mass",
          event: {
            start: "2026-10-04T09:00",
            end: "2026-10-04T10:00",
            repeat: { every: "week", skip: ["2026-10-11"], until: "2026-10-25" },
          },
          place: "Church",
        },
      ],
      { name: "Events", timeZone: "America/New_York", now },
    );
    const read = readCalendar(text, { ...window, timeZone: "America/New_York" });
    expect(read.map((item) => item.start)).toEqual(["2026-10-04T09:00", "2026-10-18T09:00", "2026-10-25T09:00"]);
    expect(read[0]).toMatchObject({ title: "Sunday Mass", place: "Church", end: "2026-10-04T10:00", allDay: false });
    // The same events seen from London.
    expect(readCalendar(text, { ...window, timeZone: "Europe/London" })[0]?.start).toBe("2026-10-04T14:00");
  });

  it("moves events into the site's time zone, keeping their local time across daylight saving changes", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:choir",
      "DTSTART;TZID=Europe/Berlin:20261020T193000",
      "DTEND;TZID=Europe/Berlin:20261020T210000",
      "RRULE:FREQ=WEEKLY;COUNT=3",
      "SUMMARY:Choir practice",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:utc",
      "DTSTART:20261105T150000Z",
      "SUMMARY:Webinar",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const read = readCalendar(feed, { ...window, timeZone: "America/New_York" });
    expect(read.map((item) => `${item.title} ${item.start}`)).toEqual([
      // Berlin's clocks change a week before New York's.
      "Choir practice 2026-10-20T13:30",
      "Choir practice 2026-10-27T14:30",
      "Choir practice 2026-11-03T13:30",
      "Webinar 2026-11-05T10:00",
    ]);
  });

  it("follows skipped dates, changed and cancelled occurrences, and multi-day events", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:group",
      "DTSTART;TZID=America/New_York:20261001T180000",
      "RRULE:FREQ=WEEKLY",
      "EXDATE;TZID=America/New_York:20261008T180000",
      "SUMMARY:Youth group",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:group",
      "RECURRENCE-ID;TZID=America/New_York:20261015T180000",
      "DTSTART;TZID=America/New_York:20261015T190000",
      "SUMMARY:Youth group (later this week)",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:retreat",
      "DTSTART;VALUE=DATE:20261023",
      "DTEND;VALUE=DATE:20261026",
      "SUMMARY:Retreat\\, with a talk",
      "LOCATION:Hill House",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:off",
      "STATUS:CANCELLED",
      "DTSTART:20261020T150000Z",
      "SUMMARY:Cancelled",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
    const read = readCalendar(feed, { from: "2026-10-01", to: "2026-10-25", timeZone: "America/New_York" });
    expect(read.map((item) => `${item.start} ${item.title}`)).toEqual([
      "2026-10-01T18:00 Youth group",
      "2026-10-15T19:00 Youth group (later this week)",
      "2026-10-22T18:00 Youth group",
      "2026-10-23 Retreat, with a talk",
    ]);
    expect(read[3]).toMatchObject({ end: "2026-10-25", allDay: true, place: "Hill House" });
  });

  it("uses a feed's own time zone definitions for names it doesn't know", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:Eastern Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:16010101T020000",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:16010101T020000",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:summer",
      "DTSTART;TZID=Eastern Standard Time:20261010T090000",
      "SUMMARY:Summer time",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:winter",
      "DTSTART;TZID=Eastern Standard Time:20261210T090000",
      "SUMMARY:Winter time",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const read = readCalendar(feed, { ...window, timeZone: "UTC" });
    expect(read.map((item) => item.start)).toEqual(["2026-10-10T13:00", "2026-12-10T14:00"]);
  });

  it("follows rules the site's own events don't have", () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:council",
      "DTSTART;TZID=America/New_York:20261005T190000",
      "DURATION:PT90M",
      "RRULE:FREQ=MONTHLY;BYDAY=1MO,3MO;COUNT=4",
      "RDATE;TZID=America/New_York:20261028T190000",
      "SUMMARY:Parish council",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:birthday",
      "DTSTART;VALUE=DATE:20240229",
      "RRULE:FREQ=YEARLY",
      "SUMMARY:Leap-day birthday",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const read = readCalendar(feed, { from: "2026-10-01", to: "2028-12-31", timeZone: "America/New_York" });
    expect(read.filter((item) => item.uid === "council").map((item) => `${item.start} ${item.end}`)).toEqual([
      "2026-10-05T19:00 2026-10-05T20:30",
      "2026-10-19T19:00 2026-10-19T20:30",
      "2026-10-28T19:00 2026-10-28T20:30",
      "2026-11-02T19:00 2026-11-02T20:30",
      "2026-11-16T19:00 2026-11-16T20:30",
    ]);
    // February 29 only in leap years, as other calendars show it.
    expect(read.filter((item) => item.uid === "birthday").map((item) => item.start)).toEqual(["2028-02-29"]);
  });

  it("leaves out what it can't read", () => {
    expect(readCalendar("not a calendar", window)).toEqual([]);
    const feed = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:soon\nEND:VEVENT\nEND:VCALENDAR";
    expect(readCalendar(feed, window)).toEqual([]);
  });
});
