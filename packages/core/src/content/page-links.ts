import { pageTitle } from "./changes.js";
import { pathLanguage } from "./languages.js";
import type { SiteContent } from "./load.js";

/** A page as lists of the site's pages show it. */
export interface PageLink {
  /** The page's address, such as `/about`. */
  path: string;
  title: string;
}

/**
 * The site's pages in the language it's shown in, by address, for lists of
 * pages such as the Page list block: never "Page not found", items' pages or
 * pages blocks add. Give it the site as a language shows it
 * (`contentInLanguage()`), or as loaded on a site in one language.
 */
export function pageLinks(content: SiteContent): PageLink[] {
  const { settings } = content;
  return content.pages
    .filter(
      (page) =>
        page.path !== "/404" && !page.entry && !page.view && pathLanguage(settings, page.path) === settings.language,
    )
    .map((page) => ({ path: page.path, title: pageTitle(page) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The pages under `parent` (the whole site's for `/`), each with the ones under it, as lists of pages nest them. */
export interface PageTree extends PageLink {
  children: PageTree[];
}

/**
 * Nests pages by their addresses: `/about/team` goes under `/about` where
 * there's such a page, and otherwise under the nearest page above it. The
 * home page is the first of the top level, not every page's parent.
 */
export function pageTree(pages: PageLink[], parent = "/"): PageTree[] {
  const root = parent === "/" ? "" : parent.replace(/\/$/, "");
  const under = pages.filter((page) => page.path !== root && (root === "" || page.path.startsWith(`${root}/`)));
  const known = new Set(under.map((page) => page.path));
  const parentOf = (path: string): string => {
    let at = path;
    while (at.lastIndexOf("/") > 0) {
      at = at.slice(0, at.lastIndexOf("/"));
      if (at !== root && known.has(at)) return at;
    }
    return "";
  };
  const nodes = new Map(under.map((page) => [page.path, { ...page, children: [] as PageTree[] }]));
  const top: PageTree[] = [];
  for (const page of under) {
    const node = nodes.get(page.path) as PageTree;
    // The home page is "/", which every address starts with, so it stays at the top.
    const above = page.path === "/" ? "" : parentOf(page.path);
    (above ? (nodes.get(above) as PageTree).children : top).push(node);
  }
  return top;
}
