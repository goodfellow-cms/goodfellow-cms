import { describe, expect, it } from "vitest";
import { type ContentSource, loadSiteContent } from "./load.js";
import {
  type EditorLimits,
  limitsFor,
  mayChangeLayout,
  mayChangePage,
  outsideLimits,
  permissionsFileChange,
  reviewersFor,
} from "./permissions.js";
import { serializeContent } from "./serialize.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const page = (title: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  ...extra,
  data: { root: { props: { title } }, content: [] },
});

const menus = { version: 1, menus: { main: [{ label: "Home", href: "/" }] }, languages: { es: { main: [] } } };

const site = () =>
  loadSiteContent(
    memorySource({
      "content/site.json": { version: 1, title: "Parish", language: "en", languages: [{ code: "es" }] },
      "content/pages/index.json": page("Home"),
      "content/pages/news.json": page("News"),
      "content/pages/news/2026.json": page("2026"),
      "content/pages/about.json": page("About"),
      "content/pages/es/noticias.json": page("Noticias", { translationOf: "/news" }),
      "content/menus.json": menus,
      "content/collections/events/_collection.json": {
        version: 1,
        name: "Events",
        entryName: "Event",
        fields: [{ name: "title", label: "Title", type: "text" }],
      },
      "content/collections/events/picnic.json": { version: 1, fields: { title: "Picnic" } },
      "content/collections/events/picnic-es.json": { version: 1, inLanguage: "es", fields: { title: "Picnic" } },
      "content/permissions.json": {
        version: 1,
        people: { Maria: { pages: ["/news"], collections: ["events"], menus: true, languages: ["en"] } },
      },
    }),
  );

const write = (path: string, value: unknown) => ({ path, content: serializeContent(value) });

describe("editors' permissions", () => {
  it("are loaded from the site, and found by sign-in name whatever its case", async () => {
    const content = await site();
    const limits = limitsFor(content.permissions, "maria");
    expect(limits?.pages).toEqual(["/news"]);
    expect(limitsFor(content.permissions, "olivia")).toBeUndefined();
    expect(limitsFor(undefined, "maria")).toBeUndefined();
  });

  it("let someone change pages in their sections, and the translations of those, in their languages", async () => {
    const content = await site();
    const maria = limitsFor(content.permissions, "maria");
    const at = (path: string) => content.pages.find((found) => found.path === path) ?? { path };
    expect(mayChangePage(content, maria, at("/news"))).toBe(true);
    expect(mayChangePage(content, maria, at("/news/2026"))).toBe(true);
    expect(mayChangePage(content, maria, at("/about"))).toBe(false);
    expect(mayChangePage(content, maria, at("/newsletter"))).toBe(false);
    // Spanish isn't one of Maria's languages, though the page translates hers.
    expect(mayChangePage(content, maria, at("/es/noticias"))).toBe(false);
    expect(mayChangePage(content, { pages: ["/news"] }, at("/es/noticias"))).toBe(true);
    expect(mayChangePage(content, undefined, at("/about"))).toBe(true);
    expect(mayChangeLayout(content, maria)).toBe(false);
    expect(mayChangeLayout(content, { layout: true })).toBe(true);
  });

  it("find each change outside someone's limits", async () => {
    const content = await site();
    const maria = limitsFor(content.permissions, "maria");
    expect(
      outsideLimits(content, maria, [
        write("content/pages/news.json", page("News!")),
        write("content/pages/news/2027.json", page("2027")),
        write("content/collections/events/picnic.json", { version: 1, fields: { title: "Big picnic" } }),
      ]),
    ).toEqual([]);
    expect(
      outsideLimits(content, maria, [
        write("content/pages/about.json", page("About us")),
        write("content/collections/events/picnic-es.json", { version: 1, inLanguage: "es", fields: { title: "x" } }),
        write("content/collections/events/_collection.json", {}),
        { path: "public/media/photo.jpg", bytes: new Uint8Array([1]) },
        write("content/layout/header.json", { version: 1, data: { root: {}, content: [] } }),
        write("content/site.json", { version: 1, title: "Parish!" }),
        write("content/permissions.json", { version: 1, people: {} }),
      ]).map((problem) => [problem.kind, problem.path]),
    ).toEqual([
      ["page", "content/pages/about.json"],
      ["entry", "content/collections/events/picnic-es.json"],
      ["other", "content/collections/events/_collection.json"],
      ["media", "public/media/photo.jpg"],
      ["layout", "content/layout/header.json"],
      ["other", "content/site.json"],
      ["other", "content/permissions.json"],
    ]);
  });

  it("check pages and items as they were and as they'd be, so moving one out of someone's limits is outside", async () => {
    const content = await site();
    const maria = limitsFor(content.permissions, "maria");
    const moved = [
      { path: "content/pages/news/2026.json", delete: true as const },
      write("content/pages/past.json", page("2026")),
    ];
    expect(outsideLimits(content, maria, moved).map((problem) => problem.path)).toEqual(["content/pages/past.json"]);
    // Making her item Spanish, which isn't hers.
    const translated = write("content/collections/events/picnic.json", {
      version: 1,
      inLanguage: "es",
      fields: { title: "Picnic" },
    });
    expect(outsideLimits(content, maria, [translated])).toHaveLength(1);
  });

  it("check menus by the languages a change touches", async () => {
    const content = await site();
    const maria = limitsFor(content.permissions, "maria");
    const english = { ...menus, menus: { main: [{ label: "Start", href: "/" }] } };
    const spanish = { ...menus, languages: { es: { main: [{ label: "Inicio", href: "/es" }] } } };
    expect(outsideLimits(content, maria, [write("content/menus.json", english)])).toEqual([]);
    expect(outsideLimits(content, maria, [write("content/menus.json", spanish)])).toEqual([
      { path: "content/menus.json", kind: "menus" },
    ]);
    expect(
      outsideLimits(content, { pages: ["/"] } as EditorLimits, [write("content/menus.json", english)]),
    ).toHaveLength(1);
  });

  it("leave people without limits to change everything their role allows", async () => {
    const content = await site();
    expect(outsideLimits(content, undefined, [write("content/site.json", { version: 1 })])).toEqual([]);
  });

  it("ask the reviewers they name, or else every owner", () => {
    expect(reviewersFor({ people: {}, reviewers: ["olivia"] }, ["maria", "olivia"])).toEqual(["olivia"]);
    expect(reviewersFor({ people: {} }, ["maria", "olivia"])).toEqual(["maria", "olivia"]);
    expect(reviewersFor(undefined, ["olivia"])).toEqual(["olivia"]);
  });

  it("are written in canonical form, people in order", () => {
    const change = permissionsFileChange({ people: { zoe: { media: true }, adam: { pages: ["/"] } } });
    expect(change).toEqual({
      path: "content/permissions.json",
      content: serializeContent({ version: 1, people: { adam: { pages: ["/"] }, zoe: { media: true } } }),
    });
  });
});
