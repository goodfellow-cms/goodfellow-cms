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
      // As browsers read it, with character references (`&#103;f-`) spelled out.
      return name === "id" && /^\s*gf-/i.test(xss.friendlyAttrValue(value)) ? "" : undefined;
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

let richTextFilter: InstanceType<typeof xss.FilterXSS> | undefined;

/**
 * What rich text keeps, by element, with the attributes each may have: the formatting Puck's rich text editor makes
 * (its TipTap schema), so a page shows what the editor showed, and nothing else, such as images, that would load
 * other sites' files or look like part of the page.
 */
export const RICH_TEXT_TAGS: Readonly<Record<string, readonly string[]>> = {
  p: ["style"],
  h1: ["style"],
  h2: ["style"],
  h3: ["style"],
  h4: ["style"],
  h5: ["style"],
  h6: ["style"],
  ul: [],
  ol: ["start", "type"],
  li: [],
  blockquote: [],
  pre: [],
  code: ["class"],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  del: [],
  strike: [],
  a: ["href", "target", "rel"],
  br: [],
  hr: [],
};

/** Alignments rich text can have, as Puck's editor writes them: left is the default, which it leaves unsaid. */
const ALIGNMENTS = new Set(["center", "right", "justify"]);

/** The text alignment a style gives, read declaration by declaration. */
function textAlign(style: string): string | undefined {
  let found: string | undefined;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0 || declaration.slice(0, colon).trim().toLowerCase() !== "text-align") continue;
    const value = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase();
    found = ALIGNMENTS.has(value) ? value : undefined;
  }
  return found;
}

/** Whether text has a tag in it, as Puck's rich text reads it: plain text is a paragraph. */
function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z]/i.test(text);
}

/**
 * Rich text as a page shows it: the HTML kept to `RICH_TEXT_TAGS`, with text alignment its only style, a code block's
 * `language-…` its only class, a new tab its only link target, and links only to addresses that can't run code
 * (`isSafeUrl`). Any other element is left out, keeping its text, apart from scripts, styles, and frames, which go
 * whole. Plain text, with no tags, is one paragraph, as Puck's rich text has it.
 */
export function cleanRichText(html: string): string {
  if (html === "") return "";
  if (!looksLikeHtml(html)) return `<p>${escapeCellText(html)}</p>`;
  richTextFilter ??= new xss.FilterXSS({
    allowList: Object.fromEntries(Object.entries(RICH_TEXT_TAGS).map(([tag, names]) => [tag, [...names]])),
    stripIgnoreTag: true,
    stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed", "noscript", "template"],
    css: false,
    onTagAttr(tag, name, value) {
      const read = xss.friendlyAttrValue(value).trim();
      if (name === "style") {
        const align = textAlign(read);
        return align ? `style="text-align: ${align}"` : "";
      }
      if (tag === "code" && name === "class") return /^language-[\w+#.-]+$/.test(read) ? undefined : "";
      // Opening in the same tab is what links do, so `setLinkTargets()`'s `_self` and empty `rel` go.
      if (tag === "a" && name === "target") return read === "_blank" ? undefined : "";
      if (tag === "a" && name === "rel") return read === "" ? "" : undefined;
      return undefined;
    },
    safeAttrValue(tag, name, value, cssFilter) {
      const safe = xss.safeAttrValue(tag, name, value, cssFilter);
      return name === "href" && !isSafeUrl(safe) ? "" : safe;
    },
  });
  return richTextFilter.process(html);
}

let cellFilter: InstanceType<typeof xss.FilterXSS> | undefined;

/** The formatting a table's cell may have: bold, italics, links, code, and line breaks. */
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
