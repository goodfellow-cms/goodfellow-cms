import { describe, expect, it } from "vitest";
import { getPageHead } from "../head.js";
import { feedFiles, feedLinks } from "./feeds.js";
import { allPages, type ContentSource, loadSiteContent } from "./load.js";
import { structuredData, structuredDataScript, zonedIso } from "./structured-data.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const field = (name: string, type: string) => ({ name, label: name, type });

const site = (settings: Record<string, unknown> = {}, files: Record<string, unknown> = {}) =>
  loadSiteContent(
    memorySource({
      "content/site.json": {
        version: 1,
        title: "St. Joseph",
        description: "A parish & school",
        url: "https://parish.example/",
        timeZone: "America/New_York",
        logo: { src: "/media/logo.png" },
        contact: { email: "office@example.org", phone: "555-0100", address: "1 Main St\nSpringfield" },
        ...settings,
      },
      "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } } } },
      "content/pages/private.json": { version: 1, data: { root: { props: { title: "Staff", noIndex: true } } } },
      "content/collections/news/_collection.json": {
        version: 1,
        name: "News",
        entryName: "Story",
        path: "/news/{slug}",
        sort: { field: "date", order: "desc" },
        fields: [field("title", "text"), field("date", "date"), field("photo", "image"), field("text", "richtext")],
      },
      "content/collections/news/fair.json": {
        version: 1,
        fields: { title: "The <fair>", date: "2026-11-01", photo: "/media/fair.jpg", text: "<p>Games &amp; food.</p>" },
      },
      "content/collections/news/choir.json": {
        version: 1,
        fields: { title: "The choir", date: "2026-11-08", text: "<p>New hymns.</p>" },
      },
      "content/collections/events/_collection.json": {
        version: 1,
        name: "Events",
        entryName: "Event",
        path: "/events/{slug}",
        calendar: { when: "when", place: "place", summary: "summary" },
        fields: [field("title", "text"), field("when", "event"), field("place", "text"), field("summary", "textarea")],
      },
      "content/collections/events/mass.json": {
        version: 1,
        fields: {
          title: "Christmas Mass",
          when: { start: "2026-12-24T22:00", end: "2026-12-24T23:30" },
          place: "The church",
          summary: "Midnight Mass </script>",
        },
      },
      ...files,
    }),
  );

describe("feeds", () => {
  it("lists each collection's items, newest first, as RSS and Atom", async () => {
    const content = await site();
    const files = feedFiles(content, new Date("2026-12-01T00:00:00Z"));
    // Calendars have calendar files instead.
    expect(files.map((file) => file.path)).toEqual(["/feeds/news.rss", "/feeds/news.atom"]);
    const [rss = "", atom = ""] = files.map((file) => file.content);
    expect(rss).toContain("<title>News – St. Joseph</title>");
    expect(rss).toContain("<description>A parish &amp; school</description>");
    expect(rss).toContain(
      '<atom:link href="https://parish.example/feeds/news.rss" rel="self" type="application/rss+xml"/>',
    );
    expect(rss.indexOf("The choir")).toBeLessThan(rss.indexOf("The &lt;fair&gt;"));
    expect(rss).toContain('<guid isPermaLink="true">https://parish.example/news/fair</guid>');
    // Midnight in the site's time zone.
    expect(rss).toContain("<pubDate>Sun, 01 Nov 2026 04:00:00 GMT</pubDate>");
    expect(rss).toContain("<description>Games &amp; food.</description>");
    expect(atom).toContain("<updated>2026-11-08T05:00:00.000Z</updated>");
    expect(atom).toContain('<link rel="alternate" type="text/html" href="https://parish.example/news/choir"/>');
    expect(feedLinks(content)).toEqual([{ title: "News – St. Joseph", href: "/feeds/news.rss" }]);
  });

  it("gives each language's feed its own address, as its own and Atom's id", async () => {
    const content = await site(
      { languages: [{ code: "es", name: "Español" }] },
      {
        "content/collections/news/feria.json": {
          version: 1,
          inLanguage: "es",
          translationOf: "fair",
          fields: { title: "La feria", date: "2026-11-01" },
        },
      },
    );
    const files = feedFiles(content, new Date("2026-12-01T00:00:00Z"));
    const rss = files.find((file) => file.path === "/es/feeds/news.rss")?.content ?? "";
    const atom = files.find((file) => file.path === "/es/feeds/news.atom")?.content ?? "";
    expect(rss).toContain('<atom:link href="https://parish.example/es/feeds/news.rss" rel="self"');
    expect(rss).toContain("<link>https://parish.example/es/</link>");
    expect(atom).toContain("<id>https://parish.example/es/feeds/news.atom</id>");
    expect(atom).toContain(
      '<link rel="self" type="application/atom+xml" href="https://parish.example/es/feeds/news.atom"/>',
    );
    expect(atom).toContain('<link rel="alternate" type="text/html" href="https://parish.example/es/"/>');
  });

  it("needs the site's address, since feeds link with full addresses", async () => {
    const content = await site({ url: undefined });
    expect(feedFiles(content)).toEqual([]);
    expect(feedLinks(content)).toEqual([]);
  });
});

