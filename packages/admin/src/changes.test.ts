import {
  type Collection,
  type CollectionFile,
  collectionFileSchema,
  type Entry,
  type Menus,
  type Page,
  type SiteContent,
  siteSettingsSchema,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import {
  addressPatternFor,
  checkEntrySlug,
  checkPageAddress,
  collectionSettingsChanges,
  customCssFileChange,
  deleteCollectionChanges,
  entryFileChange,
  mediaFileChange,
  moveEntryChanges,
  movePageChanges,
  newCollectionSettings,
  pageFileChange,
  pageTitle,
  siteSettingsFileChange,
  slugify,
  storedCss,
  storedData,
  uniqueName,
  withoutCredits,
} from "./changes.js";

const page = (path: string, title?: string): Page => ({
  path,
  file: path === "/" ? "content/pages/index.json" : `content/pages${path}.json`,
  content: { version: 1, data: { root: { props: title ? { title } : {} }, content: [] } },
});

const pages = [page("/", "Home"), page("/about", "About us")];

/** A site with these pages, collections, menus and redirects, and nothing else. */
const site = (parts: Partial<SiteContent>): SiteContent => ({
  settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph" }),
  menus: {},
  header: { version: 1, data: { root: {}, content: [] } },
  footer: { version: 1, data: { root: {}, content: [] } },
  pages: [],
  collections: [],
  customCss: "",
  ...parts,
});

const blocks = {
  Button: { fields: { href: { type: "text" }, label: { type: "text" } }, render: () => null },
  Text: { fields: { text: { type: "richtext" } }, render: () => null },
} as unknown as Record<string, ComponentConfig>;

const withBlocks = (path: string, title: string, content: unknown[]): Page => ({
  ...page(path, title),
  content: { version: 1, data: { root: { props: { title } }, content } as Page["content"]["data"] },
});

const written = (changes: ReturnType<typeof movePageChanges>, path: string): string => {
  const change = changes.find((candidate) => candidate.path === path);
  return change && "content" in change && typeof change.content === "string" ? change.content : "";
};

describe("slugify", () => {
  it.each([
    ["Mass & Confession Times", "mass-confession-times"],
    ["  Café Menu!  ", "cafe-menu"],
    ["2026 Picnic", "2026-picnic"],
    ["", ""],
  ])("%s → %s", (input, output) => {
    expect(slugify(input)).toBe(output);
  });
});

describe("pageTitle", () => {
  it("uses the page's title, or its address", () => {
    expect(pageTitle(page("/about", " About us "))).toBe("About us");
    expect(pageTitle(page("/untitled"))).toBe("/untitled");
  });
});

describe("checkPageAddress", () => {
  it("normalizes addresses, adding the leading slash", () => {
    expect(checkPageAddress("events/picnic/", pages)).toEqual({ ok: true, path: "/events/picnic" });
  });

  it("refuses invalid, reserved and taken addresses", () => {
    expect(checkPageAddress("/Bad Name", pages)).toEqual({ ok: false, problem: "invalid" });
    expect(checkPageAddress("/admin/x", pages)).toEqual({ ok: false, problem: "reserved" });
    // Its file would be the home page's, and replace it.
    expect(checkPageAddress("/index", pages)).toEqual({ ok: false, problem: "reserved" });
    expect(checkPageAddress("events/index", pages)).toEqual({ ok: false, problem: "reserved" });
    expect(checkPageAddress("/about", pages)).toEqual({ ok: false, problem: "taken" });
  });

  it("allows a page to keep its own address", () => {
    expect(checkPageAddress("/about", pages, "/about")).toEqual({ ok: true, path: "/about" });
  });
});

describe("page file changes", () => {
  it("writes the page's file in canonical form, without Puck's empty zones", () => {
    const change = pageFileChange("/about", { root: { props: { title: "About" } }, content: [], zones: {} }, undefined);
    expect(change).toEqual({
      path: "content/pages/about.json",
      content:
        '{\n  "version": 1,\n  "data": {\n    "content": [],\n    "root": {\n      "props": {\n        "title": "About"\n      }\n    }\n  }\n}\n',
    });
  });

  it("keeps zones that have content", () => {
    const zones = { "a:b": [{ type: "Text", props: { id: "t" } }] };
    expect(storedData({ root: {}, content: [], zones }).zones).toBe(zones);
  });
});

describe("movePageChanges", () => {
  it("sends visitors on from the old address, and keeps redirects to it from going through two", () => {
    const about = page("/about", "About us");
    const changes = movePageChanges(
      site({
        pages: [about],
        redirects: [
          { from: "/about-us", to: "/about" },
          { from: "/who-we-are", to: "/elsewhere" },
          { from: "/about/", to: "/old" },
        ],
        redirectMessage: "Diese Seite ist umgezogen: {page}",
      }),
      about,
      "/who-we-are",
      { redirect: true },
    );
    expect(JSON.parse(written(changes, "content/redirects.json"))).toEqual({
      version: 1,
      redirects: [
        { from: "/about-us", to: "/who-we-are" },
        { from: "/about", to: "/who-we-are" },
      ],
      message: "Diese Seite ist umgezogen: {page}",
    });
    const home = page("/");
    expect(
      movePageChanges(site({ pages: [home] }), home, "/welcome", { redirect: true }).map((change) => change.path),
    ).not.toContain("content/redirects.json");
  });

  it("moves the page and points every link to it at the new address, in one save", () => {
    const about = withBlocks("/about", "About us", [
      { type: "Button", props: { id: "Button-1", href: "/about#history", label: "Our history" } },
    ]);
    const home = withBlocks("/", "Home", [
      { type: "Button", props: { id: "Button-1", href: "/about/", label: "About" } },
      {
        type: "Text",
        props: { id: "Text-1", text: '<p><a href="/about?from=home">Us</a> <a href="/aboutness">x</a></p>' },
      },
    ]);
    const menus: Menus = {
      main: [
        { label: "About", href: "/about", children: [{ label: "Staff", href: "/about/staff" }] },
        { label: "Aboutness", href: "/aboutness" },
      ],
    };
    const changes = movePageChanges(site({ pages: [home, about], menus }), about, "/who-we-are", { blocks });
    expect(changes.map((change) => [change.path, "delete" in change])).toEqual([
      ["content/pages/about.json", true],
      ["content/pages/who-we-are.json", false],
      ["content/pages/index.json", false],
      ["content/menus.json", false],
    ]);
    // Its links to itself move too.
    expect(written(changes, "content/pages/who-we-are.json")).toContain('"href": "/who-we-are#history"');
    const index = written(changes, "content/pages/index.json");
    expect(index).toContain('"href": "/who-we-are"');
    expect(index).toContain('href=\\"/who-we-are?from=home\\"');
    expect(index).toContain('href=\\"/aboutness\\"');
    expect(JSON.parse(written(changes, "content/menus.json")).menus).toEqual({
      main: [
        { label: "About", href: "/who-we-are", children: [{ label: "Staff", href: "/who-we-are/staff" }] },
        { label: "Aboutness", href: "/aboutness" },
      ],
    });
  });

  it("leaves links to pages under the old address that stay where they are", () => {
    const about = page("/about");
    const changes = movePageChanges(
      site({ pages: [about, page("/about/staff")], menus: { main: [{ label: "Staff", href: "/about/staff" }] } }),
      about,
      "/who-we-are",
    );
    expect(changes).toHaveLength(2);
  });
});

describe("settings and CSS changes", () => {
  it("writes site settings with their version", () => {
    const settings = siteSettingsSchema.parse({ version: 1, title: "St. Joseph" });
    const change = siteSettingsFileChange(settings);
    expect("content" in change && JSON.parse(change.content)).toMatchObject({ version: 1, title: "St. Joseph" });
  });

  it("stores custom CSS with one trailing newline, and deletes the file when it's emptied", () => {
    expect(storedCss("a{}\n\n\n")).toBe("a{}\n");
    expect(storedCss("  \n")).toBe("");
    expect(customCssFileChange("a{}")).toEqual({ path: "content/styles/custom.css", content: "a{}\n" });
    expect(customCssFileChange("")).toEqual({ path: "content/styles/custom.css", delete: true });
  });
});

describe("collections", () => {
  const settings = collectionFileSchema.parse({
    version: 1,
    name: "Videos",
    entryName: "Video",
    path: "/videos/{slug}",
    fields: [
      { name: "title", label: "Title", type: "text" },
      {
        name: "kind",
        label: "Kind",
        type: "select",
        options: [
          { value: "homily", label: "Homily" },
          { value: "talk", label: "Talk" },
        ],
      },
      { name: "speaker", label: "Speaker", type: "text" },
    ],
  });
  const entry = (slug: string, fields: Record<string, unknown>): Entry => ({
    collection: "videos",
    slug,
    file: `content/collections/videos/${slug}.json`,
    path: `/videos/${slug}`,
    content: { version: 1, fields },
  });
  const videos: Collection = {
    id: "videos",
    file: "content/collections/videos/_collection.json",
    settings,
    entries: [
      entry("easter", { title: "Easter", kind: "homily", speaker: "Fr. Lee" }),
      entry("advent", { title: "Advent", kind: "talk" }),
    ],
  };

  it("leaves empty fields out of entry files", () => {
    expect(
      entryFileChange(videos, "easter", { title: "Easter", speaker: "", text: "<p></p>", count: 0 }, undefined),
    ).toEqual({
      path: "content/collections/videos/easter.json",
      content: '{\n  "version": 1,\n  "fields": {\n    "count": 0,\n    "title": "Easter"\n  }\n}\n',
    });
  });

  it("points links to items' pages at their new addresses when the address pattern changes", () => {
    const home = withBlocks("/", "Home", [
      { type: "Button", props: { id: "Button-1", href: "/videos/easter", label: "Easter" } },
    ]);
    const changes = collectionSettingsChanges(
      videos,
      { ...settings, path: "/watch/{slug}" },
      { content: site({ pages: [home], collections: [videos] }), blocks },
    );
    expect(changes.map((change) => change.path)).toEqual([
      "content/collections/videos/_collection.json",
      "content/pages/index.json",
    ]);
    expect(changes[1]).toMatchObject({ content: expect.stringContaining('"href": "/watch/easter"') });
  });

  it("removes deleted fields and choices from every entry in the same save", () => {
    const next = {
      ...settings,
      fields: [settings.fields[0], { ...settings.fields[1], options: [{ value: "homily", label: "Homily" }] }],
    } as CollectionFile;
    const changes = collectionSettingsChanges(videos, next);
    expect(changes.map((change) => change.path)).toEqual([
      "content/collections/videos/_collection.json",
      "content/collections/videos/easter.json",
      "content/collections/videos/advent.json",
    ]);
    expect(changes[1]).toMatchObject({ content: expect.not.stringContaining("speaker") });
    expect(changes[2]).toMatchObject({ content: expect.not.stringContaining("talk") });
  });

  it("removes a tag that's no longer offered from every entry's tags, and leaves other entries alone", () => {
    const topics = {
      name: "topics",
      label: "Topics",
      type: "tags" as const,
      options: [
        { value: "music", label: "Music" },
        { value: "youth", label: "Youth" },
      ],
    };
    const tagged: Collection = {
      ...videos,
      settings: { ...settings, fields: [...settings.fields, topics] },
      entries: [
        entry("easter", { title: "Easter", topics: ["music", "youth"] }),
        entry("advent", { title: "Advent", topics: ["youth"] }),
        entry("lent", { title: "Lent", topics: ["music"] }),
      ],
    };
    const next = {
      ...tagged.settings,
      fields: [...settings.fields, { ...topics, options: [{ value: "music", label: "Music" }] }],
    } as CollectionFile;
    const changes = collectionSettingsChanges(tagged, next);
    expect(changes.map((change) => change.path)).toEqual([
      "content/collections/videos/_collection.json",
      "content/collections/videos/easter.json",
      "content/collections/videos/advent.json",
    ]);
    expect(changes[1]).toMatchObject({ content: expect.stringContaining('"topics": [\n      "music"\n    ]') });
    expect(changes[2]).toMatchObject({ content: expect.not.stringContaining("topics") });
  });

  describe("stored as Markdown", () => {
    const docsSettings = collectionFileSchema.parse({
      version: 1,
      name: "Docs",
      entryName: "Page",
      path: "/docs/{slug}",
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Text", type: "richtext" },
      ],
      markdown: { body: "body" },
    });
    const docs: Collection = {
      id: "docs",
      file: "content/collections/docs/_collection.json",
      settings: docsSettings,
      entries: [
        {
          collection: "docs",
          slug: "intro",
          file: "content/collections/docs/intro.md",
          path: "/docs/intro",
          content: { version: 1, fields: { title: "Intro", body: "# Hello\n\nSome **bold** text." } },
        },
      ],
    };

    it("writes entries as Markdown files", () => {
      expect(entryFileChange(docs, "intro", { title: "Intro", body: "Text" }, undefined)).toEqual({
        path: "content/collections/docs/intro.md",
        content: "---\nversion: 1\ntitle: Intro\n---\n\nText\n",
      });
    });

    it("converts every entry when a collection's format changes", () => {
      const { markdown: _markdown, ...asJson } = docsSettings;
      const toJson = collectionSettingsChanges(docs, asJson as CollectionFile);
      expect(toJson.map((change) => ("delete" in change ? `-${change.path}` : change.path))).toEqual([
        "content/collections/docs/_collection.json",
        "-content/collections/docs/intro.md",
        "content/collections/docs/intro.json",
      ]);
      const json = JSON.parse((toJson[2] as { content: string }).content);
      expect(json.fields.body).toBe('<h1 id="hello">Hello</h1>\n<p>Some <strong>bold</strong> text.</p>\n');

      const back = collectionSettingsChanges(
        {
          ...docs,
          settings: asJson as CollectionFile,
          entries: [{ ...(docs.entries[0] as Entry), file: "content/collections/docs/intro.json", content: json }],
        },
        docsSettings,
      );
      expect(back[2]).toEqual({
        path: "content/collections/docs/intro.md",
        content: "---\nversion: 1\ntitle: Intro\n---\n\n# Hello\n\nSome **bold** text.\n",
      });
    });
  });

  it("checks an entry's address against the whole site", () => {
    const addresses = ["/", "/videos/easter", "/videos/advent", "/videos/live"];
    expect(checkEntrySlug("lent", videos, addresses)).toEqual({ ok: true, slug: "lent", path: "/videos/lent" });
    expect(checkEntrySlug("easter", videos, addresses)).toEqual({ ok: false, problem: "taken" });
    expect(checkEntrySlug("live", videos, addresses)).toEqual({ ok: false, problem: "taken" });
    expect(checkEntrySlug("Easter Vigil", videos, addresses)).toEqual({ ok: false, problem: "invalid" });
    expect(checkEntrySlug("easter", videos, addresses, videos.entries[0])).toMatchObject({ ok: true });
  });

  it("moves an entry and the links to it", () => {
    const easter = videos.entries[0] as Entry;
    const changes = moveEntryChanges(
      site({ collections: [videos], menus: { main: [{ label: "Easter", href: "/videos/easter" }] } }),
      videos,
      easter,
      "easter-sunday",
      "/videos/easter-sunday",
    );
    expect(changes.map((change) => change.path)).toEqual([
      "content/collections/videos/easter.json",
      "content/collections/videos/easter-sunday.json",
      "content/menus.json",
    ]);
    expect(changes[2]).toMatchObject({ content: expect.stringContaining('"href": "/videos/easter-sunday"') });
  });

  it("starts new collections with a title, some text and a template showing them", () => {
    const created = newCollectionSettings({
      name: "Events",
      entryName: "Event",
      path: "/events/{slug}",
      withEntryFields: true,
    });
    expect(collectionFileSchema.parse(created).fields.map((field) => field.name)).toEqual(["title", "text"]);
    expect(created.template.content.map((block) => block.props.field)).toEqual(["title", "text"]);
    expect(
      newCollectionSettings({ name: "Staff", entryName: "Person", withEntryFields: false }).template.content,
    ).toEqual([]);
  });

  it("starts collections of events as calendars, with dates and times, a place and a summary", () => {
    const created = collectionFileSchema.parse(
      newCollectionSettings({
        name: "Events",
        entryName: "Event",
        path: "/events/{slug}",
        withEntryFields: true,
        kind: "events",
        blocks: ["EntryField", "AddToCalendar"],
      }),
    );
    expect(created.fields.map((field) => `${field.name}:${field.type}`)).toEqual([
      "title:text",
      "when:event",
      "place:text",
      "summary:textarea",
      "image:image",
      "text:richtext",
    ]);
    expect(created.calendar).toEqual({ when: "when", place: "place", summary: "summary" });
    expect(created.sort).toEqual({ field: "when", order: "asc" });
    expect(created.template.content.map((block) => block.type)).toContain("AddToCalendar");
    // Without the block, the template leaves it out.
    const plain = newCollectionSettings({ name: "Events", entryName: "Event", withEntryFields: true, kind: "events" });
    expect(plain.template.content.map((block) => block.type)).not.toContain("AddToCalendar");
  });

  it("names things uniquely", () => {
    expect(uniqueName("talk", ["talk", "talk-2"])).toBe("talk-3");
    expect(uniqueName("", [], "item")).toBe("item");
    expect(addressPatternFor("/videos/")).toBe("/videos/{slug}");
    expect(addressPatternFor("events")).toBe("/events/{slug}");
  });

  it("deletes a collection with its entries", () => {
    expect(deleteCollectionChanges(videos)).toEqual([
      { path: "content/collections/videos/_collection.json", delete: true },
      { path: "content/collections/videos/easter.json", delete: true },
      { path: "content/collections/videos/advent.json", delete: true },
    ]);
  });
});

