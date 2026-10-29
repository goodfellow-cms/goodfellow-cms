import { describe, expect, it } from "vitest";
import { contentInLanguage } from "./languages.js";
import type { Page, SiteContent } from "./load.js";
import { breadcrumbs, pageLinks, pageTree } from "./page-links.js";
import { siteSettingsSchema } from "./schemas.js";

function page(path: string, title = ""): Page {
  return { path, file: "", content: { version: 1, data: { root: { props: { title } }, content: [] } } } as Page;
}

function site(pages: Page[], settings: Record<string, unknown> = {}): SiteContent {
  return {
    settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph", ...settings }),
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages,
    collections: [],
    customCss: "",
  };
}

describe("pageLinks", () => {
  it("lists pages by address, with their titles, never Page not found", () => {
    const links = pageLinks(
      site([page("/visit", "Visit"), page("/404", "Page not found"), page("/", "Home"), page("/about")]),
    );
    expect(links).toEqual([
      { path: "/", title: "Home" },
      { path: "/about", title: "/about" },
      { path: "/visit", title: "Visit" },
    ]);
  });

  it("lists only the pages in the language the site is shown in", () => {
    const content = site([page("/", "Home"), page("/es", "Inicio"), page("/es/visitar", "Visitar")], {
      language: "en",
      languages: [{ code: "es" }],
    });
    expect(pageLinks(contentInLanguage(content, "en")).map((link) => link.path)).toEqual(["/"]);
    expect(pageLinks(contentInLanguage(content, "es")).map((link) => link.path)).toEqual(["/es", "/es/visitar"]);
  });
});

describe("pageTree", () => {
  const links = ["/", "/about", "/about/staff", "/about/staff/clergy", "/visit/times"].map((path) => ({
    path,
    title: path,
  }));

  it("nests pages under the nearest page above them", () => {
    const tree = pageTree(links);
    expect(tree.map((node) => node.path)).toEqual(["/", "/about", "/visit/times"]);
    expect(tree[1]?.children.map((node) => node.path)).toEqual(["/about/staff"]);
    expect(tree[1]?.children[0]?.children.map((node) => node.path)).toEqual(["/about/staff/clergy"]);
  });

  it("gives the pages under an address, without the page itself", () => {
    expect(pageTree(links, "/about").map((node) => node.path)).toEqual(["/about/staff"]);
    expect(pageTree(links, "/about/")[0]?.children.map((node) => node.path)).toEqual(["/about/staff/clergy"]);
    expect(pageTree(links, "/nowhere")).toEqual([]);
  });
});

describe("breadcrumbs", () => {
  const pages = [
    { path: "/", title: "Welcome" },
    { path: "/about", title: "About us" },
    { path: "/about/history/1900s", title: "The 1900s" },
    { path: "/news", title: "News" },
    { path: "/es", title: "Bienvenidos" },
    { path: "/es/acerca", title: "Acerca de" },
  ];

  it("leads from the home page through the pages above, skipping addresses that aren't pages", () => {
    expect(breadcrumbs(pages, { path: "/about/history/1900s" })).toEqual({
      links: [
        { path: "/", title: "Welcome" },
        { path: "/about", title: "About us" },
      ],
      current: "The 1900s",
    });
    expect(breadcrumbs(pages, { path: "/" })).toEqual({ links: [], current: "Welcome" });
  });

  it("calls an item's page by its title, under its collection's page", () => {
    expect(breadcrumbs(pages, { path: "/news/fair", title: "The parish fair" })).toEqual({
      links: [
        { path: "/", title: "Welcome" },
        { path: "/news", title: "News" },
      ],
      current: "The parish fair",
    });
  });

  it("starts from the home page of the page's language", () => {
    expect(breadcrumbs(pages, { path: "/es/acerca", home: "/es" })).toEqual({
      links: [{ path: "/es", title: "Bienvenidos" }],
      current: "Acerca de",
    });
  });

  it("puts a page a block adds after the page it's on", () => {
    expect(breadcrumbs(pages, { path: "/news/page/2", view: { path: "/news", title: "Page 2" } })).toEqual({
      links: [
        { path: "/", title: "Welcome" },
        { path: "/news", title: "News" },
      ],
      current: "Page 2",
    });
    expect(breadcrumbs(pages, { path: "/2026-11", view: { path: "/", title: "November 2026" } })).toEqual({
      links: [{ path: "/", title: "Welcome" }],
      current: "November 2026",
    });
  });
});
