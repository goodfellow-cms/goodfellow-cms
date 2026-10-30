import {
  blockPages,
  type Collection,
  collectionFileSchema,
  nextDateChange,
  type Page,
  resetDateChanges,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type CalendarProps, googleCalendarLink, outlookLink, readFeed } from "./calendar.js";
import { listChanges } from "./calendar-data.js";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const events: Collection = {
  id: "events",
  file: "content/collections/events/_collection.json",
  settings: collectionFileSchema.parse({
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
    template: {
      root: { props: { title: "{title}" } },
      content: [
        { type: "EntryField", props: { id: "w", field: "when", style: "small", className: "" } },
        {
          type: "AddToCalendar",
          props: { id: "a", addLabel: "Add to calendar", otherCalendarsLabel: "Others", className: "" },
        },
      ],
    },
  }),
  entries: [
    {
      slug: "mass",
      fields: {
        title: "Sunday Mass",
        when: { start: "2026-10-04T09:00", end: "2026-10-04T10:00", repeat: { every: "week", skip: ["2026-10-18"] } },
        place: "Church",
      },
    },
    {
      slug: "fair",
      fields: { title: "Fall fair", when: { start: "2026-10-16", end: "2026-10-17" }, summary: "Games & food" },
    },
    { slug: "past", fields: { title: "Last year", when: { start: "2025-10-01T10:00" } } },
  ].map(({ slug, fields }) => ({
    collection: "events",
    slug,
    file: `content/collections/events/${slug}.json`,
    path: `/events/${slug}`,
    content: { version: 1, fields },
  })),
};

const content: SiteContent = {
  settings: siteSettingsSchema.parse({
    version: 1,
    title: "St. Joseph",
    url: "https://parish.example.org",
    timeZone: "America/New_York",
  }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [events],
  customCss: "",
};

const calendar = (props: Partial<CalendarProps & { id: string }>) => ({
  type: "Calendar",
  props: { id: "c", ...blocks.Calendar.defaultProps, collection: "events", ...props },
});

function render(data: unknown[], path = "/calendar", month?: string) {
  const page = {
    path,
    file: "content/pages/calendar.json",
    content: { version: 1, data: { root: { props: {} }, content: data } },
    // The block the page's added pages are for, as sitePages() gives it.
    view: { block: "c", path: "/calendar", ...(month && { month }) },
  } as Page;
  return renderPage(content, page).then((html) => html.slice(html.indexOf("<main"), html.indexOf("</main>")));
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // Saturday, October 10, 2026, in the morning in New York.
  vi.setSystemTime(new Date("2026-10-10T14:00:00Z"));
});
afterAll(() => vi.useRealTimers());