describe("media credits", () => {
  const credit = { title: "Choir", creator: "Ann", source: "Flickr", license: "CC BY 2.0" };

  it("writes content/media.json, and removes it once no file has a credit", () => {
    const change = mediaFileChange({ "/media/choir.jpg": credit });
    expect(change.path).toBe("content/media.json");
    const text = "content" in change ? String(change.content) : "";
    expect(JSON.parse(text)).toEqual({ version: 1, credits: { "/media/choir.jpg": credit } });
    expect(text.endsWith("}\n")).toBe(true);
    expect(mediaFileChange({})).toEqual({ path: "content/media.json", delete: true });
  });

  it("drops the credits of files being deleted or replaced", () => {
    const credits = { "/media/choir.jpg": credit, "/media/leaves.jpg": credit };
    expect(withoutCredits(credits, ["/media/other.jpg"])).toBeUndefined();
    expect(withoutCredits(undefined, ["/media/choir.jpg"])).toBeUndefined();
    expect(JSON.stringify(withoutCredits(credits, ["/media/choir.jpg"]))).not.toContain("choir.jpg");
    expect(withoutCredits({ "/media/choir.jpg": credit }, ["/media/choir.jpg"])).toEqual({
      path: "content/media.json",
      delete: true,
    });
  });
});
