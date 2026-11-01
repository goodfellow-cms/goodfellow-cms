import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type ContentSource, loadSiteContent } from "./content/load.js";
import {
  parseTransferManifest,
  planSiteImport,
  type SiteImport,
  SiteImportError,
  type SiteImportOptions,
  transferManifest,
  transferPaths,
} from "./site-transfer.js";

const json = (value: unknown) => JSON.stringify(value);
const page = (title: string, content: unknown[] = []) =>
  json({ version: 1, data: { root: { props: { title } }, content } });
const text = (id: string, words: string) => ({ type: "Text", props: { id, content: `<p>${words}</p>` } });
const NEWS = {
  version: 1,
  name: "News",
  entryName: "Story",
  path: "/news/{slug}",
  fields: [
    { name: "title", label: "Title", type: "text" },
    { name: "date", label: "Date", type: "date" },
  ],
};

/** The site receiving the export. */
const SITE: Record<string, string> = {
  "content/site.json": json({ version: 1, title: "St. Anne", url: "https://stanne.example.org/" }),
  "content/menus.json": json({ version: 1, menus: { main: [{ label: "Home", href: "/" }] } }),
  "content/permissions.json": json({ version: 1, editors: {} }),
  "content/pages/index.json": page("Welcome to St. Anne", [text("Text-1", "Hello")]),
  "content/pages/about.json": page("About St. Anne"),
  "content/collections/news/_collection.json": json(NEWS),
  "content/collections/news/picnic.json": json({ version: 1, fields: { title: "Picnic", date: "2026-07-01" } }),
  "content/collections/news/fair.json": json({ version: 1, fields: { title: "Our fair", date: "2026-10-01" } }),
  "public/media/logo.png": "<site logo>",
};

/** The other site's export. */
const EXPORT: Record<string, string> = {
  "goodfellow-transfer.json": json({ version: 1, title: "St. Brendan", content: { page: 1 }, blocks: [], media: true }),
  "content/site.json": json({
    version: 1,
    title: "St. Brendan",
    url: "https://stbrendan.example.org/",
    languages: [{ code: "es", name: "Español" }],
  }),
  "content/menus.json": json({ version: 1, menus: { footer: [{ label: "Contact", href: "/contact" }] } }),
  "content/permissions.json": json({ version: 1, editors: { someone: { pages: ["/"] } } }),
  "content/updates.json": json({ version: 1, automatic: false }),
  "content/pages/index.json": page("Welcome to St. Brendan"),
  "content/pages/about.json": page("About St. Anne"),
  "content/pages/contact.json": page("Contact", [text("Text-2", "Call us")]),
  "content/pages/es/index.json": page("Bienvenidos"),
  "content/pages/faq.json": page("Questions", [{ type: "shadcn-faq", props: { id: "faq-1" } }, text("Text-3", "Ask")]),
  "content/collections/news/_collection.json": json(NEWS),
  "content/collections/news/fair.json": json({ version: 1, fields: { title: "The fall fair", date: "2026-10-04" } }),
  "content/collections/news/choir.json": json({ version: 1, fields: { title: "Choir", date: "2026-09-01" } }),
  "content/media.json": json({
    version: 1,
    credits: {},
    descriptions: { "/media/church.jpg": { text: "The church" } },
  }),
  "public/media/church.jpg": "<church photo>",
  "public/media/logo.png": "<another logo>",
  "blocks/installed/installed.json": json({
    version: 1,
    blocks: {
      "shadcn-faq": { source: "@goodfellow/shadcn-faq", title: "FAQ", category: "Content", entry: "x.tsx", files: {} },
    },
  }),
};

const BLOCKS = ["Text", "Heading", "Section"];

function memorySource(files: Record<string, string>): ContentSource {
  return {
    read: async (path) => files[path],
    list: async (dir) => Object.keys(files).filter((path) => path.startsWith(`${dir}/`)),
  };
}

