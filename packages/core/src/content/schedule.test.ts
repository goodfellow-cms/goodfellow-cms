import { describe, expect, it } from "vitest";
import { entryFileChange, pageFileChange, relinkedChanges } from "./changes.js";
import { type ContentSource, loadSiteContent } from "./load.js";
import { parseMarkdownEntry, serializeMarkdownEntry } from "./markdown.js";
import { dueChanges, scheduleProblem, scheduleState, shownContent, upcomingChanges } from "./schedule.js";
import { collectionFileSchema } from "./schemas.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const page = (title: string, schedule: Record<string, string> = {}) => ({
  version: 1,
  ...schedule,
  data: { root: { props: { title } }, content: [] },
});

const site = (timeZone?: string) =>
  loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, title: "Parish", ...(timeZone && { timeZone }) },
      "content/menus.json": {
        version: 1,
        menus: {
          main: [
            { label: "Home", href: "/" },
            { label: "Advent", href: "/advent/", children: [{ label: "Times", href: "/advent#times" }] },
            { label: "News", href: "/news", children: [{ label: "Fair", href: "/news/fair" }] },
          ],
        },
      },
      "content/pages/index.json": page("Home"),
      "content/pages/advent.json": page("Advent", { showFrom: "2026-11-29T09:00" }),
      "content/pages/news.json": page("News"),
      "content/pages/summer.json": page("Summer", { showFrom: "2026-06-01T00:00", hideAfter: "2026-09-01T00:00" }),
      "content/collections/news/_collection.json": {
        version: 1,
        name: "News",
        entryName: "Story",
        path: "/news/{slug}",
        fields: [{ name: "title", label: "Title", type: "text" }],
      },
      "content/collections/news/fair.json": {
        version: 1,
        hideAfter: "2026-11-01T18:00",
        fields: { title: "The fair" },
      },
      "content/collections/news/choir.json": { version: 1, fields: { title: "The choir" } },
    }),
  );

describe("scheduled publishing", () => {
  it("shows pages and items only while their schedules say, in the site's time zone", async () => {
    const content = await site("America/New_York");
    // 8:59 in New York on November 29 is 13:59 UTC.
    const before = shownContent(content, new Date("2026-11-29T13:59:00Z"));
    expect(before.pages.map((page) => page.path)).toEqual(["/", "/news"]);
    expect(before.collections[0]?.entries.map((entry) => entry.slug)).toEqual(["choir"]);
    // Links to what isn't shown leave the menus, and items with nothing left under them lose their list.
    expect(before.menus.main).toEqual([
      { label: "Home", href: "/" },
      { label: "News", href: "/news" },
    ]);

    const after = shownContent(content, new Date("2026-11-29T14:00:00Z"));
    expect(after.pages.map((page) => page.path)).toEqual(["/", "/advent", "/news"]);

    // Before anything changes, the site is as it was loaded.
    const summer = shownContent(content, new Date("2026-07-01T12:00:00Z"));
    expect(summer.pages.map((page) => page.path)).toEqual(["/", "/news", "/summer"]);
    expect(summer.collections[0]?.entries).toHaveLength(2);
  });

  it("lists what's coming up, and what came due since a time", async () => {
    const content = await site("America/New_York");
    const now = new Date("2026-10-21T12:00:00Z");
    expect(
      upcomingChanges(content, now).map(({ kind, time, at, title, path, entry }) => ({
        kind,
        time,
        at: at.toISOString(),
        title,
        path,
        entry,
      })),
    ).toEqual([
      {
        kind: "hide",
        time: "2026-11-01T18:00",
        // Daylight saving time has ended by then.
        at: "2026-11-01T23:00:00.000Z",
        title: "The fair",
        path: "/news/fair",
        entry: { collection: "news", slug: "fair" },
      },
      {
        kind: "show",
        time: "2026-11-29T09:00",
        at: "2026-11-29T14:00:00.000Z",
        title: "Advent",
        path: "/advent",
        entry: undefined,
      },
    ]);
    const due = dueChanges(content, new Date("2026-11-29T13:17:00Z"), new Date("2026-11-29T14:17:00Z"));
    expect(due.map((change) => change.title)).toEqual(["Advent"]);
    expect(dueChanges(content, new Date("2026-11-29T14:17:00Z"), new Date("2026-11-29T15:17:00Z"))).toEqual([]);
  });

  it("uses UTC for sites without a time zone", async () => {
    const content = await site();
    expect(scheduleState(content.pages[0]?.content ?? {}, new Date(), undefined)).toBe("shown");
    const advent = content.pages.find((page) => page.path === "/advent");
    expect(scheduleState(advent?.content ?? {}, new Date("2026-11-29T08:59:00Z"), undefined)).toBe("waiting");
    expect(scheduleState(advent?.content ?? {}, new Date("2026-11-29T09:00:00Z"), undefined)).toBe("shown");
  });

  it("refuses times that don't exist or come in the wrong order", async () => {
    expect(scheduleProblem({ showFrom: "2026-02-30T09:00" })).toBe("invalid");
    expect(scheduleProblem({ showFrom: "2026-11-29" })).toBe("invalid");
    expect(scheduleProblem({ showFrom: "2026-11-29T09:00", hideAfter: "2026-11-29T09:00" })).toBe("order");
    expect(scheduleProblem({ showFrom: "2026-11-29T09:00", hideAfter: "2026-12-24T00:00" })).toBeUndefined();
    await expect(
      loadSiteContent(
        memorySource({
          "content/pages/index.json": page("Home", { showFrom: "2026-12-01T09:00", hideAfter: "2026-11-01T09:00" }),
        }),
      ),
    ).rejects.toThrow(/hideAfter must be after showFrom/);
  });

  it("keeps schedules in files, JSON and Markdown, whenever they're written again", async () => {
    const data = { content: [], root: { props: { title: "Advent" } } };
    expect(pageFileChange("/advent", data, { showFrom: "2026-11-29T09:00" })).toEqual({
      path: "content/pages/advent.json",
      content: `${JSON.stringify({ version: 1, data, showFrom: "2026-11-29T09:00" }, null, 2)}\n`,
    });
    const news = { id: "news", settings: (await site()).collections[0]?.settings ?? ({} as never) };
    expect(entryFileChange(news, "fair", { title: "Fair" }, { hideAfter: "2026-11-01T18:00" })).toMatchObject({
      content: expect.stringContaining('"hideAfter": "2026-11-01T18:00"'),
    });

    const docs = collectionFileSchema.parse({
      version: 1,
      name: "Docs",
      entryName: "Page",
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Text", type: "richtext" },
      ],
      markdown: { body: "body" },
    });
    const text = serializeMarkdownEntry(docs, { title: "Soon", body: "Text." }, { showFrom: "2026-11-29T09:00" });
    expect(text).toBe("---\nversion: 1\nshowFrom: 2026-11-29T09:00\ntitle: Soon\n---\n\nText.\n");
    expect(parseMarkdownEntry(text, "body")).toEqual({
      version: 1,
      showFrom: "2026-11-29T09:00",
      fields: { title: "Soon", body: "Text." },
    });

    // Rewriting files, such as when links move, keeps their schedules.
    const content = await site();
    const changes = relinkedChanges({
      content,
      files: ["content/pages/advent.json", "content/collections/news/fair.json"],
    });
    expect(changes.map((change) => "content" in change && JSON.parse(change.content))).toMatchObject([
      { showFrom: "2026-11-29T09:00" },
      { hideAfter: "2026-11-01T18:00" },
    ]);
  });
});
