import { describe, expect, it } from "vitest";
import { pageHead, sitemapPages } from "../head.js";
import { calendarFiles } from "./calendars.js";
import { moveEntryChanges, movePageChanges } from "./changes.js";
import { checkSite } from "./checks.js";
import { feedFiles, feedLinks } from "./feeds.js";
import {
  contentForPage,
  contentInLanguage,
  isLanguageHome,
  languageHome,
  languageLinks,
  pageAlternates,
  pageSourceHash,
  pageTranslations,
  pathLanguage,
  settingsPrefix,
  siteLanguages,
  translationState,
} from "./languages.js";
import { allPages, type ContentSource, loadSiteContent } from "./load.js";
import { parseMarkdownEntry, serializeMarkdownEntry } from "./markdown.js";
import { collectionFileSchema } from "./schemas.js";
import { structuredData } from "./structured-data.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const field = (name: string, type: string) => ({ name, label: name, type });
const page = (title: string, extra: Record<string, unknown> = {}) => ({
  version: 1,
  data: { root: { props: { title } }, content: [] },
  ...extra,
});
const aboutData = { root: { props: { title: "About us" } }, content: [] };

const FILES: Record<string, unknown> = {
  "content/site.json": {
    version: 1,
    title: "St. Joseph",
    description: "A parish and school",
    url: "https://parish.example/",
    timeZone: "America/New_York",
    language: "en",
    languages: [{ code: "es", name: "Español" }],
    titleTemplate: "%s | St. Joseph",
    translations: { es: { title: "San José", description: "Una parroquia y escuela", titleTemplate: "%s | San José" } },
  },
  "content/menus.json": {
    version: 1,
    menus: {
      main: [{ label: "About us", href: "/about" }],
      footer: [{ label: "Contact", href: "/about" }],
    },
    languages: { es: { main: [{ label: "Quiénes somos", href: "/es/sobre" }] } },
  },
  "content/layout/header.json": page("Header"),
  "content/layout/header.es.json": page("Encabezado"),
  "content/pages/index.json": page("Home"),
  "content/pages/about.json": { version: 1, data: aboutData },
  "content/pages/es.json": page("Inicio", { translationOf: "/" }),
  "content/pages/es/sobre.json": page("Quiénes somos", { translationOf: "/about" }),
  "content/collections/news/_collection.json": {
    version: 1,
    name: "News",
    entryName: "Story",
    path: "/news/{slug}",
    languagePaths: { es: "/es/noticias/{slug}" },
    sort: { field: "date", order: "desc" },
    fields: [field("title", "text"), field("date", "date")],
  },
  "content/collections/news/fair.json": { version: 1, fields: { title: "The fair", date: "2026-11-01" } },
  "content/collections/news/feria.json": {
    version: 1,
    inLanguage: "es",
    translationOf: "fair",
    fields: { title: "La feria", date: "2026-11-01" },
  },
  "content/collections/news/choir.json": { version: 1, fields: { title: "The choir", date: "2026-11-08" } },
  "content/collections/events/_collection.json": {
    version: 1,
    name: "Events",
    entryName: "Event",
    path: "/events/{slug}",
    calendar: { when: "when" },
    fields: [field("title", "text"), field("when", "event")],
  },
  "content/collections/events/mass.json": {
    version: 1,
    fields: { title: "Mass", when: { start: "2026-11-01T09:00", end: "2026-11-01T10:00" } },
  },
};

const site = (changes: Record<string, unknown> = {}) => loadSiteContent(memorySource({ ...FILES, ...changes }));
const pageAt = async (path: string, content?: Awaited<ReturnType<typeof site>>) => {
  const loaded = content ?? (await site());
  const found = allPages(loaded).find((candidate) => candidate.path === path);
  if (!found) throw new Error(`No page at ${path}`);
  return found;
};