async function plan(
  site: Record<string, string>,
  exported: Record<string, string>,
  options: Partial<SiteImportOptions> = {},
): Promise<{ result: SiteImport; after: Record<string, string> }> {
  const content = await loadSiteContent(memorySource(site));
  const result = await planSiteImport(
    { paths: Object.keys(exported), read: (path) => exported[path] },
    { content, files: Object.keys(site), read: async (path) => site[path] },
    { blocks: BLOCKS, ...options },
  );
  const after = { ...site };
  for (const change of result.changes) {
    if ("delete" in change) delete after[change.path];
    else if ("content" in change) after[change.path] = change.content;
  }
  for (const path of result.media) after[path] = exported[path] as string;
  return { result, after };
}

describe("planSiteImport, adding", () => {
  it("brings in what the site doesn't have, and lists what it has differently, keeping the site's", async () => {
    const { result, after } = await plan(SITE, EXPORT);
    expect(after["content/pages/contact.json"]).toBe(EXPORT["content/pages/contact.json"]);
    expect(after["content/collections/news/choir.json"]).toBe(EXPORT["content/collections/news/choir.json"]);
    expect(after["public/media/church.jpg"]).toBe("<church photo>");
    // The same page in both isn't a conflict, nor written again.
    expect(result.changes.some((change) => change.path === "content/pages/about.json")).toBe(false);
    expect(result.conflicts).toEqual([
      { key: "page:content/pages/index.json", kind: "page", name: "Welcome to St. Brendan", detail: "/" },
      { key: "item:news/fair", kind: "item", name: "The fall fair", detail: "News" },
      { key: "media:public/media/logo.png", kind: "media", name: "/media/logo.png" },
    ]);
    // Kept as the site has them until chosen.
    expect(after["content/pages/index.json"]).toBe(SITE["content/pages/index.json"]);
    expect(after["public/media/logo.png"]).toBe("<site logo>");
    // What the media library says about the photos it brings in comes too.
    expect(JSON.parse(after["content/media.json"] ?? "{}").descriptions).toEqual({
      "/media/church.jpg": { text: "The church" },
    });
    expect(result.summary).toMatchObject({ title: "St. Brendan", pages: 2, items: 1, media: 1, menus: false });
    await expect(loadSiteContent(memorySource(after))).resolves.toBeDefined();
  });

  it("takes the export's version of what's chosen", async () => {
    const { after } = await plan(SITE, EXPORT, {
      take: new Set(["page:content/pages/index.json", "item:news/fair", "media:public/media/logo.png"]),
    });
    expect(after["content/pages/index.json"]).toBe(EXPORT["content/pages/index.json"]);
    expect(after["content/collections/news/fair.json"]).toBe(EXPORT["content/collections/news/fair.json"]);
    expect(after["public/media/logo.png"]).toBe("<another logo>");
    // Media both have with the same bytes isn't asked about.
    const same = await plan(SITE, EXPORT, { sameMedia: new Set(["public/media/logo.png"]) });
    expect(same.result.conflicts.map((conflict) => conflict.kind)).not.toContain("media");
  });

  it("never brings in the Site address, editors' limits or update settings, and adds the export's languages", async () => {
    const { result, after } = await plan(SITE, EXPORT);
    expect(after["content/permissions.json"]).toBe(SITE["content/permissions.json"]);
    expect(after["content/updates.json"]).toBeUndefined();
    const settings = JSON.parse(after["content/site.json"] ?? "{}");
    expect(settings).toMatchObject({ title: "St. Anne", url: "https://stanne.example.org/" });
    expect(settings.languages).toEqual([{ code: "es", name: "Español" }]);
    expect(result.notes).toContainEqual({ kind: "languages", codes: ["es"] });
    expect(result.notes).toContainEqual({ kind: "kept", things: ["address", "limits", "updates"] });

    // Site Settings and menus come only when chosen, still without the address.
    const chosen = await plan(SITE, EXPORT, { settings: true, menus: true });
    expect(JSON.parse(chosen.after["content/site.json"] ?? "{}")).toMatchObject({
      title: "St. Brendan",
      url: "https://stanne.example.org/",
    });
    expect(JSON.parse(chosen.after["content/menus.json"] ?? "{}").menus).toEqual({
      main: [{ label: "Home", href: "/" }],
      footer: [{ label: "Contact", href: "/contact" }],
    });
  });

  it("leaves out what uses blocks the site lacks, offering Goodfellow's registry's, or brings it in without them", async () => {
    const { result, after } = await plan(SITE, EXPORT);
    expect(after["content/pages/faq.json"]).toBeUndefined();
    expect(result.installable).toEqual([{ name: "shadcn-faq", source: "@goodfellow/shadcn-faq", title: "FAQ" }]);
    expect(result.notes).toEqual(
      expect.arrayContaining([
        { kind: "missing-block", name: "shadcn-faq", items: ["Questions (/faq)"], installable: true },
        { kind: "left-out", items: ["Questions (/faq)"] },
      ]),
    );
    // Installing it in the same publish brings the page in as it is.
    const installing = await plan(SITE, EXPORT, { installing: ["shadcn-faq"] });
    expect(installing.after["content/pages/faq.json"]).toBe(EXPORT["content/pages/faq.json"]);

    const without = await plan(SITE, EXPORT, { withoutMissingBlocks: true });
    const faq = JSON.parse(without.after["content/pages/faq.json"] ?? "{}");
    expect(faq.data.content).toEqual([text("Text-3", "Ask")]);
    expect(without.result.notes).toContainEqual({ kind: "without-blocks", items: ["Questions (/faq)"] });
  });

  it("brings a collection with other fields in only when it's taken whole, replacing the site's", async () => {
    const exported = {
      ...EXPORT,
      "content/collections/news/_collection.json": json({
        ...NEWS,
        fields: [...NEWS.fields, { name: "speaker", label: "Speaker", type: "text" }],
      }),
    };
    const kept = await plan(SITE, exported);
    expect(kept.result.conflicts).toContainEqual({ key: "collection:news", kind: "collection", name: "News" });
    expect(kept.result.notes).toContainEqual({ kind: "collection-differs", collections: ["News"] });
    expect(kept.after["content/collections/news/choir.json"]).toBeUndefined();

    const whole = await plan(SITE, exported, { take: new Set(["collection:news"]) });
    expect(whole.after["content/collections/news/_collection.json"]).toBe(
      exported["content/collections/news/_collection.json"],
    );
    expect(whole.after["content/collections/news/choir.json"]).toBeDefined();
    expect(whole.after["content/collections/news/picnic.json"]).toBeUndefined();
    await expect(loadSiteContent(memorySource(whole.after))).resolves.toBeDefined();
  });

  it("leaves out new pages at addresses the site's items have", async () => {
    const { result, after } = await plan(SITE, {
      ...EXPORT,
      "content/pages/news/picnic.json": page("A picnic page"),
    });
    expect(after["content/pages/news/picnic.json"]).toBeUndefined();
    expect(result.notes).toContainEqual({ kind: "taken", items: ["A picnic page (/news/picnic)"] });
  });

  it("links to media the export's storage keeps where it's kept", async () => {
    const { result, after } = await plan(SITE, {
      ...EXPORT,
      "content/media-storage.json": json({
        version: 1,
        plugin: "goodfellow-plugin-s3",
        url: "https://media.example.org/",
        files: { "/media/sermon.mp4": { size: 10 } },
      }),
      "content/pages/sermons.json": page("Sermons", [text("Text-4", '<a href="/media/sermon.mp4">Listen</a>')]),
    });
    expect(after["content/pages/sermons.json"]).toContain("https://media.example.org/sermon.mp4");
    expect(after["content/media-storage.json"]).toBeUndefined();
    expect(result.notes).toContainEqual({ kind: "stored-media", count: 1, merged: false });
  });
});

