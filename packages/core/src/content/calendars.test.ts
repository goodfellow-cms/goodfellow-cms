import { describe, expect, it } from "vitest";
import { calendarFiles, calendarMonths } from "./calendars.js";
import { ContentError } from "./errors.js";
import { type ContentSource, loadSiteContent } from "./load.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const events = {
  version: 1,
  name: "Events",
  entryName: "Event",
  path: "/events/{slug}",
  fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "when", label: "Date and time", type: "event" },
    { name: "place", label: "Place", type: "text" },
    { name: "summary", label: "Summary", type: "textarea" },
  ],
  calendar: { when: "when", place: "place", summary: "summary" },
};

const site = {
  version: 1,
  title: "St. Joseph",
  url: "https://parish.example.org",
  timeZone: "America/New_York",
};

describe("calendar collections", () => {
  it("check that entries' events and the calendar's fields fit", async () => {
    const error = await loadSiteContent(
      memorySource({
        "content/collections/events/_collection.json": { ...events, calendar: { when: "place" } },
        "content/collections/talks/_collection.json": { ...events, calendar: undefined },
        "content/collections/talks/late.json": { version: 1, fields: { title: "Late", when: { start: "tomorrow" } } },
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContentError);
    const messages = (error as ContentError).problems.map((problem) => `${problem.file}: ${problem.message}`);
    expect(messages).toContainEqual(expect.stringMatching(/events\/_collection\.json: calendar\.when must be one of/));
    expect(messages).toContainEqual(expect.stringMatching(/talks\/late\.json: .*when must start on a date/));
  });

  it("are written as calendar files, one for subscribing and one for each event", async () => {
    const content = await loadSiteContent(
      memorySource({
        "content/site.json": site,
        "content/collections/events/_collection.json": events,
        "content/collections/events/mass.json": {
          version: 1,
          fields: {
            title: "Sunday Mass",
            when: { start: "2026-10-04T09:00", repeat: { every: "week" } },
            place: "Church",
            summary: "Every Sunday.",
          },
        },
        "content/collections/events/unscheduled.json": { version: 1, fields: { title: "Some day" } },
      }),
    );
    const files = calendarFiles(content, new Date("2026-10-10T12:00:00Z"));
    expect(files.map((file) => file.path)).toEqual(["/calendars/events.ics", "/calendars/events/mass.ics"]);
    const feed = files[0]?.content ?? "";
    expect(feed).toContain("X-WR-CALNAME:Events – St. Joseph");
    expect(feed).toContain("UID:events-mass@parish.example.org");
    expect(feed).toContain("URL:https://parish.example.org/events/mass");
    expect(feed).toContain("LOCATION:Church");
    expect(feed).toContain("DESCRIPTION:Every Sunday.");
    expect(files[1]?.content).toContain("X-WR-CALNAME:Sunday Mass");
  });
});

describe("month pages", () => {
  it("are counted from a calendar's props", () => {
    expect(calendarMonths({ monthsBefore: 3, monthsAfter: 100 })).toEqual({ before: 3, after: 36 });
    expect(calendarMonths({})).toEqual({ before: 1, after: 12 });
  });
});
