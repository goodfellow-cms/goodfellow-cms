/**
 * Pages that blocks add to the page they're on: a calendar's months, a list's
 * later pages and its pages for each choice of a field. Each is the same page
 * at another address, showing something else, which the block reads back from
 * `Page.view` (and `useSite().view` in `@goodfellow-cms/react`).
 */

import { contentForPage } from "./languages.js";
import { allPages, type Page, type SiteContent } from "./load.js";
import { normalizePagePath } from "./paths.js";
import { expandSyncedBlocks } from "./synced-blocks.js";

/** What a page shows of the block that added pages to it. */
export interface PageView {
  /** The id of the block the pages are for: the first block on the page that adds any. */
  block: string;
  /** The address of the page the block is on, which the others are variations of. */
  path: string;
  /** A calendar's month, as `YYYY-MM`. */
  month?: string;
  /** A list's page, counting from 1. */
  page?: number;
  /** A list's choice of a field, by its value. */
  choice?: string;
  /** Added to the page's title, such as "November 2026" or "Page 2". */
  title?: string;
}

/** One page a block adds. */
export interface PageVariant {
  /** Its address after the page's own: `2026-11`, `page/2`, `topics/music/page/2`. */
  suffix: string;
  month?: string;
  page?: number;
  choice?: string;
  title?: string;
}

/** What a block's `pages` function knows. */
export interface BlockPagesContext {
  content: SiteContent;
  /** The page the block is on. */
  page: Page;
  /** Today's date in the site's time zone, as `YYYY-MM-DD`. Pages are rebuilt nightly to keep it current. */
  today: string;
}

/** The pages a block adds, from its props. */
// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
export type BlockPages<Props = any> = (props: Props, context: BlockPagesContext) => PageVariant[];

const BLOCK_PAGES = Symbol.for("goodfellow.pages");

/**
 * Lets a block add pages to the page it's on, such as a page for each month
 * of a calendar or each page of a long list. Builds write them, and the block
 * reads which one it's showing from `useSite().view`. Only the first block on a
 * page that adds pages gets them.
 */
export function withPages<T extends object, Props = Record<string, unknown>>(
  component: T,
  pages: BlockPages<Props>,
): T {
  return Object.assign(component, { [BLOCK_PAGES]: pages });
}

/** The pages a block adds, if it's one that can. */
export function blockPages(component: unknown): BlockPages | undefined {
  if (!component || typeof component !== "object") return undefined;
  const pages = (component as { [BLOCK_PAGES]?: unknown })[BLOCK_PAGES];
  return typeof pages === "function" ? (pages as BlockPages) : undefined;
}

/** The longest list of pages one block can add. */
export const MAX_BLOCK_PAGES = 1000;

/** Joins a page's address and a variant's suffix: `("/", "page/2")` → `/page/2`. */
export function variantPath(path: string, suffix: string): string {
  return path === "/" ? `/${suffix}` : `${path}/${suffix}`;
}

interface Found {
  id: string;
  variants: PageVariant[];
}

/** The first block in Puck data, in the order it's shown, that adds pages. */
function firstPages(value: unknown, blocks: Record<string, unknown>, context: BlockPagesContext): Found | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstPages(item, blocks, context);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as { type?: unknown; props?: Record<string, unknown> };
  if (typeof record.type === "string" && record.props && typeof record.props.id === "string") {
    const pages = blockPages(blocks[record.type]);
    const variants = pages?.(record.props, context) ?? [];
    if (variants.length > 0) return { id: record.props.id, variants: variants.slice(0, MAX_BLOCK_PAGES) };
  }
  for (const child of Object.values(value)) {
    const found = firstPages(child, blocks, context);
    if (found) return found;
  }
  return undefined;
}

/** The block that adds pages to a page: the first in the order it's shown. Entries' pages and "Page not found" get none. */
function blockWithPages(
  page: Page,
  content: SiteContent,
  today: string,
  blocks: Record<string, unknown>,
): Found | undefined {
  if (page.entry || page.path === "/404") return undefined;
  // Blocks see the site in the page's language, so a list counts only that language's items.
  const context = { content: contentForPage(content, page), page, today };
  // Synced blocks count where they're placed, with the ids pages give their blocks.
  const data = expandSyncedBlocks(page.content.data, context.content, context.content.settings.language);
  return firstPages(data.content, blocks, context) ?? firstPages(data.zones, blocks, context);
}

/**
 * What a page itself shows, as `sitePages()` gives it: which block its added
 * pages are for, if any. The editor uses it to show a page as the site will.
 */
export function pageView(
  page: Page,
  content: SiteContent,
  today: string,
  blocks: Record<string, unknown>,
): PageView | undefined {
  const found = blockWithPages(page, content, today, blocks);
  return found && { block: found.id, path: page.path };
}

/**
 * Every page a build writes: the site's pages and its entries' pages (see
 * `allPages`), and the pages blocks add to the page they're on (see
 * `withPages`), such as a calendar's months, around `today`. An added page
 * never takes an address a page or entry already has.
 */
export function sitePages(content: SiteContent, today: string, blocks: Record<string, unknown>): Page[] {
  const pages = allPages(content);
  const taken = new Set(pages.map((page) => page.path));
  const result: Page[] = [];
  for (const page of pages) {
    if (page.entry || page.path === "/404") {
      result.push(page);
      continue;
    }
    const found = blockWithPages(page, content, today, blocks);
    if (!found) {
      result.push(page);
      continue;
    }
    result.push({ ...page, view: { block: found.id, path: page.path } });
    for (const { suffix, ...view } of found.variants) {
      const path = variantPath(page.path, suffix);
      if (taken.has(path)) continue;
      taken.add(path);
      result.push({ ...page, path, view: { block: found.id, path: page.path, ...view } });
    }
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Whether a page is one a block added, rather than the page it's on. */
export function isAddedPage(page: Pick<Page, "path" | "view">): boolean {
  return page.view !== undefined && page.view.path !== page.path;
}

/**
 * The page a build writes at an address, as `sitePages()` gives it, or its
 * "Page not found" page with status 404, or `undefined` if it has neither.
 */
export function findSitePage(
  content: SiteContent,
  today: string,
  blocks: Record<string, unknown>,
  pathname: string,
): { page: Page; status: number } | undefined {
  let path: string;
  try {
    path = normalizePagePath(decodeURIComponent(pathname));
  } catch {
    path = "";
  }
  const pages = sitePages(content, today, blocks);
  const page = pages.find((candidate) => candidate.path === path);
  if (page) return { page, status: 200 };
  const notFound = pages.find((candidate) => candidate.path === "/404");
  return notFound && { page: notFound, status: 404 };
}
