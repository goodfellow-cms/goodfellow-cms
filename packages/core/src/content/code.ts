/**
 * Admin-written code for every page, such as analytics or a site verification
 * tag. The end of the body takes any HTML; the head only takes elements that
 * belong there, which renderers turn into elements of their own (see
 * `parseHeadCode`), since a React document can't take raw HTML in its head.
 */
import { isExternalLink } from "../external-links.js";

/** An element of the head's code: its tag, its attributes in order, and the text inside it. */
export interface HeadElement {
  tag: HeadTag;
  /** Attribute names in lowercase, with their values; `""` for one written without a value, such as `async`. */
  attributes: Array<[name: string, value: string]>;
  /** What's inside a `script`, `style` or `noscript`, as it was written. */
  content?: string;
}

export const HEAD_TAGS = ["script", "style", "link", "meta", "base", "noscript"] as const;
export type HeadTag = (typeof HEAD_TAGS)[number];

/** Elements with nothing inside them and no end tag. */
const VOID_TAGS = new Set<HeadTag>(["link", "meta", "base"]);

/** Why code can't go in the head: text outside an element, an element that doesn't belong there, or one that isn't closed. */
export type HeadCodeProblem =
  | { code: "text"; text: string }
  | { code: "tag"; tag: string }
  | { code: "unclosed"; tag: string };

export class HeadCodeError extends Error {
  override name = "HeadCodeError";
  constructor(readonly problem: HeadCodeProblem) {
    super(
      problem.code === "text"
        ? `The head's code has text outside an element: "${problem.text}".`
        : problem.code === "tag"
          ? `The head's code has a <${problem.tag}> element, which doesn't belong in the head.`
          : `The head's code has a <${problem.tag}> element that isn't closed.`,
    );
  }
}

const ATTRIBUTE = /\s*([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

/** Decodes the character references attribute values are most often written with. */
function decodeAttribute(value: string): string {
  return value.replace(/&(amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
    const lower = name.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/**
 * Reads the head's code into its elements, leaving out comments. Throws a
 * `HeadCodeError` for anything that doesn't belong in a page's head.
 */
export function parseHeadCode(html: string): HeadElement[] {
  const elements: HeadElement[] = [];
  let at = 0;
  while (at < html.length) {
    const rest = html.slice(at);
    const space = /^\s+/.exec(rest);
    if (space) {
      at += space[0].length;
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = html.indexOf("-->", at + 4);
      if (end === -1) throw new HeadCodeError({ code: "unclosed", tag: "!--" });
      at = end + 3;
      continue;
    }
    const open = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
    if (!open) {
      const text = rest.split("<")[0]?.trim() || rest.slice(0, 20);
      throw new HeadCodeError({ code: "text", text: text.slice(0, 40) });
    }
    const tag = (open[1] ?? "").toLowerCase();
    if (!(HEAD_TAGS as readonly string[]).includes(tag)) throw new HeadCodeError({ code: "tag", tag });
    at += open[0].length;

    const attributes: HeadElement["attributes"] = [];
    for (;;) {
      ATTRIBUTE.lastIndex = at;
      const match = ATTRIBUTE.exec(html);
      if (!match) break;
      at = ATTRIBUTE.lastIndex;
      const value = match[2] ?? match[3] ?? match[4] ?? "";
      attributes.push([(match[1] ?? "").toLowerCase(), decodeAttribute(value)]);
    }
    const close = /^\s*(\/?)>/.exec(html.slice(at));
    if (!close) throw new HeadCodeError({ code: "unclosed", tag });
    at += close[0].length;

    const element: HeadElement = { tag: tag as HeadTag, attributes };
    if (!VOID_TAGS.has(element.tag)) {
      // What's inside is kept as it is, up to the end tag: script and style are text, and noscript's HTML goes in as written.
      const endTag = new RegExp(`</${tag}\\s*>`, "i");
      const end = endTag.exec(html.slice(at));
      if (!end) throw new HeadCodeError({ code: "unclosed", tag });
      element.content = html.slice(at, at + end.index);
      at += end.index + end[0].length;
    }
    elements.push(element);
  }
  return elements;
}

/** Code as it's saved: without trailing spaces at its end, and with a final newline, or `""` for none. */
export function storedCode(code: string): string {
  const trimmed = code.trimEnd();
  return trimmed.trim() ? `${trimmed}\n` : "";
}

/** The head's elements that run something, which a site that asks visitors first holds back until they agree. */
const HELD_TAGS = new Set<HeadTag>(["script", "noscript"]);

/** Whether an address is on another site: a full address elsewhere, or one that starts with `//`. */
function isOtherSite(href: string, siteUrl: string | undefined): boolean {
  const address = href.trim();
  if (address.startsWith("//")) return true;
  return isExternalLink(address, siteUrl);
}

/**
 * Whether a head element waits for visitors' agreement on a site that asks:
 * scripts and `noscript`, which could load anything, and links to other sites,
 * such as another site's stylesheet. Links on the site itself (its own
 * stylesheet, manifest or icons, by a root-relative address or the Site
 * address, `siteUrl`) and `meta` tags stay in the page.
 */
export function isHeldHeadElement(element: HeadElement, siteUrl?: string): boolean {
  if (HELD_TAGS.has(element.tag)) return true;
  if (element.tag !== "link") return false;
  const href = element.attributes.find(([name]) => name === "href")?.[1];
  return href === undefined || isOtherSite(href, siteUrl);
}

/**
 * Whether code would end the `<template>` a site that asks visitors first
 * keeps it in, and so run before they agree. Such code isn't shown on those
 * sites, and the admin panel won't publish it.
 */
export function endsHeldTemplate(code: string): boolean {
  return /<\/template/i.test(code);
}

/** A head element written as HTML again, as it was read. */
export function headElementHtml({ tag, attributes, content }: HeadElement): string {
  const written = attributes
    .map(([name, value]) =>
      value === "" ? ` ${name}` : ` ${name}="${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`,
    )
    .join("");
  return VOID_TAGS.has(tag) ? `<${tag}${written}>` : `<${tag}${written}>${content ?? ""}</${tag}>`;
}
