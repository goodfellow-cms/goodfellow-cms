import filterXss from "xss";
import { isSafeUrl } from "./markdown.js";

// The package is CommonJS, and some of its exports are only on its default export in Node, which its types don't say.
const xss = filterXss as unknown as typeof import("xss");

/** Attributes any kept element may have, so CSS can style what's kept. */
const GLOBAL_ATTRIBUTES = ["class", "id", "title", "lang", "dir"];

let filter: InstanceType<typeof xss.FilterXSS> | undefined;

function createFilter() {
  const allowList = xss.getDefaultWhiteList();
  for (const tag of Object.keys(allowList)) {
    allowList[tag] = [...new Set([...(allowList[tag] ?? []), ...GLOBAL_ATTRIBUTES])];
  }
  // Elements that are commonly pasted and can't run code.
  for (const tag of ["figure", "figcaption", "picture", "main", "nav", "summary", "details"]) {
    allowList[tag] = [...new Set([...(allowList[tag] ?? []), ...GLOBAL_ATTRIBUTES])];
  }
  allowList.source = ["src", "srcset", "type", "media", "sizes"];
  allowList.a = [...(allowList.a ?? []), "rel"];
  // Where a numbered list starts, as Markdown's lists say.
  allowList.ol = [...(allowList.ol ?? []), "start", "reversed"];
  allowList.img = [...(allowList.img ?? []), "srcset", "sizes", "loading"];
  return new xss.FilterXSS({
    allowList,
    // Leaves out elements that aren't allowed, and everything inside scripts and styles.
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed", "noscript", "template"],
    // No inline styles, which can cover the page with something that looks like part of it.
    css: false,
    // Ids Goodfellow's own scripts look up (`gf-consent`) stay Goodfellow's, so text can't stand in for them.
    onTagAttr(_tag, name, value) {
      return name === "id" && /^\s*gf-/i.test(value) ? "" : undefined;
    },
    safeAttrValue(tag, name, value, cssFilter) {
      const safe = xss.safeAttrValue(tag, name, value, cssFilter);
      if ((name === "href" || name === "src") && !isSafeUrl(safe)) return "";
      if (name === "srcset" && safe.split(",").some((candidate) => !isSafeUrl(candidate.trim().split(/\s+/)[0] ?? "")))
        return "";
      return safe;
    },
  });
}

/**
 * HTML that's safe to put in a page: scripts, styles, frames, forms, event
 * handlers and inline styles are left out, and links and images may only use
 * addresses that can't run code (`isSafeUrl`). Text and formatting stay.
 */
export function sanitizeHtml(html: string): string {
  filter ??= createFilter();
  return filter.process(html);
}

let cellFilter: InstanceType<typeof xss.FilterXSS> | undefined;

/** The formatting a table's cell may have: bold, italics, links, code and line breaks. */
export const TABLE_CELL_TAGS = ["strong", "b", "em", "i", "u", "s", "code", "a", "br"] as const;

/**
 * A table cell's HTML, safe to put in a page and kept to what a cell holds
 * (`TABLE_CELL_TAGS`): any other element is left out, keeping its text, and
 * links may only use addresses that can't run code.
 */
export function tableCellHtml(html: string): string {
  cellFilter ??= new xss.FilterXSS({
    allowList: Object.fromEntries(TABLE_CELL_TAGS.map((tag) => [tag, tag === "a" ? ["href", "title"] : []])),
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed", "noscript", "template"],
    css: false,
    safeAttrValue(tag, name, value, cssFilter) {
      const safe = xss.safeAttrValue(tag, name, value, cssFilter);
      return name === "href" && !isSafeUrl(safe) ? "" : safe;
    },
  });
  return cellFilter.process(html);
}

/** Plain text as a table cell's HTML, such as a cell from before cells could be formatted. */
export function escapeCellText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