describe("a site's languages", () => {
  it("lists the main language first, with other languages under their codes", async () => {
    const { settings } = await site();
    expect(siteLanguages(settings)).toEqual([
      { code: "en", name: "English", prefix: "", main: true },
      { code: "es", name: "Español", prefix: "/es", main: false },
    ]);
    expect(pathLanguage(settings, "/about")).toBe("en");
    expect(pathLanguage(settings, "/es")).toBe("es");
    expect(pathLanguage(settings, "/es/sobre")).toBe("es");
    // Only the code itself, not an address that starts with the same letters.
    expect(pathLanguage(settings, "/essays")).toBe("en");
    expect(isLanguageHome(settings, "/es")).toBe(true);
    expect(isLanguageHome(settings, "/es/sobre")).toBe(false);
  });

  it("gives items in other languages addresses of that language", async () => {
    const content = await site();
    const news = content.collections.find((collection) => collection.id === "news");
    expect(news?.entries.map((entry) => [entry.slug, entry.path]).sort()).toEqual([
      ["choir", "/news/choir"],
      ["fair", "/news/fair"],
      ["feria", "/es/noticias/feria"],
    ]);
    const events = content.collections.find((collection) => collection.id === "events");
    expect(events?.entries[0]?.path).toBe("/events/mass");
  });

  it("refuses items in languages the site doesn't have", async () => {
    await expect(
      site({
        "content/collections/news/fete.json": { version: 1, inLanguage: "fr", fields: { title: "La fête" } },
      }),
    ).rejects.toThrow(/fr, which isn't one of the site's languages/);
  });

  it("shows the site in a language: its settings, menus, header and items", async () => {
    const content = await site();
    const spanish = contentInLanguage(content, "es");
    expect(spanish.settings).toMatchObject({
      title: "San José",
      description: "Una parroquia y escuela",
      language: "es",
      mainLanguage: "en",
    });
    expect(settingsPrefix(spanish.settings)).toBe("/es");
    // Its own main menu, and the main language's footer menu where it has none of its own.
    expect(spanish.menus.main?.[0]?.href).toBe("/es/sobre");
    expect(spanish.menus.footer?.[0]?.href).toBe("/about");
    expect(spanish.header.data.root.props?.title).toBe("Encabezado");
    expect(spanish.footer).toBe(content.footer);
    const news = spanish.collections.find((collection) => collection.id === "news");
    expect(news?.entries.map((entry) => entry.slug)).toEqual(["feria"]);
    // Showing it again changes nothing.
    expect(contentInLanguage(spanish, "es")).toBe(spanish);

    const english = contentForPage(content, await pageAt("/about", content));
    expect(english.settings.title).toBe("St. Joseph");
    expect(english.settings.mainLanguage).toBeUndefined();
    expect(settingsPrefix(english.settings)).toBe("");
    expect(english.collections.find((collection) => collection.id === "news")?.entries.map((e) => e.slug)).toEqual([
      "choir",
      "fair",
    ]);
  });

  it("shows sites in one language as they are", async () => {
    const content = await site({
      "content/site.json": { version: 1, title: "St. Joseph", language: "en" },
      "content/collections/news/feria.json": undefined,
    });
    expect(contentInLanguage(content, "en")).toBe(content);
    expect(languageLinks(content, await pageAt("/about", content))).toEqual([]);
    expect(pageAlternates(content, await pageAt("/about", content)).size).toBe(0);
  });
});

describe("translations", () => {
  it("groups a page with its translations, from either one", async () => {
    const content = await site();
    const about = await pageAt("/about", content);
    const sobre = await pageAt("/es/sobre", content);
    const paths = (group: Map<string, { path: string }>) =>
      Object.fromEntries([...group].map(([language, translation]) => [language, translation.path]));
    expect(paths(pageTranslations(content, about))).toEqual({ en: "/about", es: "/es/sobre" });
    expect(paths(pageTranslations(content, sobre))).toEqual({ en: "/about", es: "/es/sobre" });
    expect(Object.fromEntries(pageAlternates(content, about))).toEqual({ en: "/about", es: "/es/sobre" });
    expect(Object.fromEntries(pageAlternates(content, await pageAt("/news/fair", content)))).toEqual({
      en: "/news/fair",
      es: "/es/noticias/feria",
    });
    expect(pageAlternates(content, await pageAt("/news/choir", content)).size).toBe(0);
  });

  it("links each language to the page's translation, or to the language's home page", async () => {
    const content = await site();
    expect(languageLinks(content, await pageAt("/es/sobre", content))).toEqual([
      { code: "en", name: "English", path: "/about", translated: true, current: false },
      { code: "es", name: "Español", path: "/es/sobre", translated: true, current: true },
    ]);
    expect(languageLinks(content, await pageAt("/news/choir", content))).toEqual([
      { code: "en", name: "English", path: "/news/choir", translated: true, current: true },
      { code: "es", name: "Español", path: "/es", translated: false, current: false },
    ]);
    expect(languageHome(content, "es")).toBe("/es");
    const withoutHome = await site({ "content/pages/es.json": undefined });
    expect(languageHome(withoutHome, "es")).toBe("/");
  });

  it("tells whether a translation is up to date with what it translates", async () => {
    const about = await pageAt("/about");
    const hash = pageSourceHash(about);
    expect(translationState(hash, undefined)).toBe("missing");
    expect(translationState(hash, {})).toBe("current");
    expect(translationState(hash, { translatedFrom: hash })).toBe("current");
    const changed = await pageAt("/about", await site({ "content/pages/about.json": page("About our parish") }));
    expect(translationState(pageSourceHash(changed), { translatedFrom: hash })).toBe("outdated");
  });

  it("warns about translations that don't translate a page in the main language", async () => {
    const content = await site({
      "content/pages/es/historia.json": page("Historia", { translationOf: "/es/sobre" }),
      "content/pages/history.json": page("History", { translationOf: "/about" }),
    });
    const problems = checkSite(content, { media: [] }).filter((problem) => problem.kind === "bad-translation");
    expect(problems).toEqual([
      { kind: "bad-translation", severity: "warning", file: "content/pages/es/historia.json", target: "/es/sobre" },
      { kind: "bad-translation", severity: "warning", file: "content/pages/history.json", target: "/about" },
    ]);
    // A translation of a page that isn't there is a missing link.
    const missing = await site({ "content/pages/es/nada.json": page("Nada", { translationOf: "/nothing" }) });
    expect(checkSite(missing, { media: [] }).some((problem) => problem.kind === "missing-page")).toBe(true);
  });

  it("keeps translations linked when a page moves or an item is renamed", async () => {
    const content = await site();
    const moved = movePageChanges(content, await pageAt("/about", content), "/about-us");
    const sobre = moved.find((change) => change.path === "content/pages/es/sobre.json");
    expect(sobre && "content" in sobre && JSON.parse(sobre.content).translationOf).toBe("/about-us");
    const menus = moved.find((change) => change.path === "content/menus.json");
    expect(menus && "content" in menus && JSON.parse(menus.content).menus.main[0].href).toBe("/about-us");

    const news = content.collections.find((collection) => collection.id === "news");
    const fair = news?.entries.find((entry) => entry.slug === "fair");
    if (!news || !fair) throw new Error("No fair");
    const renamed = moveEntryChanges(content, news, fair, "summer-fair", "/news/summer-fair");
    const feria = renamed.find((change) => change.path === "content/collections/news/feria.json");
    expect(feria && "content" in feria && JSON.parse(feria.content)).toMatchObject({
      inLanguage: "es",
      translationOf: "summer-fair",
    });
  });

  it("keeps an item's language and translation in Markdown front matter", () => {
    const settings = collectionFileSchema.parse({
      version: 1,
      name: "Posts",
      entryName: "Post",
      fields: [
        { name: "title", label: "Title", type: "text" },
        { name: "body", label: "Body", type: "richtext" },
      ],
      markdown: { body: "body" },
    });
    const text = serializeMarkdownEntry(
      settings,
      { title: "La feria", body: "Juegos y comida." },
      { inLanguage: "es", translationOf: "fair", translatedFrom: "0123456789abcdef" },
    );
    expect(text).toContain("inLanguage: es\n");
    expect(parseMarkdownEntry(text, "body")).toMatchObject({
      inLanguage: "es",
      translationOf: "fair",
      translatedFrom: "0123456789abcdef",
      fields: { title: "La feria", body: "Juegos y comida." },
    });
  });
});

