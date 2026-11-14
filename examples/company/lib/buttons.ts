// Where a Buy button's price comes from (blocks/buy-button.tsx): the page as visitors see it, never the browser.
import {
  allPages,
  expandSyncedBlocks,
  isMembersOnly,
  layoutIn,
  normalizePagePath,
  pathLanguage,
  type SiteContent,
  siteLanguages,
  teaserData,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { BUY_BUTTON_BLOCK, PRICE_ID } from "../blocks/buy-button.tsx";
import { PAYWALL_BLOCK } from "../blocks/paywall.tsx";
import type { Reader } from "./paywall.ts";
import type { Button, ButtonPlace } from "./stripe.ts";

/**
 * The Buy button at `place` in `content`, the site as visitors see it (`shownContent()`): the price its owners gave
 * it, or nothing for a page the site doesn't have, or a button that isn't on it or has no price. It's looked for on the
 * page, then in the header and footer it's shown with, all in the page's language, with synced blocks put in place
 * first, as pages render them, so a button in one is found by the id it has there. On a members-only page, someone
 * who isn't a member (`reader`) sees only its teaser (`teaserData()`), so a button after its Paywall is theirs only
 * once they're members, as the page shows it.
 */
export function buttonOn(content: SiteContent, place: ButtonPlace, reader: Reader = "everyone"): Button | undefined {
  let path: string;
  try {
    path = normalizePagePath(place.page);
  } catch {
    return undefined;
  }
  // A page of the site's, or one a block adds, or "Page not found": the header and footer show on every one, in its
  // language; a page's own buttons are on the pages the site has, which a page a block adds names as its own.
  const page = allPages(content).find((candidate) => candidate.path === path);
  const language = pathLanguage(content.settings, path);
  const shown = [
    ...(page ? [page.content.data] : []),
    layoutIn(content, "header", language).data,
    layoutIn(content, "footer", language).data,
  ].map((data, index) => {
    const expanded = expandSyncedBlocks(data, content, language);
    const teaser = page && index === 0 && reader === "everyone" && isMembersOnly(page, content.collections);
    return teaser ? teaserData(expanded, PAYWALL_BLOCK) : expanded;
  });
  const props = shown.map((data) => buttonsIn(data).find((props) => props.id === place.block)).find(Boolean);
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
  const found = (page: string, part: ListedButton["part"], data: Data, language: string): ListedButton[] =>
    buttonsIn(expandSyncedBlocks(data, content, language)).map((props) => ({
      page,
      part,
      block: String(props.id ?? ""),
      label: typeof props.label === "string" ? props.label : "",
      price: typeof props.price === "string" ? props.price : "",
    }));
  for (const page of allPages(content)) {
    listed.push(...found(page.path, "page", page.content.data, pathLanguage(content.settings, page.path)));
  }
  // A language without a header or footer of its own shows the main language's, listed once, with the main one,
  // unless a synced block in it has a version of its own in that language, whose buttons are listed too.
  const languages = siteLanguages(content.settings);
  const main = languages.find((language) => language.main)?.code;
  for (const language of languages) {
    const home = language.main ? "/" : language.prefix;
    for (const part of ["header", "footer"] as const) {
      const layout = layoutIn(content, part, language.code);
      const buttons = found(home, part, layout.data, language.code);
      if (!language.main && layout === content[part] && main !== undefined) {
        const same = (button: ListedButton) => [button.block, button.label, button.price].join("\n");
        const mains = found("/", part, layout.data, main).map(same);
        if (buttons.map(same).join("\n\n") === mains.join("\n\n")) continue;
      }
      listed.push(...buttons);
    }
  }
  return listed;
}
