import { describe, expect, it } from "vitest";
import { type ContentSource, loadSiteContent } from "../content/load.js";
import { parseBlocks } from "./blocks.js";
import { wordPressExport, wordPressExportName } from "./export.js";
import { readWordPressExport } from "./export-file.js";
import { planWordPressImport } from "./import.js";

const json = (value: unknown) => JSON.stringify(value);
const section = (content: unknown[]) => ({
  type: "Section",
  props: { id: "Section-1", content, width: "narrow", padding: "lg", background: "none", backgroundImage: "" },
});

const FILES: Record<string, string> = {
  "content/site.json": json({
    version: 1,
    title: "St. Brendan's",
    description: "A parish family",
    url: "https://stbrendan.example.org/",
    timeZone: "America/New_York",
    contact: { phone: "555-0123", email: "office@example.org" },
  }),
  "content/menus.json": json({
    version: 1,
    menus: {
      main: [
        { label: "Home", href: "/" },
        { label: "About", href: "/about", children: [{ label: "Staff", href: "/about/staff" }] },
        { label: "Diocese", href: "https://diocese.example.org/" },
      ],
    },
  }),
  "content/layout/header.json": json({
    version: 1,
    data: { content: [{ type: "Menu", props: { id: "Menu-1", menu: "main" } }] },
  }),
  "content/pages/index.json": json({
    version: 1,
    data: {
      root: { props: { title: "Welcome" } },
      content: [
        section([
          { type: "Heading", props: { id: "Heading-1", text: "Welcome", level: "h1" } },
          {
            type: "Text",
            props: {
              id: "Text-1",
              content:
                '<p>Mass is at <strong>9:00</strong>. <a href="/about">About us</a></p><ul><li><p>Coffee</p></li></ul>',
            },
          },
          {
            type: "Image",
            props: { id: "Image-1", src: "/media/church.jpg", alt: "The church", caption: "In spring" },
          },
          {
            type: "Grid",
            props: {
              id: "Grid-1",
              columns: "2",
              items: [
                { type: "Heading", props: { id: "Heading-2", text: "Visit", level: "h3" } },
                { type: "Button", props: { id: "Button-1", label: "Directions", href: "/about", variant: "outline" } },
              ],
            },
          },
          { type: "Video", props: { id: "Video-1", source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ" } },
          { type: "Form", props: { id: "Form-1", fields: [] } },
          { type: "CollectionList", props: { id: "CollectionList-1", collection: "news", limit: 3 } },
        ]),
      ],
    },
  }),
  "content/pages/about.json": json({
    version: 1,
    data: { root: { props: { title: "About", description: "Who we are" } } },
  }),
  "content/pages/about/staff.json": json({ version: 1, data: { root: { props: { title: "Staff" } } } }),
  "content/pages/404.json": json({ version: 1, data: { root: { props: { title: "Page not found" } } } }),
  "content/collections/news/_collection.json": json({
    version: 1,
    name: "News",
    entryName: "Story",
    path: "/news/{slug}",
    markdown: { body: "body" },
    sort: { field: "date", order: "desc" },
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "date", label: "Date", type: "date" },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "image", label: "Image", type: "image" },
      { name: "topics", label: "Topics", type: "tags", options: [{ value: "youth", label: "Youth" }] },
      { name: "body", label: "Text", type: "richtext" },
    ],
  }),
  "content/collections/news/picnic.md":
    "---\nversion: 1\ntitle: Parish picnic\ndate: 2026-06-14\nsummary: Join us.\nimage: /media/picnic.jpg\ntopics:\n  - youth\n---\n\nJoin us **on the green**.\n\n| Time | What |\n| --- | --- |\n| 12 | Lunch |\n",
  "content/collections/news/advent.md":
    "---\nversion: 1\nshowFrom: 2026-11-29T08:00\ntitle: Advent\ndate: 2026-11-29\n---\n\nComing soon.\n",
  "content/collections/staff/_collection.json": json({
    version: 1,
    name: "Staff",
    entryName: "Person",
    fields: [{ name: "title", label: "Name", type: "text" }],
  }),
  "content/collections/staff/aidan.json": json({ version: 1, fields: { title: "Fr. Aidan" } }),
  "content/redirects.json": json({ version: 1, redirects: [{ from: "/old", to: "/about" }] }),
  "content/media.json": json({
    version: 1,
    credits: {},
    descriptions: { "/media/church.jpg": { text: "The church" } },
  }),
};

