import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { type ContentSource, loadSiteContent } from "./content/load.js";
import { markdownExport, markdownExportName } from "./markdown-export.js";
import { planMarkdownImport } from "./markdown-import.js";
import { fileSystemSource } from "./node-fs-source.js";

const json = (value: unknown) => JSON.stringify(value);
const page = (title: string, content: unknown[], extra: Record<string, unknown> = {}) =>
  json({ version: 1, ...extra, data: { root: { props: { title, description: `${title}, described` } }, content } });

/** A made-up parish's site: pages, a news collection, a staff collection without pages, menus and redirects. */
const FILES: Record<string, string> = {
  "content/site.json": json({
    version: 1,
    title: "St. Brendan's",
    description: "A parish family",
    url: "https://stbrendan.example.org/",
    timeZone: "America/New_York",
  }),
  "content/menus.json": json({
    version: 1,
    menus: {
      main: [
        { label: "Home", href: "/" },
        { label: "About", href: "/about" },
      ],
    },
  }),
  "content/layout/header.json": json({
    version: 1,
    data: { content: [{ type: "Menu", props: { id: "Menu-1", menu: "main" } }] },
  }),
  "content/redirects.json": json({
    version: 1,
    redirects: [
      { from: "/who-we-are", to: "/about" },
      { from: "/diocese", to: "https://diocese.example.org/" },
    ],
  }),
  "content/media.json": json({ version: 1, descriptions: { "/media/church.jpg": { text: "The church at dusk" } } }),
  "content/pages/index.json": page("Welcome", [
    { type: "Heading", props: { id: "Heading-1", text: "Welcome", level: "h1" } },
    {
      type: "Text",
      props: {
        id: "Text-1",
        content:
          '<p>All are <strong>welcome</strong>. Read <a href="/about">about us</a> or our <a href="/news/fair">news</a>.</p>',
      },
    },
    { type: "Image", props: { id: "Image-1", src: "/media/church.jpg", alt: "" } },
    { type: "Form", props: { id: "Form-1" } },
    { type: "Space", props: { id: "Space-1", size: "md" } },
  ]),
  "content/pages/about.json": page("About us", [
    {
      type: "Section",
      props: {
        id: "Section-1",
        content: [
          { type: "Heading", props: { id: "Heading-2", text: "Our history", level: "h2" } },
          { type: "Calendar", props: { id: "Calendar-1" } },
        ],
      },
    },
    // A block of the site's own: what's in its slots comes across.
    {
      type: "StaffCard",
      props: {
        id: "StaffCard-1",
        name: "Fr. Tom",
        content: [{ type: "Text", props: { id: "Text-2", content: "<p>Our pastor.</p>" } }],
      },
    },
  ]),
  "content/pages/about/history.json": page("History", [
    { type: "Text", props: { id: "Text-3", content: '<p>Founded in 1890. Back to <a href="/about">About</a>.</p>' } },
  ]),
  "content/pages/later.json": page("Later", [], { showFrom: "2099-01-01T09:00" }),
  "content/collections/news/_collection.json": json({
    version: 1,
    name: "News",
    entryName: "Story",
    path: "/news/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      { name: "date", label: "Date", type: "date" },
      { name: "summary", label: "Summary", type: "textarea" },
      { name: "body", label: "Story", type: "richtext" },
      { name: "topics", label: "Topics", type: "tags", options: [{ label: "Parish life", value: "parish-life" }] },
    ],
  }),
  "content/collections/news/fair.json": json({
    version: 1,
    fields: {
      title: "The fall fair",
      date: "2026-10-04",
      summary: "Games and food",
      body: "<p>Come to the <em>fair</em>.</p><ul><li>Games</li><li>Food</li></ul>",
      topics: ["parish-life"],
    },
  }),
  "content/collections/staff/_collection.json": json({
    version: 1,
    name: "Staff",
    entryName: "Person",
    fields: [
      { name: "title", label: "Name", type: "text" },
      { name: "role", label: "Role", type: "text" },
    ],
  }),
  "content/collections/staff/tom.json": json({ version: 1, fields: { title: "Fr. Tom", role: "Pastor" } }),
};

