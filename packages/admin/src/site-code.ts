/**
 * What the admin panel needs the site's own code for: the pages its blocks add
 * (a calendar's months, a list's later pages), and pages rendered to check a
 * publish. The admin panel's page never runs that code: it asks the frame that
 * does (`frameSiteCode()` in `frame/host.tsx`), which answers with `localSiteCode()`.
 */
import {
  allPages,
  FOOTER_FILE,
  type GoodfellowConfig,
  HEADER_FILE,
  type Page,
  type PageView,
  pageView,
  renderedProblems,
  type SiteContent,
  type SiteProblem,
  sitePages,
} from "@goodfellow-cms/core";
import { createPuckConfigs, PageBody, preparePage } from "@goodfellow-cms/react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** A page to render for the checks, with the file its own content comes from. */
export interface RenderTarget {
  page: Page;
  file: string;
}

export interface SiteCodeService {
  /** Every page a build writes, as `sitePages()` gives them. */
  sitePages(content: SiteContent, today: string): Promise<Page[]>;
  /** Which block a page's added pages are for, as `pageView()` gives it. */
  pageView(page: Page, content: SiteContent, today: string): Promise<PageView | undefined>;
  /**
   * What only shows once pages are rendered, such as images without alt
   * text. A page that can't be rendered is left out, since the editor's
   * preview shows why.
   */
  renderedProblems(content: SiteContent, targets: RenderTarget[], today: string): Promise<SiteProblem[]>;
}

/** The page at an address, as `findSitePage()` gives it: a page a build writes, or "Page not found". */
export async function findPage(
  code: SiteCodeService,
  content: SiteContent,
  today: string,
  path: string,
): Promise<{ page: Page; status: number } | undefined> {
  const pages = await code.sitePages(content, today);
  const page = pages.find((candidate) => candidate.path === path);
  if (page) return { page, status: 200 };
  const notFound = pages.find((candidate) => candidate.path === "/404");
  return notFound && { page: notFound, status: 404 };
}

/** At most this many pages are rendered to check a publish, such as one that changes every item in a collection. */
export const MAX_RENDERED = 10;

/**
 * The pages a publish changes, each with the file its own content comes from:
 * a page or item, an item's page for its collection's design, and the home
 * page for the header and footer.
 */
export function pagesToRender(content: SiteContent, changed: ReadonlySet<string>): RenderTarget[] {
  const pages = allPages(content);
  const targets = pages.filter((page) => changed.has(page.file)).map((page) => ({ page, file: page.file }));
  for (const collection of content.collections) {
    if (!changed.has(collection.file)) continue;
    const first = pages.find((page) => page.entry?.collection === collection.id);
    if (first && !targets.some((target) => target.page === first)) targets.push({ page: first, file: collection.file });
  }
  if ((changed.has(HEADER_FILE) || changed.has(FOOTER_FILE)) && targets.length === 0) {
    const home = pages.find((page) => page.path === "/") ?? pages[0];
    if (home) targets.push({ page: home, file: home.file });
  }
  return targets.slice(0, MAX_RENDERED);
}

/** The site's code run here, in the page that has loaded it: the frame, or tests. */
export function localSiteCode(config: GoodfellowConfig): SiteCodeService {
  const configs = createPuckConfigs(config);
  return {
    async sitePages(content, today) {
      return sitePages(content, today, config.blocks);
    },
    async pageView(page, content, today) {
      return pageView(page, content, today, config.blocks);
    },
    async renderedProblems(content, targets, today) {
      if (targets.length === 0 || typeof document === "undefined") return [];
      const container = document.createElement("div");
      const root = createRoot(container);
      const problems: SiteProblem[] = [];
      try {
        for (const { page, file } of targets.slice(0, MAX_RENDERED)) {
          try {
            // As builds show it, with its added pages' links on the block they're for.
            const view = pageView(page, content, today, config.blocks);
            const prepared = await preparePage(configs, content, view ? { ...page, view } : page);
            flushSync(() =>
              root.render(
                createElement(PageBody, {
                  site: prepared.site,
                  pageConfig: prepared.pageConfig,
                  layoutConfig: prepared.layoutConfig,
                  page: prepared.data,
                  header: prepared.header,
                  footer: prepared.footer,
                }),
              ),
            );
            problems.push(...renderedProblems({ html: container.innerHTML, path: page.path, file }));
          } catch {
            // Left out: the editor's preview shows what's wrong with the page.
          }
        }
      } finally {
        root.unmount();
      }
      return problems;
    },
  };
}