describe("structured data", () => {
  const page = async (path: string, settings?: Record<string, unknown>) => {
    const content = await site(settings);
    const found = allPages(content).find((candidate) => candidate.path === path);
    if (!found) throw new Error(`No page at ${path}`);
    return structuredData(content, found, "2026-11-01");
  };

  it("describes the site and its organization on the home page", async () => {
    expect(await page("/")).toEqual([
      {
        "@type": "WebSite",
        name: "St. Joseph",
        url: "https://parish.example/",
        description: "A parish & school",
        inLanguage: "en",
      },
      {
        "@type": "Organization",
        name: "St. Joseph",
        url: "https://parish.example/",
        logo: "https://parish.example/media/logo.png",
        email: "office@example.org",
        telephone: "555-0100",
        address: { "@type": "PostalAddress", streetAddress: "1 Main St, Springfield" },
      },
    ]);
  });

  it("describes events with their times in the site's time zone, and dated items as articles", async () => {
    expect(await page("/events/mass")).toEqual([
      expect.objectContaining({
        "@type": "Event",
        name: "Christmas Mass",
        startDate: "2026-12-24T22:00:00-05:00",
        endDate: "2026-12-24T23:30:00-05:00",
        location: { "@type": "Place", name: "The church", address: "The church" },
        description: "Midnight Mass </script>",
        url: "https://parish.example/events/mass",
      }),
    ]);
    expect(await page("/news/fair")).toEqual([
      expect.objectContaining({
        "@type": "Article",
        headline: "The <fair>",
        datePublished: "2026-11-01",
        image: ["https://parish.example/media/fair.jpg"],
      }),
    ]);
  });

  it("says nothing about pages hidden from search engines, or without the site's address", async () => {
    const content = await site();
    const hidden = content.pages.find((candidate) => candidate.path === "/private");
    expect(hidden && getPageHead(content.settings, hidden).noIndex).toBe(true);
    expect(await page("/private")).toEqual([]);
    expect(await page("/", { url: undefined })).toEqual([]);
  });

  it("writes it so no value can end its script", async () => {
    const script = structuredDataScript(await page("/events/mass"));
    expect(script).not.toContain("</script>");
    expect(JSON.parse(script ?? "")).toMatchObject({ "@context": "https://schema.org", "@type": "Event" });
    expect(JSON.parse(structuredDataScript(await page("/")) ?? "")["@graph"]).toHaveLength(2);
    expect(structuredDataScript([])).toBeUndefined();
  });

  it("writes times with their offset, which changes with daylight saving time", () => {
    expect(zonedIso("2026-07-04T09:00", "America/New_York")).toBe("2026-07-04T09:00:00-04:00");
    expect(zonedIso("2026-07-04T09:00", "Asia/Kolkata")).toBe("2026-07-04T09:00:00+05:30");
    expect(zonedIso("2026-07-04", "America/New_York")).toBe("2026-07-04");
    expect(zonedIso("2026-07-04T09:00", undefined)).toBe("2026-07-04T09:00:00");
  });
});