describe("planSiteImport, replacing", () => {
  it("makes the site's content the export's, keeping what's never imported", async () => {
    const { result, after } = await plan(SITE, EXPORT, { withoutMissingBlocks: true });
    // Adding keeps what the export doesn't have.
    expect(after["content/collections/news/picnic.json"]).toBe(SITE["content/collections/news/picnic.json"]);
    const replaced = await plan(SITE, EXPORT, { replace: true, withoutMissingBlocks: true });
    expect(replaced.after["content/collections/news/picnic.json"]).toBeUndefined();
    expect(replaced.after["content/pages/index.json"]).toBe(EXPORT["content/pages/index.json"]);
    expect(JSON.parse(replaced.after["content/menus.json"] ?? "")).toEqual(
      JSON.parse(EXPORT["content/menus.json"] ?? ""),
    );
    expect(replaced.after["public/media/logo.png"]).toBe("<another logo>");
    expect(replaced.after["content/permissions.json"]).toBe(SITE["content/permissions.json"]);
    expect(JSON.parse(replaced.after["content/site.json"] ?? "{}")).toMatchObject({
      title: "St. Brendan",
      url: "https://stanne.example.org/",
    });
    expect(replaced.result.conflicts).toEqual([]);
    expect(replaced.result.summary.removed).toBe(1);
    expect(result.summary.removed).toBe(0);
    await expect(loadSiteContent(memorySource(replaced.after))).resolves.toBeDefined();
  });

  it("keeps the site's own file where the export's is left out for its blocks", async () => {
    const { after } = await plan({ ...SITE, "content/pages/faq.json": page("Our questions") }, EXPORT, {
      replace: true,
    });
    expect(after["content/pages/faq.json"]).toBe(page("Our questions"));
  });

  it("moves the parish example into another site whole", async () => {
    const root = new URL("../../../examples/parish", import.meta.url).pathname;
    const exported: Record<string, string> = {};
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else exported[relative(root, path).split("\\").join("/")] = await readFile(path, "utf8");
      }
    };
    await walk(join(root, "content"));
    const from = await loadSiteContent(memorySource(exported));
    const used = transferManifest(from).blocks;
    const { after } = await plan(SITE, exported, { replace: true, blocks: used });
    const moved = await loadSiteContent(memorySource(after));
    expect(moved.pages.map((found) => found.path)).toEqual(from.pages.map((found) => found.path));
    expect(moved.collections.map((found) => [found.id, found.entries.length])).toEqual(
      from.collections.map((found) => [found.id, found.entries.length]),
    );
    expect(moved.settings.url).toBe("https://stanne.example.org/");
  });
});