describe("search engines", () => {
  it("names each page in its language and links its translations", async () => {
    const content = await site();
    const head = pageHead(content, await pageAt("/es/sobre", content));
    expect(head).toMatchObject({ title: "Quiénes somos | San José", language: "es" });
    expect(head.alternates).toEqual([
      { language: "en", href: "https://parish.example/about" },
      { language: "es", href: "https://parish.example/es/sobre" },
      { language: "x-default", href: "https://parish.example/about" },
    ]);
    // A language's home page is named after the site in that language.
    expect(pageHead(content, await pageAt("/es", content)).title).toBe("Inicio");
    expect(pageHead(content, await pageAt("/news/choir", content)).alternates).toBeUndefined();
  });

  it("lists translations in the sitemap, and describes each language's home page", async () => {
    const content = await site();
    const listed = sitemapPages(content, [await pageAt("/about", content), await pageAt("/news/choir", content)]);
    expect(listed).toEqual([
      {
        url: "https://parish.example/about",
        alternates: {
          en: "https://parish.example/about",
          es: "https://parish.example/es/sobre",
          "x-default": "https://parish.example/about",
        },
      },
      { url: "https://parish.example/news/choir" },
    ]);
    const [website] = structuredData(content, await pageAt("/es", content));
    expect(website).toMatchObject({ name: "San José", url: "https://parish.example/es", inLanguage: "es" });
  });
});

describe("files in each language", () => {
  it("writes each language's feeds under its code, with its own items", async () => {
    const content = await site();
    const files = feedFiles(content, new Date("2026-11-10T00:00:00Z"));
    expect(files.map((file) => file.path)).toEqual([
      "/feeds/news.rss",
      "/feeds/news.atom",
      "/es/feeds/news.rss",
      "/es/feeds/news.atom",
    ]);
    const spanish = files.find((file) => file.path === "/es/feeds/news.rss")?.content ?? "";
    expect(spanish).toContain("La feria");
    expect(spanish).not.toContain("The choir");
    expect(spanish).toContain("https://parish.example/es/noticias/feria");
    expect(feedLinks(contentInLanguage(content, "es"))).toEqual([
      { title: "News – San José", href: "/es/feeds/news.rss" },
    ]);
  });

  it("writes calendar files only for the languages that have events", async () => {
    const paths = calendarFiles(await site()).map((file) => file.path);
    expect(paths).toEqual(["/calendars/events.ics", "/calendars/events/mass.ics"]);
  });
});
