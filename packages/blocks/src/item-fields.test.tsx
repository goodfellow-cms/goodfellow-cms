import { type Collection, collectionFileSchema, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const field = (id: string, name: string) => ({
  type: "EntryField",
  props: { id, field: name, style: "text", copyLabel: "", className: "" },
});

const list = (id: string, props: Record<string, unknown>) => ({
  type: "CollectionList",
  props: { id, ...blocks.CollectionList.defaultProps, layout: "list", ...props },
});

const collection = (id: string, settings: Record<string, unknown>, items: Record<string, Record<string, unknown>>) =>
  ({
    id,
    file: `content/collections/${id}/_collection.json`,
    settings: collectionFileSchema.parse({ version: 1, ...settings }),
    entries: Object.entries(items).map(([slug, fields]) => ({
      collection: id,
      slug,
      file: `content/collections/${id}/${slug}.json`,
      path: `/${id}/${slug}`,
      content: { version: 1, fields },
    })),
  }) satisfies Collection;

const speakers = collection(
  "speakers",
  {
    name: "Speakers",
    entryName: "Speaker",
    path: "/speakers/{slug}",
    fields: [
      { name: "title", label: "Name", type: "text" },
      { name: "guest", label: "Guest speaker", type: "yesno" },
    ],
  },
  {
    anna: { title: "Anna Reyes", guest: true },
    ben: { title: "Ben Okafor" },
    carla: { title: "Carla Diaz", guest: true },
  },
);

const talks = collection(
  "talks",
  {
    name: "Talks",
    entryName: "Talk",
    path: "/talks/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "speakers", label: "Speakers", type: "item", collection: "speakers", multiple: true },
      { name: "recorded", label: "Recorded", type: "yesno" },
      { name: "photos", label: "Photos", type: "images" },
      { name: "handout", label: "Handout", type: "file" },
      {
        name: "schedule",
        label: "Schedule",
        type: "group",
        fields: [
          { name: "time", label: "Time", type: "text" },
          { name: "map", label: "Map", type: "link" },
        ],
      },
    ],
    template: {
      root: { props: { title: "{title}" } },
      content: [
        field("s", "speakers"),
        field("r", "recorded"),
        field("p", "photos"),
        field("h", "handout"),
        field("g", "schedule"),
        list("linked", { collection: "speakers", linkedFrom: "speakers", heading: "Meet the speakers" }),
      ],
    },
  },
  {
    advent: {
      title: "Advent",
      speakers: ["carla", "anna"],
      recorded: true,
      photos: ["/media/one.jpg", "/media/two.jpg"],
      handout: "/media/Advent%20notes.pdf",
      schedule: [{ time: "9:00", map: "/hall" }, { time: "10:30" }],
    },
  },
);

const content: SiteContent = {
  settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph" }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [speakers, talks],
  customCss: "",
};

async function main(page: Parameters<typeof renderPage>[1]): Promise<string> {
  const html = await renderPage(content, page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

describe("collection fields in blocks", () => {
  it("show yes or no, links to items, images, files and groups on an item's page", async () => {
    const html = await main({
      path: "/talks/advent",
      file: "content/collections/talks/advent.json",
      content: { version: 1, data: talks.settings.template as never },
      entry: { collection: "talks", slug: "advent" },
    });
    // Items it links to, by their titles, linked to their pages, in its order.
    expect(html).toMatch(/href="\/speakers\/carla"[^>]*>Carla Diaz<\/a><\/span><span>, <a[^>]*href="\/speakers\/anna"/);
    expect(html).toContain(">Recorded</p>");
    expect(html.match(/gf-entry-field-image/g)).toHaveLength(2);
    expect(html).toMatch(/<a[^>]*download=""[^>]*>Advent notes\.pdf<\/a>/);
    expect(html.match(/gf-entry-field-row/g)).toHaveLength(2);
    expect(html).toContain(">9:00</span>");
    expect(html).toMatch(/href="\/hall"[^>]*>Map<\/a>/);
    // The list of the items it links to shows only those, in the list's own order.
    const linked = html.slice(html.indexOf("Meet the speakers"));
    expect([...linked.matchAll(/gf-list-item-title[^>]*>(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1])).toEqual([
      "Anna Reyes",
      "Carla Diaz",
    ]);
  });

  it("list only the items where a yes or no field is on", async () => {
    const html = await main({
      path: "/guests",
      file: "content/pages/guests.json",
      content: {
        version: 1,
        data: {
          root: { props: { title: "Guests" } },
          content: [list("guests", { collection: "speakers", filterField: "guest" })],
        } as never,
      },
    });
    expect([...html.matchAll(/gf-list-item-title[^>]*>(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1])).toEqual([
      "Anna Reyes",
      "Carla Diaz",
    ]);
  });

  it("show nothing for a field that's off or empty", async () => {
    const html = await main({
      path: "/speakers/ben",
      file: "content/collections/speakers/ben.json",
      content: { version: 1, data: { root: { props: {} }, content: [field("g", "guest")] } as never },
      entry: { collection: "speakers", slug: "ben" },
    });
    expect(html).not.toContain("gf-entry-field");
  });
});
