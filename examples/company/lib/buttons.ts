// Where a Buy button's price comes from (blocks/buy-button.tsx): the page as visitors see it, never the browser.
import {
  allPages,
  expandSyncedBlocks,
  layoutIn,
  normalizePagePath,
  pathLanguage,
  type SiteContent,
  siteLanguages,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { BUY_BUTTON_BLOCK, PRICE_ID } from "../blocks/buy-button.tsx";
import type { Button, ButtonPlace } from "./stripe.ts";

/**
 * The Buy button at `place` in `content`, the site as visitors see it (`shownContent()`): the price its owners gave
 * it, or nothing for a page the site doesn't have, or a button that isn't on it or has no price. It's looked for on the
 * page, then in the header and footer it's shown with, all in the page's language, with synced blocks put in place
 * first, as pages render them, so a button in one is found by the id it has there.
 */
export function buttonOn(content: SiteContent, place: ButtonPlace): Button | undefined {
  let path: string;
  try {
    path = normalizePagePath(place.page);
  } catch {
    return undefined;
  }
  const page = allPages(content).find((candidate) => candidate.path === path);
  if (!page) return undefined;
  const language = pathLanguage(content.settings, page.path);
  const shown = [
    page.content.data,
    layoutIn(content, "header", language).data,
    layoutIn(content, "footer", language).data,
  ];
  const props = shown
    .map((data) => buttonsIn(expandSyncedBlocks(data, content, language)).find((props) => props.id === place.block))
    .find(Boolean);
  const price = typeof props?.price === "string" ? props.price : "";
  return PRICE_ID.test(price) ? { price } : undefined;
}

/** A Buy button as the Payments page lists it: where it is, its words, and the price its owners gave it, if any. */
export interface ListedButton {
  /** The page it's on, or, for one in a header or footer, which is on every page in its language, that one's home. */
  page: string;
  /** Where on the page: the page itself, or the header or footer it's shown with. */
  part: "page" | "header" | "footer";
  /** The button's own id there. */
  block: string;
  label: string;
  /** What owners put in its price, as they put it: a price id, something else, or nothing. */
  price: string;
}

/** Every Buy button's props in Puck's data, in the order they're shown. */
function buttonsIn(value: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) buttonsIn(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const block = value as { type?: unknown; props?: Record<string, unknown> };
  if (block.type === BUY_BUTTON_BLOCK && block.props) found.push(block.props);
  for (const item of Object.values(value)) buttonsIn(item, found);
  return found;
}

/**
 * Every Buy button on the site as visitors see it (`shownContent()`), as `buttonOn()` finds them: on each page, and
 * in each language's header and footer once, with synced blocks put in place first. Buttons without a price are
 * listed too, since they're what owners need to fix.
 */
export function buttonsOn(content: SiteContent): ListedButton[] {
  const listed: ListedButton[] = [];
  const add = (page: string, part: ListedButton["part"], data: Data, language: string) => {
    for (const props of buttonsIn(expandSyncedBlocks(data, content, language))) {
      listed.push({
        page,
        part,
        block: String(props.id ?? ""),
        label: typeof props.label === "string" ? props.label : "",
        price: typeof props.price === "string" ? props.price : "",
      });
    }
  };
  for (const page of allPages(content)) {
    add(page.path, "page", page.content.data, pathLanguage(content.settings, page.path));
  }
  // A language without a header or footer of its own shows the main language's, listed once, with the main one.
  for (const language of siteLanguages(content.settings)) {
    const home = language.main ? "/" : language.prefix;
    for (const part of ["header", "footer"] as const) {
      const layout = layoutIn(content, part, language.code);
      if (!language.main && layout === content[part]) continue;
      add(home, part, layout.data, language.code);
    }
  }
  return listed;
}