describe("planSiteImport's refusals", () => {
  it("refuses what isn't a site, and content newer than this release reads", async () => {
    await expect(plan(SITE, { "readme.txt": "hi" })).rejects.toThrow(SiteImportError);
    const newer = await plan(SITE, {
      ...EXPORT,
      "goodfellow-transfer.json": json({ version: 1, content: { page: 99 }, goodfellow: "9.0.0" }),
    }).catch((error: unknown) => error);
    expect(newer).toBeInstanceOf(SiteImportError);
    expect((newer as SiteImportError).problem).toBe("newer");
    const file = await plan(SITE, { ...EXPORT, "content/pages/contact.json": json({ version: 99, data: {} }) }).catch(
      (error: unknown) => error,
    );
    expect((file as SiteImportError).problem).toBe("newer");
  });
});

describe("transferPaths", () => {
  it("finds the site's files in one folder, and only safe ones", () => {
    expect(
      [
        ...transferPaths([
          "st-brendan/content/site.json",
          "st-brendan/content/pages/index.json",
          "st-brendan/public/media/a.jpg",
          "st-brendan/src/evil.ts",
          "st-brendan/content/../x.json",
        ]),
      ].sort(),
    ).toEqual([
      ["content/pages/index.json", "st-brendan/content/pages/index.json"],
      ["content/site.json", "st-brendan/content/site.json"],
      ["public/media/a.jpg", "st-brendan/public/media/a.jpg"],
    ]);
    expect(transferPaths(["notes/readme.md"]).size).toBe(0);
  });
});

describe("transferManifest", () => {
  it("lists the blocks the site uses, and reads back", async () => {
    const content = await loadSiteContent(memorySource(EXPORT));
    const manifest = transferManifest(content, { now: new Date("2026-11-01T12:00:00Z") });
    expect(manifest.blocks).toEqual(["Text", "shadcn-faq"]);
    expect(manifest.made).toBe("2026-11-01T12:00:00.000Z");
    expect(parseTransferManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect(parseTransferManifest("nope")).toBeUndefined();
  });
});