function source(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const NOW = new Date("2026-10-21T12:00:00Z");
const MEDIA = ["public/media/church.jpg", "public/media/picnic.jpg", "public/media/script.js"];

async function exported() {
  const content = await loadSiteContent(source(FILES));
  return { content, result: wordPressExport(content, { mediaFiles: MEDIA, now: NOW }) };
}

describe("WordPress export files", () => {
  it("writes pages, posts, menus and media that WordPress's importer reads", async () => {
    const { result } = await exported();
    expect(result.summary).toEqual({ pages: 3, posts: 2, media: 2, menus: 1, categories: 1, tags: 1 });
    const site = readWordPressExport(result.xml);
    expect(site).toMatchObject({
      title: "St. Brendan's",
      url: "https://stbrendan.example.org",
      description: "A parish family",
    });

    const pages = site.items.filter((item) => item.type === "page");
    expect(pages.map((page) => page.slug).sort()).toEqual(["about", "home", "staff"]);
    const about = pages.find((page) => page.slug === "about");
    // Pages keep their place: Staff is under About, which is at the top, not under the home page.
    expect(about?.parent).toBe(0);
    expect(pages.find((page) => page.slug === "staff")?.parent).toBe(about?.id);

    const posts = site.items.filter((item) => item.type === "post");
    expect(posts.find((post) => post.slug === "picnic")).toMatchObject({
      status: "publish",
      date: "2026-06-14T00:00",
      categories: ["news"],
      tags: ["youth"],
      image: site.media.find((file) => file.url.endsWith("/media/picnic.jpg"))?.id,
    });
    // A scheduled item stays scheduled.
    expect(posts.find((post) => post.slug === "advent")).toMatchObject({ status: "future", date: "2026-11-29T08:00" });

    expect(site.media.map((file) => file.url)).toEqual([
      "https://stbrendan.example.org/media/church.jpg",
      "https://stbrendan.example.org/media/picnic.jpg",
    ]);
    const menu = site.menus?.[0];
    expect(menu?.items.map((item) => [item.label, item.target?.kind ?? item.url])).toEqual([
      ["Home", "item"],
      ["About", "item"],
      ["Staff", "item"],
      ["Diocese", "https://diocese.example.org/"],
    ]);
    expect(menu?.items[2]?.parent).toBe(menu?.items[1]?.id);
  });

  it("turns blocks into WordPress's", async () => {
    const { result } = await exported();
    const home = readWordPressExport(result.xml).items.find((item) => item.slug === "home")?.content ?? "";
    // The page's heading for its own title is left out, since WordPress shows the title.
    expect(home).not.toContain("<h1");
    expect(parseBlocks(home).map((block) => block.name)).toEqual([
      "core/paragraph",
      "core/list",
      "core/image",
      "core/columns",
      "core/embed",
      "core/latest-posts",
    ]);
    expect(home).toContain('<p>Mass is at <strong>9:00</strong>. <a href="/about">About us</a></p>');
    expect(home).toContain(
      '<ul class="wp-block-list"><!-- wp:list-item -->\n<li>Coffee</li>\n<!-- /wp:list-item --></ul>',
    );
    expect(home).toContain(
      '<figure class="wp-block-image"><img src="https://stbrendan.example.org/media/church.jpg" alt="The church"/><figcaption class="wp-element-caption">In spring</figcaption></figure>',
    );
    expect(home).toContain(
      '<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="/about">Directions</a></div>',
    );
    expect(home).toContain(
      '<!-- wp:embed {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","type":"video","providerNameSlug":"youtube","responsive":true} -->',
    );
    expect(home).toContain('<!-- wp:latest-posts {"postsToShow":3} /-->');

    const picnic = readWordPressExport(result.xml).items.find((item) => item.slug === "picnic")?.content ?? "";
    expect(picnic).toContain("<p>Join us <strong>on the green</strong>.</p>");
    expect(picnic).toContain(
      '<figure class="wp-block-table"><table><thead><tr><th>Time</th><th>What</th></tr></thead><tbody><tr><td>12</td><td>Lunch</td></tr></tbody></table></figure>',
    );
  });

  it("says what WordPress can't have", async () => {
    const { result } = await exported();
    expect(result.notes).toEqual(
      expect.arrayContaining([
        { kind: "left-out-block", name: "Form", items: ["Welcome"] },
        { kind: "no-pages", collections: ["Staff"] },
        { kind: "redirects", count: 1 },
        { kind: "layout" },
      ]),
    );
    const content = await loadSiteContent(
      source({ ...FILES, "content/site.json": json({ version: 1, title: "St. Brendan's" }) }),
    );
    expect(wordPressExport(content, { mediaFiles: MEDIA, now: NOW }).notes).toContainEqual({ kind: "no-address" });
    expect(wordPressExportName(content)).toBe("st-brendan-s.wordpress.xml");
  });

  it("comes back as it went when imported again", async () => {
    const { result } = await exported();
    const empty = await loadSiteContent(source({ "content/site.json": json({ version: 1, title: "New" }) }));
    const plan = planWordPressImport(readWordPressExport(result.xml), empty);
    expect(plan.summary.pages.sort()).toEqual(["/", "/about", "/about/staff"]);
    expect(plan.summary.posts).toBe(2);
    expect(plan.media.map((file) => file.path)).toEqual(["public/media/church.jpg", "public/media/picnic.jpg"]);
    const home = plan.changes.find((change) => change.path === "content/pages/index.json");
    expect(home && "content" in home ? home.content : "").toContain('"text": "Visit"');
    // Images' descriptions go as WordPress's alt text, and come back.
    expect(result.xml).toContain("<wp:meta_key><![CDATA[_wp_attachment_image_alt]]></wp:meta_key>");
    const media = plan.changes.find((change) => change.path === "content/media.json");
    expect(JSON.parse(media && "content" in media ? String(media.content) : "{}").descriptions).toEqual({
      "/media/church.jpg": { text: "The church" },
    });
  });
});