function memorySource(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const NOW = new Date("2026-11-01T12:00:00Z");

async function exported(options: Parameters<typeof markdownExport>[1] = {}) {
  const content = await loadSiteContent(memorySource(FILES));
  const result = markdownExport(content, { now: NOW, mediaFiles: ["public/media/church.jpg"], ...options });
  const file = (path: string) => {
    const found = result.files.find((candidate) => candidate.path === path);
    if (!found) throw new Error(`No file ${path} in ${result.files.map((candidate) => candidate.path).join(", ")}`);
    const [, yaml = "", body = ""] = /^---\n([\s\S]*?)---\n\n?([\s\S]*)$/.exec(found.content) ?? [];
    return { front: parseYaml(yaml) as Record<string, unknown>, body };
  };
  return { content, result, file };
}

describe("markdownExport", () => {
  it("writes each page and item at its address, with its details as front matter", async () => {
    const { result, file } = await exported();
    expect(result.files.map((found) => found.path)).toEqual([
      "_staff/tom.md",
      "about/history.md",
      "about/index.md",
      "index.md",
      "news/fair.md",
      "menus.json",
    ]);
    const home = file("index.md");
    expect(home.front).toEqual({ title: "Welcome", description: "Welcome, described", permalink: "/" });
    // The page's own heading for its title isn't repeated: the title is in the front matter.
    expect(home.body).not.toContain("# Welcome");
    expect(home.body).toContain("All are **welcome**. Read [about us](/about/) or our [news](/news/fair/).");
    // An image without alt text of its own takes the media library's description.
    expect(home.body).toContain("![The church at dusk](/media/church.jpg)");

    const story = file("news/fair.md");
    expect(story.front).toEqual({
      title: "The fall fair",
      date: "2026-10-04",
      permalink: "/news/fair/",
      summary: "Games and food",
      topics: ["parish-life"],
    });
    expect(story.body).toContain("Come to the *fair*.");
    expect(story.body).toContain("- Games\n- Food");

    // A collection without pages goes in a folder of its own, and isn't given an address.
    expect(file("_staff/tom.md").front).toEqual({ title: "Fr. Tom", role: "Pastor" });
    expect(JSON.parse(result.files.find((found) => found.path === "menus.json")?.content ?? "")).toEqual({
      menus: {
        main: [
          { label: "Home", href: "/" },
          { label: "About", href: "/about" },
        ],
      },
    });
    expect(result.media).toEqual([{ from: "public/media/church.jpg", path: "media/church.jpg" }]);
    expect(result.summary).toEqual({ pages: 3, items: 2, media: 1, menus: 1 });
  });

  it("writes a page with pages under it as its folder's index, and redirects to it as its aliases", async () => {
    const { result, file } = await exported();
    // `/about` has `/about/history` under it, so it's its folder's index, as Jekyll, Eleventy and Astro read it.
    expect(file("about/index.md").front.aliases).toEqual(["/who-we-are/"]);
    expect(file("about/index.md").front.redirect_from).toEqual(["/who-we-are/"]);
    expect(result.notes).toContainEqual({ kind: "redirects", count: 1 });
  });

  it("leaves out blocks Markdown can't hold, saying where, and keeps what's in the site's own blocks' slots", async () => {
    const { result, file } = await exported();
    const about = file("about/index.md");
    expect(about.body).toContain("## Our history");
    expect(about.body).toContain("Our pastor.");
    expect(result.notes).toEqual(
      expect.arrayContaining([
        { kind: "left-out-block", name: "Form", items: ["Welcome"] },
        { kind: "left-out-block", name: "Calendar", items: ["About us"] },
        { kind: "layout" },
        { kind: "no-pages", collections: ["Staff"] },
        { kind: "scheduled", items: ["Later"], included: false },
      ]),
    );
    // Space only spaces things out, which Markdown's paragraphs do, so it isn't worth a note.
    expect(result.notes.some((note) => note.kind === "left-out-block" && note.name === "Space")).toBe(false);
  });

  it("exports what its schedule hides only when asked, as a draft", async () => {
    const { file } = await exported({ scheduled: true });
    expect(file("later.md").front).toMatchObject({ title: "Later", draft: true, publishDate: "2099-01-01T09:00" });
  });

  it("writes links as paths to the exported files when asked, for notes apps", async () => {
    const { file } = await exported({ links: "files" });
    expect(file("index.md").body).toContain("[about us](about/index.md)");
    expect(file("index.md").body).toContain("[news](news/fair.md)");
    expect(file("index.md").body).toContain("](media/church.jpg)");
    expect(file("about/history.md").body).toContain("[About](index.md)");
  });

  it("is read back by the Markdown import: pages, items, their addresses and the redirects", async () => {
    const { result } = await exported();
    const texts = Object.fromEntries(result.files.map((found) => [found.path, found.content]));
    const target = await loadSiteContent(
      memorySource({
        "content/site.json": json({ version: 1, title: "New site" }),
        "content/menus.json": json({ version: 1, menus: { main: [] } }),
        "content/pages/index.json": page("Home", []),
      }),
    );
    const plan = planMarkdownImport(Object.keys(texts), (path) => texts[path], target, {
      folders: { about: "pages", _staff: "collection" },
      replaceHome: true,
      mediaFiles: [],
    });
    expect(plan.summary.pages).toEqual(expect.arrayContaining(["/", "/about", "/about/history"]));
    expect(plan.summary.collections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "news", path: "/news/{slug}", items: 1 })]),
    );
    expect(plan.summary.redirects).toBe(1);
    const story = plan.changes.find((change) => change.path === "content/collections/news/fair.md");
    expect(story && "content" in story ? story.content : "").toContain("Come to the *fair*.");
  });

  it("writes every page and item of the parish example, each at a path of its own", async () => {
    const content = await loadSiteContent(
      fileSystemSource(new URL("../../../examples/parish", import.meta.url).pathname),
    );
    const result = markdownExport(content, { now: NOW });
    const paths = result.files.map((found) => found.path);
    expect(new Set(paths).size).toBe(paths.length);
    const items = content.collections.reduce((count, collection) => count + collection.entries.length, 0);
    expect(result.summary.pages + result.summary.items).toBe(
      content.pages.filter((found) => found.path !== "/404").length +
        items -
        (result.notes.find((note) => note.kind === "scheduled")?.items.length ?? 0),
    );
    for (const found of result.files.filter((candidate) => candidate.path.endsWith(".md"))) {
      expect(found.content).toMatch(/^---\n[\s\S]*?\n---\n/);
    }
    // Spanish pages are under their language's code, and translations share a key with what they translate.
    const spanish = result.files.find((found) => found.path === "es/index.md");
    expect(spanish?.content).toContain("lang: es");
    expect(spanish?.content).toContain("translationKey: /\n");
  });
});

describe("markdownExportName", () => {
  it("names the export after the site", () => {
    expect(markdownExportName({ settings: { title: "St. Brendan's Parish" } } as never)).toBe(
      "st-brendan-s-parish-markdown",
    );
  });
});
