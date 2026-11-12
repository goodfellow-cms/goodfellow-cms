import { describe, expect, it } from "vitest";
import { buildNotes } from "../fonts.js";
import { calendarFiles } from "./calendars.js";
import { feedFiles } from "./feeds.js";
import { allPages, type ContentSource, loadSiteContent } from "./load.js";
import { structuredData } from "./structured-data.js";
import {
  isMembersCollection,
  isMembersOnly,
  membersPages,
  teaserData,
  visibilityChanges,
  withoutMembersContent,
  withoutPaywall,
} from "./visibility.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(Object.entries(files).map(([path, value]) => [path, JSON.stringify(value)]));
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const field = (name: string, type: string) => ({ name, label: name, type });

/** A site with a page for everyone, a members' page, and a members' collection of news and events. */
const site = () =>
  loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, title: "Northwind", url: "https://northwind.example/", timeZone: "UTC" },
      "content/pages/index.json": { version: 1, data: { root: { props: { title: "Home" } } } },
      "content/pages/handbook.json": {
        version: 1,
        data: { root: { props: { title: "Handbook", visibility: "members" } } },
      },
      "content/pages/about.json": { version: 1, data: { root: { props: { title: "About", visibility: "everyone" } } } },
      "content/collections/news/_collection.json": {
        version: 1,
        name: "News",
        entryName: "Story",
        path: "/news/{slug}",
        fields: [field("title", "text"), field("date", "date")],
      },
      "content/collections/news/launch.json": { version: 1, fields: { title: "Launch", date: "2026-11-01" } },
      "content/collections/memos/_collection.json": {
        version: 1,
        name: "Memos",
        entryName: "Memo",
        path: "/memos/{slug}",
        visibility: "members",
        fields: [field("title", "text"), field("date", "date")],
      },
      "content/collections/memos/pay.json": { version: 1, fields: { title: "Pay rises", date: "2026-11-02" } },
      "content/collections/meetings/_collection.json": {
        version: 1,
        name: "Meetings",
        entryName: "Meeting",
        path: "/meetings/{slug}",
        visibility: "members",
        calendar: { when: "when" },
        fields: [field("title", "text"), field("when", "event")],
      },
      "content/collections/meetings/board.json": {
        version: 1,
        fields: { title: "Board", when: { start: "2026-12-01T10:00" } },
      },
    }),
  );

describe("visibility", () => {
  it("says which pages are for members: their own setting, or their collection's", async () => {
    const content = await site();
    const pages = allPages(content);
    expect(
      membersPages(content, pages)
        .map((page) => page.path)
        .sort(),
    ).toEqual(["/handbook", "/meetings/board", "/memos/pay"]);
    const about = pages.find((page) => page.path === "/about");
    if (!about) throw new Error("No About page.");
    expect(isMembersOnly(about, content.collections)).toBe(false);
  });

  it("leaves members' collections out of feeds and calendar files", async () => {
    const content = await site();
    const now = new Date("2026-11-15T00:00:00Z");
    expect(feedFiles(content, now).map((file) => file.path)).toEqual(["/feeds/news.rss", "/feeds/news.atom"]);
    expect(feedFiles(content, now).some((file) => file.content.includes("Pay rises"))).toBe(false);
    expect(calendarFiles(content, now)).toEqual([]);
  });

  it("takes members' pages and collections out of what's published beside the pages", async () => {
    const content = await site();
    const published = withoutMembersContent(content);
    expect(published.pages.map((page) => page.path).sort()).toEqual(["/", "/about"]);
    expect(published.collections.map((collection) => collection.id)).toEqual(["news"]);
    // A site with nothing for members is left as it is.
    expect(withoutMembersContent(published)).toBe(published);
  });

  it("tells search engines nothing about members' pages, whose teasers would show their items' summaries", async () => {
    const content = await site();
    const pages = allPages(content);
    const page = (path: string) => {
      const found = pages.find((candidate) => candidate.path === path);
      if (!found) throw new Error(`No page at ${path}.`);
      return found;
    };
    const today = "2026-11-15";
    expect(structuredData(content, page("/news/launch"), today)).toContainEqual(
      expect.objectContaining({ "@type": "Article", headline: "Launch" }),
    );
    expect(structuredData(content, page("/memos/pay"), today)).toEqual([]);
    expect(structuredData(content, page("/handbook"), today)).toEqual([]);
  });

  it("warns where a static site publishes members' pages to everyone", () => {
    expect(buildNotes({ membersPages: ["/handbook"] })).toEqual([
      "A page is marked for signed-in members only (/handbook), but this site has no server to keep it to members, so everyone can read it. Only a full-stack site can keep pages to members.",
    ]);
    const many = buildNotes({ membersPages: ["/a", "/b", "/c", "/d", "/e", "/f", "/g"] });
    expect(many[0]).toMatch(/^7 pages are marked for signed-in members only \(\/a, \/b, \/c, \/d, \/e, and 2 more\)/);
    expect(buildNotes({ membersPages: [] })).toEqual([]);
  });

  it("counts a collection whose design is for members as members'", () => {
    const template = (visibility: string) => ({ root: { props: { visibility } }, content: [] });
    expect(isMembersCollection({ settings: { template: template("members") } } as never)).toBe(true);
    expect(isMembersCollection({ settings: { template: template("everyone") } } as never)).toBe(false);
    expect(isMembersCollection({ settings: { visibility: "members" } } as never)).toBe(true);
    expect(isMembersCollection({ settings: {} } as never)).toBe(false);
  });

  it("finds pages whose readers a change changes, however they're sent", async () => {
    const page = (visibility?: string) =>
      JSON.stringify({ version: 1, data: { root: { props: { ...(visibility && { visibility }) } }, content: [] } });
    const files: Record<string, string> = {
      "content/pages/public.json": page(),
      "content/pages/members.json": page("members"),
    };
    const read = async (path: string) => files[path];
    expect(
      await visibilityChanges(
        [
          { path: "content/pages/public.json", content: page("everyone") },
          { path: "content/pages/members.json", content: page("members") },
          { path: "content/site.json", content: "{}" },
          { path: "content/pages/public.json", delete: true },
        ],
        read,
      ),
    ).toEqual([]);
    // Deleting a members' page would let the same address be published again for everyone.
    expect(await visibilityChanges([{ path: "content/pages/members.json", delete: true }], read)).toEqual([
      "content/pages/members.json",
    ]);
    expect(
      await visibilityChanges(
        [
          { path: "content/pages/public.json", content: page("members") },
          { path: "content/pages/members.json", bytes: new TextEncoder().encode(page()) },
          { path: "content/pages/new.json", content: page("members") },
        ],
        read,
      ),
    ).toEqual(["content/pages/public.json", "content/pages/members.json", "content/pages/new.json"]);
  });
});

