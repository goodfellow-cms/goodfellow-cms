import { describe, expect, it } from "vitest";
import { buildNotes } from "../fonts.js";
import { calendarFiles } from "./calendars.js";
import { feedFiles } from "./feeds.js";
import { allPages, type ContentSource, loadSiteContent } from "./load.js";
import {
  isMembersCollection,
  isMembersOnly,
  membersPages,
  visibilityChanges,
  withoutMembersContent,
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
          { path: "content/pages/members.json", delete: true },
        ],
        read,
      ),
    ).toEqual([]);
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
