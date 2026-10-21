/**
 * HTML and XML without a DOM, so WordPress content is read the same way in
 * Node and in browsers: htmlparser2's documents, and a few helpers for them.
 */
import type { AnyNode, ChildNode, Document, Element } from "domhandler";
import { DomUtils, parseDocument } from "htmlparser2";

export type { AnyNode, ChildNode, Document, Element };

/** Parses HTML, as browsers would for a fragment: entities decoded, unclosed elements closed. */
export function parseHtml(html: string): Document {
  return parseDocument(html, { decodeEntities: true });
}

/** Parses XML, such as a WordPress export file, with CDATA sections as text. */
export function parseXml(xml: string): Document {
  return parseDocument(xml, { xmlMode: true, decodeEntities: true });
}

export function isElement(node: AnyNode | undefined): node is Element {
  return node?.type === "tag" || node?.type === "script" || node?.type === "style";
}

/** An element's lowercase tag name, or `""` for anything else. */
export function tagName(node: AnyNode | undefined): string {
  return isElement(node) ? node.name.toLowerCase() : "";
}

/** The text in a node and everything inside it. */
export function textOf(node: AnyNode | AnyNode[]): string {
  return DomUtils.textContent(node);
}

/** Text with its whitespace collapsed, as a browser shows it. */
export function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** HTML's text, with entities decoded and whitespace collapsed: `Faith &amp; <b>works</b>` → `Faith & works`. */
export function plainText(html: string): string {
  return collapsed(textOf(parseHtml(html)));
}

export function attribute(node: AnyNode | undefined, name: string): string {
  return isElement(node) ? (node.attribs[name] ?? "") : "";
}

/** An element's classes. */
export function classes(node: AnyNode | undefined): string[] {
  return attribute(node, "class").split(/\s+/).filter(Boolean);
}

export function hasClass(node: AnyNode | undefined, name: string): boolean {
  return classes(node).includes(name);
}

/** An element's child elements. */
export function childElements(node: AnyNode): Element[] {
  return "children" in node ? node.children.filter(isElement) : [];
}

/** The first element inside a node, itself included, that passes a test. */
export function findElement(node: AnyNode | AnyNode[], test: (element: Element) => boolean): Element | undefined {
  const nodes = Array.isArray(node) ? node : [node];
  for (const candidate of nodes) {
    if (isElement(candidate) && test(candidate)) return candidate;
  }
  return (
    DomUtils.findOne(
      test,
      nodes.flatMap((candidate) => ("children" in candidate ? candidate.children : [])),
      true,
    ) ?? undefined
  );
}

/** Every element inside a node that passes a test, in order. */
export function findElements(node: AnyNode | AnyNode[], test: (element: Element) => boolean): Element[] {
  return DomUtils.findAll(test, Array.isArray(node) ? node : [node]);
}

/** A child element of an XML element by its full name, such as `wp:post_id`. */
export function child(node: AnyNode, name: string): Element | undefined {
  return childElements(node).find((element) => element.name === name);
}

/** The text of a child element of an XML element, or `""`. */
export function childText(node: AnyNode, name: string): string {
  const found = child(node, name);
  return found ? textOf(found) : "";
}

/** A node as HTML. */
export function outerHtml(node: AnyNode | AnyNode[]): string {
  return DomUtils.getOuterHTML(node, { decodeEntities: false, encodeEntities: "utf8" });
}

const STYLE_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i;

/** The address of an element's CSS background image, such as a cover's. */
export function backgroundImage(node: AnyNode | undefined): string {
  return STYLE_URL.exec(attribute(node, "style"))?.[2]?.trim() ?? "";
}

const BLOCK_START =
  /^<(?:p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|figure|figcaption|hr|iframe|video|audio|section|article|aside|header|footer|nav|form|address|dl|dd|dt|details|summary|style|script|noscript|!--)\b/i;

/**
 * WordPress's paragraphs for classic content, as `wpautop()` makes them: text
 * separated by a blank line is a paragraph, and a single line break is kept.
 * Text that's already in block elements stays as it is.
 */
export function autoParagraphs(text: string): string {
  if (!text.trim()) return "";
  // Line breaks inside preformatted text are part of it.
  const kept: string[] = [];
  const protectedText = text.replace(/<pre\b[\s\S]*?<\/pre>/gi, (match) => {
    kept.push(match);
    return `<!--gf-pre-${kept.length - 1}-->`;
  });
  const chunks = protectedText
    .replace(/\r\n?/g, "\n")
    // Block elements start chunks of their own.
    .replace(/(<\/(?:p|div|h[1-6]|ul|ol|table|blockquote|figure|section|article|details|form)>)/gi, "$1\n\n")
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const html = chunks
    .map((chunk) => {
      if (BLOCK_START.test(chunk)) return chunk;
      return `<p>${chunk.replace(/\n/g, "<br>\n")}</p>`;
    })
    .join("\n");
  return html.replace(/<!--gf-pre-(\d+)-->/g, (_, index: string) => kept[Number(index)] ?? "");
}