describe("teaserData and withoutPaywall", () => {
  const block = (type: string, id: string, props: Record<string, unknown> = {}) => ({ type, props: { id, ...props } });

  it("shows the blocks before the paywall, then the paywall", () => {
    const data = {
      root: { props: { title: "Handbook" } },
      content: [
        block("Section", "intro"),
        block("Paywall", "wall", { heading: "For members" }),
        block("Text", "secret", { text: "Members only" }),
      ],
    };
    expect(teaserData(data, "Paywall")).toEqual({
      root: { props: { title: "Handbook" } },
      content: [block("Section", "intro"), block("Paywall", "wall", { heading: "For members" })],
    });
    expect(withoutPaywall(data, "Paywall").content).toEqual([
      block("Section", "intro"),
      block("Text", "secret", { text: "Members only" }),
    ]);
  });

  it("ends the teaser before a block that holds the paywall, which may hold members' words beside it", () => {
    const data = {
      root: {},
      content: [
        block("Heading", "title"),
        block("Section", "body", {
          content: [block("Text", "secret", { text: "Members only" }), block("Paywall", "wall")],
        }),
      ],
    };
    expect(teaserData(data, "Paywall").content).toEqual([block("Heading", "title"), block("Paywall", "wall")]);
    expect(withoutPaywall(data, "Paywall").content).toEqual([
      block("Heading", "title"),
      block("Section", "body", { content: [block("Text", "secret", { text: "Members only" })] }),
    ]);
  });

  it("shows only a paywall where the page has none, never words an editor didn't choose to show", () => {
    const data = { root: {}, content: [block("Section", "intro"), block("Text", "secret", { text: "Members only" })] };
    expect(teaserData(data, "Paywall").content).toEqual([{ type: "Paywall", props: { id: "Paywall-teaser" } }]);
    expect(JSON.stringify(teaserData(data, "Paywall"))).not.toContain("Members only");
    expect(withoutPaywall(data, "Paywall")).toBe(data);
  });

  it("keeps only the drop zones of the blocks it shows", () => {
    const data = {
      root: {},
      content: [block("Columns", "shown"), block("Paywall", "wall"), block("Columns", "hidden")],
      zones: {
        "shown:left": [block("Text", "a", { text: "Open" })],
        "hidden:left": [block("Text", "b", { text: "Members only" })],
      },
    };
    expect(teaserData(data, "Paywall").zones).toEqual({ "shown:left": [block("Text", "a", { text: "Open" })] });
    expect(JSON.stringify(teaserData(data, "Paywall"))).not.toContain("Members only");
  });

  it("takes paywalls out of drop zones and the root too, for members", () => {
    const data = {
      root: { props: { content: [block("Paywall", "in-root")] } },
      content: [block("Columns", "cols")],
      zones: { "cols:left": [block("Paywall", "in-zone"), block("Text", "kept")] },
    };
    expect(withoutPaywall(data, "Paywall")).toEqual({
      root: { props: { content: [] } },
      content: [block("Columns", "cols")],
      zones: { "cols:left": [block("Text", "kept")] },
    });
  });
});