describe("Calendar", () => {
  it("adds a page for each month when it shows a month at a time", () => {
    const pages = blockPages(blocks.Calendar);
    const page: Page = {
      path: "/calendar",
      file: "content/pages/calendar.json",
      content: { version: 1, data: { root: {}, content: [] } },
    };
    const context = { content, page, today: "2026-10-10" };
    expect(pages?.({ ...blocks.Calendar.defaultProps, view: "list" }, context)).toEqual([]);
    expect(
      pages?.({ ...blocks.Calendar.defaultProps, view: "month", monthsBefore: 1, monthsAfter: 1 }, context),
    ).toEqual([
      { suffix: "2026-09", month: "2026-09", title: "September 2026" },
      { suffix: "2026-10", month: "2026-10", title: "October 2026" },
      { suffix: "2026-11", month: "2026-11", title: "November 2026" },
    ]);
  });

  it("lists upcoming events by day, with repeats, skipped dates and links", async () => {
    const html = await render([calendar({ limit: 4 })]);
    const days = [...html.matchAll(/<time dateTime="([^"]+)">/g)].map((match) => match[1]);
    expect(days).toEqual(["2026-10-11", "2026-10-16", "2026-10-25", "2026-11-01"]);
    expect(html).toContain("Sunday, October 11, 2026");
    expect(html).toContain("9:00 AM – 10:00 AM");
    expect(html).toContain('href="/events/mass"');
    expect(html).toContain("Church");
    expect(html).toContain("Games &amp; food");
    expect(html).toContain("Oct 16, 2026 – Oct 17, 2026");
    expect(html).not.toContain("Last year");
    expect(html).toContain('href="/calendars/events/mass.ics" download=""');
    // Subscribing needs the site's address.
    expect(html).toContain("webcal://parish.example.org/calendars/events.ics");
    expect(html).toContain('href="/calendars/events.ics" download=""');
  });

  it("says when what it shows changes, for the nightly check", async () => {
    // A list of the next 30 days changes once Sunday's Mass is over, and the fall fair, after it, comes within it.
    resetDateChanges();
    await render([calendar({ days: 30 })]);
    expect(nextDateChange()).toBe("2026-10-12");
    // A month marks today, so it changes every day.
    resetDateChanges();
    await render([calendar({ view: "month" })]);
    expect(nextDateChange()).toBe("2026-10-11");
    resetDateChanges();
  });

  it("never reports a day already past for an event that starts in a list and ends after it", () => {
    resetDateChanges();
    const fair = { ...events, entries: events.entries.filter((entry) => entry.slug === "fair") };
    // The fair, on the 16th and 17th, starts on the list's last day, so it's on the list already.
    listChanges(fair, [], "2026-10-16", 7);
    expect(nextDateChange()).toBeUndefined();
    resetDateChanges();
  });

  it("shows a month at a time, with links to the months around it", async () => {
    const html = await render([calendar({ view: "month", monthsBefore: 1, monthsAfter: 1 })]);
    expect(html).toContain("October 2026");
    expect(html).toContain('href="/calendar/2026-09"');
    expect(html).toContain('href="/calendar/2026-11"');
    // The fair lasts two days, and shows on both.
    expect(html.match(/Fall fair/g)).toHaveLength(2);
    // October 1, 2026 is a Thursday: four empty days come before it when weeks start on Sunday.
    const grid = html.slice(html.indexOf("<ol"), html.indexOf('<time dateTime="2026-10-01"'));
    expect(grid.match(/aria-hidden="true"/g)).toHaveLength(4);
    expect(html).toMatch(/ring-primary[^>]*><time dateTime="2026-10-10"/);
  });

  it("keeps the month's name in the middle, with or without links beside it", async () => {
    const html = await render([calendar({ view: "month", monthsBefore: 0, monthsAfter: 1 })]);
    expect(html).toContain(
      '<div class="gf-calendar-month-header grid grid-cols-[1fr_auto_1fr] items-center gap-4"><span></span><h2 class="gf-calendar-month-title text-center',
    );
  });

  it("links only the first calendar on a page to its months, as only it has them", async () => {
    const html = await render([
      calendar({ view: "month", monthsBefore: 1, monthsAfter: 1 }),
      calendar({ id: "second", view: "month", monthsBefore: 1, monthsAfter: 1 }),
    ]);
    expect(html.match(/href="\/calendar\/2026-09"/g)).toHaveLength(1);
    expect(html.match(/October 2026/g)).toHaveLength(2);
  });

  it("shows a month page's own month, and stops linking past the last month", async () => {
    const html = await render(
      [calendar({ view: "month", monthsBefore: 1, monthsAfter: 1 })],
      "/calendar/2026-11",
      "2026-11",
    );
    expect(html).toContain("November 2026");
    // The current month is the calendar's own page.
    expect(html).toContain('href="/calendar"');
    expect(html).not.toContain("December 2026");
    expect(html).toContain("2026-11-01");
    // November has 30 days: every Sunday in it, and nothing after.
    expect(html.match(/Sunday Mass/g)).toHaveLength(5);
    expect(html).not.toContain("2026-12-06");
  });

  it("adds an entry's event to calendars, with its repeats", () => {
    const item = {
      key: "mass",
      start: "2026-10-04T09:00",
      end: "2026-10-04T10:00",
      allDay: false,
      title: "Sunday Mass",
      href: "/events/mass",
      place: "Church",
      event: { start: "2026-10-04T09:00", repeat: { every: "week" as const } },
    };
    const google = new URL(googleCalendarLink(item, content.settings, content.settings.url));
    expect(google.searchParams.get("dates")).toBe("20261004T090000/20261004T100000");
    expect(google.searchParams.get("ctz")).toBe("America/New_York");
    expect(google.searchParams.get("recur")).toBe("RRULE:FREQ=WEEKLY");
    expect(google.searchParams.get("details")).toBe("https://parish.example.org/events/mass");
    const outlook = new URL(outlookLink(item, content.settings));
    expect(outlook.searchParams.get("startdt")).toBe("2026-10-04T13:00:00.000Z");
    expect(outlook.searchParams.get("location")).toBe("Church");
  });

  it("reads another calendar's events, and builds without them if it can't", async () => {
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:choir",
      "DTSTART:20261014T230000Z",
      "SUMMARY:Choir practice",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const props = { ...blocks.Calendar.defaultProps, feed: "webcal://calendar.example.org/basic.ics" } as CalendarProps;
    const fetcher = vi.fn(async () => new Response(feed));
    const read = await readFeed(props, content.settings, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith("https://calendar.example.org/basic.ics", expect.anything());
    expect(read).toEqual([expect.objectContaining({ title: "Choir practice", start: "2026-10-14T19:00" })]);

    // Pages read it as they're built: here from the copy just read, which is kept for a few minutes.
    const html = await render([calendar({ collection: "", feed: props.feed })]);
    expect(html).toContain("Choir practice");
    expect(html).toContain("7:00 PM");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => new Response("", { status: 404 }));
    const missing = { ...props, feed: "https://calendar.example.org/missing.ics" };
    expect(await readFeed(missing, content.settings, failing as unknown as typeof fetch)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("couldn't be read"));
    warn.mockRestore();
  });
});

describe("Add to calendar and Entry field", () => {
  it("show an entry's next time, and links that add it", async () => {
    const page: Page = {
      path: "/events/mass",
      file: "content/collections/events/mass.json",
      content: { version: 1, data: events.settings.template },
      entry: { collection: "events", slug: "mass" },
    };
    const html = await renderPage(content, page);
    expect(html).toContain('<time dateTime="2026-10-11T09:00">Sunday, October 11, 2026, 9:00 AM – 10:00 AM</time>');
    expect(html).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(html).toContain('href="/calendars/events/mass.ics" download=""');
  });
});
