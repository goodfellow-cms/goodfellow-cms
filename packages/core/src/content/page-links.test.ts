import { describe, expect, it } from "vitest";
import { contentInLanguage } from "./languages.js";
import type { Page, SiteContent } from "./load.js";
import { pageLinks, pageTree } from "./page-links.js";
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
