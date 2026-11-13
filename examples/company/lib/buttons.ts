// Where a Buy button's price comes from (blocks/buy-button.tsx): the page as visitors see it, never the browser.
import {
  allPages,
  type ContentSource,
  expandSyncedBlocks,
  layoutIn,
  loadSiteContent,
  normalizePagePath,
  pathLanguage,
  type SiteContent,
  shownContent,
} from "@goodfellow-cms/core";
import { BUY_BUTTON_BLOCK, PRICE_ID } from "../blocks/buy-button.tsx";
import type { Button, ButtonPlace } from "./stripe.ts";

/** The first block of `type` with the id `id` anywhere in Puck's data: its content, slots, or drop zones. */
function blockIn(value: unknown, type: string, id: string): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = blockIn(item, type, id);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const block = value as { type?: unknown; props?: Record<string, unknown> };
  if (block.type === type && block.props?.id === id) return block.props;
  for (const item of Object.values(value)) {
    const found = blockIn(item, type, id);
    if (found) return found;
  }
  return undefined;
}

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
    .map((data) => blockIn(expandSyncedBlocks(data, content, language), BUY_BUTTON_BLOCK, place.block))
    .find(Boolean);
  const price = typeof props?.price === "string" ? props.price : "";
  return PRICE_ID.test(price) ? { price } : undefined;
}

/** The Buy button at `place` on the site `source` holds, as visitors see it now (`buttonOn()`). */
export async function buttonFrom(source: ContentSource, place: ButtonPlace): Promise<Button | undefined> {
  return buttonOn(shownContent(await loadSiteContent(source)), place);
}
