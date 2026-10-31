import {
  type Collection,
  collectionFileSchema,
  type Page,
  type SiteContent,
  sitePages,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const topics = [
  { value: "music", label: "Music" },
  { value: "youth", label: "Youth ministry" },
  { value: "音楽", label: "In another script" },
];

const articles: [string, string, string, string[]][] = [
  ["choir", "Choir returns", "2026-09-01", ["music"]],
  ["retreat", "Youth retreat", "2026-08-15", ["youth"]],
  ["organ", "New organ", "2026-07-20", ["music"]],
  ["camp", "Summer camp", "2026-06-30", ["youth", "music"]],
  ["festival", "Fall festival", "2026-10-01", []],
];

const news: Collection = {
  id: "news",
  file: "content/collections/news/_collection.json",
  settings: collectionFileSchema.parse({
    version: 1,
    name: "News",
    entryName: "Article",
    path: "/news/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "date", label: "Date", type: "date" },
      { name: "topics", label: "Topics", type: "tags", options: topics },
      { name: "summary", label: "Summary", type: "textarea" },
    ],
    sort: { field: "date", order: "desc" },
  }),
  entries: articles.map(([slug, title, date, tags]) => ({
    collection: "news",
    slug,
    file: `content/collections/news/${slug}.json`,
    path: `/news/${slug}`,
    content: { version: 1, fields: { title, date, topics: tags, summary: `About ${title} & more` } },
  })),
};

const pageFile = (content: unknown[]): Page["content"] => ({
  version: 1,
  data: { root: { props: { title: "News" } }, content: content as Page["content"]["data"]["content"] },
});

function site(content: unknown[]): SiteContent {
  return {
    settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph" }),
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [{ path: "/news", file: "content/pages/news.json", content: pageFile(content) }],
    collections: [news],
    customCss: "",
  };
}

const list = (props: Record<string, unknown>) => ({
  type: "CollectionList",
  props: { id: "list", ...blocks.CollectionList.defaultProps, collection: "news", layout: "list", ...props },
});

const loop = (props: Record<string, unknown>, design: unknown[]) => ({
  type: "CollectionLoop",
  props: { id: "loop", ...blocks.CollectionLoop.defaultProps, collection: "news", ...props, design },
});

/** Every page a build writes for the site, and each one's main content. */
async function build(content: unknown[]): Promise<Map<string, string>> {
  const siteContent = site(content);
  const pages = sitePages(siteContent, "2026-10-10", blocks);
  const html = new Map<string, string>();
  for (const page of pages) {
    if (page.entry) continue;
    const rendered = await renderPage(siteContent, page as Page);
    html.set(page.path, rendered.slice(rendered.indexOf("<main"), rendered.indexOf("</main>")));
  }
  return html;
}

