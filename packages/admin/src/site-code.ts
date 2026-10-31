/**
 * What the admin panel needs the site's own code for: the pages its blocks add
 * (a calendar's months, a list's later pages), pages rendered to check a
 * publish, and blocks drawn for editor plugins. The admin panel's page never runs that code: it asks the frame that
 * does (`frameSiteCode()` in `frame/host.tsx`), which answers with `localSiteCode()` (`frame/local-code.ts`).
 */
import {
  allPages,
  FOOTER_FILE,
  HEADER_FILE,
  type Page,
  type PageView,
  type SiteContent,
  type SiteProblem,
  syncedBlockUses,
} from "@goodfellow-cms/core";
import type { ComponentData } from "@puckeditor/core";

/** A page to render for the checks, with the file its own content comes from. */
export interface RenderTarget {
  page: Page;
  file: string;
}

/** A block to draw (`drawBlock()`), and where it is. */
export interface DrawTarget {
  /** What it's part of: a page, the header or footer, or a collection's template. */
  kind: "page" | "header" | "footer" | "template";
  /** The page it's on, or the language's home for the header and footer. */
  path: string;
  block: ComponentData;
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
  /**
   * One block drawn as the site draws it, as HTML, for an editor plugin,
   * which has none of the blocks' code: each of its slots is left as an
   * empty `DRAWN_SLOT_ELEMENT` with the slot's name, where the slot's blocks
   * go, and the blocks in them aren't drawn.
   */
  drawBlock(content: SiteContent, target: DrawTarget): Promise<string>;
  /**
   * A block's fields as its props make them, as JSON, for an editor plugin:
   * what the block's `resolveFields` gives, in the page at the target's
   * address, or its own fields where it has none.
   */
  blockFields(content: SiteContent, target: DrawTarget): Promise<Record<string, unknown>>;
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
 * a page or item, an item's page for its collection's design, the first page
 * showing a synced block, and the home page for the header and footer.
 */
export function pagesToRender(content: SiteContent, changed: ReadonlySet<string>): RenderTarget[] {
  const pages = allPages(content);
  const targets = pages.filter((page) => changed.has(page.file)).map((page) => ({ page, file: page.file }));
  for (const collection of content.collections) {
    if (!changed.has(collection.file)) continue;
    const first = pages.find((page) => page.entry?.collection === collection.id);
    if (first && !targets.some((target) => target.page === first)) targets.push({ page: first, file: collection.file });
  }
  // A synced block on the first page that shows it, or that shows the design, header or footer placing it.
  for (const block of content.syncedBlocks ?? []) {
    const file = [block.file, ...Object.values(block.languages ?? {}).map((own) => own.file)].find((path) =>
      changed.has(path),
    );
    if (!file) continue;
    const use = syncedBlockUses(content, block.name)[0];
    const shown =
      use?.kind === "page"
        ? pages.find((page) => page.file === use.file)
        : use?.kind === "template"
          ? pages.find((page) => page.entry?.collection === use.collection)
          : use
            ? (pages.find((page) => page.path === "/") ?? pages[0])
            : undefined;
    if (shown && !targets.some((target) => target.page === shown)) targets.push({ page: shown, file });
  }
  if ((changed.has(HEADER_FILE) || changed.has(FOOTER_FILE)) && targets.length === 0) {
    const home = pages.find((page) => page.path === "/") ?? pages[0];
    if (home) targets.push({ page: home, file: home.file });
  }
  return targets.slice(0, MAX_RENDERED);
}