const titles = (html: string | undefined) =>
  // Items' titles are level 2 headings in a list without a heading of its own, and level 3 under one.
  [...(html ?? "").matchAll(/<h[23] class="gf-(?:card|list-item)-title[^>]*>(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1]);

describe("Collection list", () => {
  it("shows a heading and a link to every item, and only items with a choice", async () => {
    const pages = await build([
      list({
        heading: "Music news",
        moreLabel: "See all",
        moreHref: "/news/all",
        filterField: "topics",
        filterValue: "music",
        limit: 2,
      }),
    ]);
    const html = pages.get("/news");
    expect(html).toContain("Music news");
    expect(html).toContain('href="/news/all/"');
    expect(titles(html)).toEqual(["Choir returns", "New organ"]);
    // Without pages of its own, there's no list of them.
    expect([...pages.keys()]).toEqual(["/news"]);
  });

  it("orders by title either way", async () => {
    const az = await build([list({ order: "title" })]);
    expect(titles(az.get("/news"))).toEqual([
      "Choir returns",
      "Fall festival",
      "New organ",
      "Summer camp",
      "Youth retreat",
    ]);
    const za = await build([list({ order: "title-desc", limit: 2 })]);
    expect(titles(za.get("/news"))).toEqual(["Youth retreat", "Summer camp"]);
  });

  it("puts the rest on later pages, with links between them", async () => {
    const pages = await build([list({ limit: 2, paginate: true })]);
    expect([...pages.keys()]).toEqual(["/news", "/news/page/2", "/news/page/3"]);
    expect(titles(pages.get("/news"))).toEqual(["Fall festival", "Choir returns"]);
    expect(titles(pages.get("/news/page/2"))).toEqual(["Youth retreat", "New organ"]);
    expect(titles(pages.get("/news/page/3"))).toEqual(["Summer camp"]);
    const second = pages.get("/news/page/2") ?? "";
    expect(second).toContain('href="/news/" rel="prev"');
    expect(second).toContain('href="/news/page/3/" rel="next"');
    expect(second).toMatch(/aria-current="page"[^>]*>2</);
    expect(second).toContain('aria-label="Pages"');
    // Pages a list adds aren't in the site's search.
    expect(second).not.toContain("data-pagefind-body");
    expect(pages.get("/news")).toContain("data-pagefind-body");
  });

  it("gives each choice a page, with its own later pages", async () => {
    const pages = await build([list({ limit: 1, paginate: true, choicePages: "topics" })]);
    expect([...pages.keys()].filter((path) => path.includes("topics"))).toEqual([
      "/news/topics/music",
      "/news/topics/music/page/2",
      "/news/topics/music/page/3",
      "/news/topics/youth",
      "/news/topics/youth/page/2",
    ]);
    const youth = pages.get("/news/topics/youth/page/2") ?? "";
    expect(titles(youth)).toEqual(["Summer camp"]);
    // The choice is the current one, though this is its second page.
    expect(youth).toContain('href="/news/topics/youth/" aria-current="true"');
    expect(youth).toContain('href="/news/topics/youth/page/2/" aria-current="page"');
    expect(youth).toMatch(/href="\/news\/" class="[^"]*">All</);
    expect(youth).toMatch(/href="\/news\/topics\/music\/" class="[^"]*">Music</);
  });

  it("titles the pages it adds", () => {
    const pages = sitePages(site([list({ limit: 2, paginate: true, choicePages: "topics" })]), "2026-10-10", blocks);
    expect(pages.find((page) => page.path === "/news/page/2")?.view).toMatchObject({ page: 2, title: "Page 2" });
    expect(pages.find((page) => page.path === "/news/topics/music/page/2")?.view).toMatchObject({
      page: 2,
      choice: "music",
      title: "Music, Page 2",
    });
  });

  it("works with a list saved before its newer settings existed", async () => {
    const stored = {
      type: "CollectionList",
      props: { id: "old", collection: "news", limit: 3, choicePages: "topics", paginate: true },
    };
    const pages = await build([stored]);
    expect(pages.get("/news/page/2")).toContain("Previous");
    expect(pages.get("/news/topics/music")).toContain("Choir returns");
  });

  it("leaves a second list on the page without pages of its own", async () => {
    const pages = await build([list({ limit: 2, paginate: true }), list({ id: "other", limit: 1, paginate: true })]);
    expect([...pages.keys()]).toEqual(["/news", "/news/page/2", "/news/page/3"]);
    // The second list shows its first page, without links to pages that are the first list's.
    const second = pages.get("/news/page/2") ?? "";
    expect(second.match(/aria-label="Pages"/g)).toHaveLength(1);
  });
});

describe("Collection loop", () => {
  const design = [
    { type: "Heading", props: { id: "h", ...blocks.Heading.defaultProps, text: "{title}" } },
    { type: "Text", props: { id: "t", ...blocks.Text.defaultProps, content: "<p>{summary}</p>" } },
  ];

  it("shows its blocks once for each item, with the item's values, linking to its page", async () => {
    const pages = await build([loop({ limit: 2, order: "title" }, design)]);
    const html = pages.get("/news") ?? "";
    expect(html).toContain("Choir returns");
    expect(html).toContain("Fall festival");
    expect(html).not.toContain("New organ");
    // Rich text gets the value escaped.
    expect(html).toContain("About Choir returns &amp; more");
    expect(html).toContain('href="/news/choir/"');
    expect(html).not.toContain("{title}");
  });

  it("fills its design with each of its own items' values, on an item's page too", async () => {
    const page: Page = {
      path: "/news/choir",
      file: "content/collections/news/choir.json",
      content: pageFile([
        { type: "Heading", props: { id: "page-title", ...blocks.Heading.defaultProps, text: "This story: {title}" } },
        loop({ limit: 2, order: "title" }, [
          { type: "Heading", props: { id: "h", ...blocks.Heading.defaultProps, text: "Also: {title}" } },
        ]),
      ]),
      entry: { collection: "news", slug: "choir" },
    };
    const html = await renderPage(site([]), page);
    expect(html).toContain("This story: Choir returns");
    expect(html).toContain("Also: Choir returns");
    expect(html).toContain("Also: Fall festival");
  });

  it("adds later pages too", async () => {
    const pages = await build([loop({ limit: 2, paginate: true }, design)]);
    expect([...pages.keys()]).toEqual(["/news", "/news/page/2", "/news/page/3"]);
    expect(pages.get("/news/page/3")).toContain("Summer camp");
    expect(pages.get("/news/page/3")).not.toContain("Fall festival");
  });
});
