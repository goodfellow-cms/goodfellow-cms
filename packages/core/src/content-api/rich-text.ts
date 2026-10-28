/**
 * Rich text as a simple structure an app can draw without an HTML renderer:
 * paragraphs, headings, quotes, lists, code, pictures, rules and tables, with
 * text marked bold, italic and so on, read from HTML with htmlparser2, so it
 * works without a DOM.
 */
import type { MarkdownPart } from "../content/markdown.js";
import { isSafeUrl } from "../content/markdown.js";
import { sanitizeHtml } from "../content/sanitize.js";
import { type AnyNode, attribute, classes, isElement, parseHtml, tagName, textOf } from "../wordpress/html.js";

/** Text, with how it's marked: each mark is set only where it's on. */
export interface RichTextText {
  type: "text";
  text: string;
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** Code within a sentence. */
  code?: true;
  superscript?: true;
  subscript?: true;
  /** Where the text links to, as the page has it: an address on the site (`/about`) or a full one. */
  link?: string;
  /** Whether the link opens in a new tab, as the site's links to other sites may. */
  newTab?: true;
}

/** What a line of text holds: text, line breaks and pictures within it. */
export type RichTextInline = RichTextText | { type: "break" } | { type: "image"; src: string; alt: string };

/** A part of rich text, one under another. */
export type RichTextBlock =
  | { type: "paragraph"; children: RichTextInline[] }
  /** A heading, with its `id` where the page links to it, as Markdown's headings have. */
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id?: string; children: RichTextInline[] }
  | { type: "quote"; children: RichTextBlock[] }
  /** A list, each item what it holds; `start` where a numbered list doesn't start at 1. */
  | { type: "list"; ordered: boolean; start?: number; items: RichTextBlock[][] }
  /** Code as written, with its language where it says one, such as `ts`. */
  | { type: "code"; code: string; language?: string }
  | { type: "image"; src: string; alt: string; caption?: RichTextInline[] }
  | { type: "rule" }
  /** A table's rows; `header` rows are its headings. */
  | { type: "table"; rows: Array<{ header: boolean; cells: RichTextInline[][] }> };

type Marks = Omit<RichTextText, "type" | "text">;

const MARKS: Record<string, keyof Marks> = {
  strong: "bold",
  b: "bold",
  em: "italic",
  i: "italic",
  u: "underline",
  ins: "underline",
  s: "strike",
  del: "strike",
  strike: "strike",
  code: "code",
  kbd: "code",
  sup: "superscript",
  sub: "subscript",
};

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

/** Elements whose parts are shown one under another, which are read for what's in them. */
const CONTAINERS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "nav",
  "aside",
  "details",
  "summary",
  "address",
  "center",
  "dl",
  "dt",
  "dd",
  "body",
  "html",
]);

const BLOCKS = new Set(["p", ...Object.keys(HEADINGS), "blockquote", "ul", "ol", "pre", "hr", "table", "figure"]);

function isBlockElement(node: AnyNode): boolean {
  const name = tagName(node);
  return BLOCKS.has(name) || CONTAINERS.has(name) || name === "li";
}

function sameMarks(a: RichTextText, b: RichTextText): boolean {
  const keys: Array<keyof Marks> = ["bold", "italic", "underline", "strike", "code", "superscript", "subscript"];
  return keys.every((key) => a[key] === b[key]) && a.link === b.link && a.newTab === b.newTab;
}

/** Text as a browser shows it: runs of spaces and line breaks as one space, and nothing empty. */
function tidyInline(inline: RichTextInline[]): RichTextInline[] {
  const joined: RichTextInline[] = [];
  for (const node of inline) {
    const last = joined.at(-1);
    if (node.type === "text" && last?.type === "text" && sameMarks(last, node)) last.text += node.text;
    else joined.push(node.type === "text" ? { ...node } : node);
  }
  for (const node of joined) if (node.type === "text" && !node.code) node.text = node.text.replace(/\s+/g, " ");
  // No space at the start of a line, at its end, or either side of a line break.
  for (let index = 0; index < joined.length; index++) {
    const node = joined[index];
    if (node?.type !== "text" || node.code) continue;
    const before = joined[index - 1];
    const after = joined[index + 1];
    if (!before || before.type === "break" || (before.type === "text" && /\s$/.test(before.text))) {
      node.text = node.text.replace(/^\s+/, "");
    }
    if (!after || after.type === "break") node.text = node.text.replace(/\s+$/, "");
  }
  return joined.filter((node) => node.type !== "text" || node.text !== "");
}

function imageOf(node: AnyNode): { src: string; alt: string } | undefined {
  const src = attribute(node, "src");
  if (!src || !isSafeUrl(src)) return undefined;
  return { src, alt: attribute(node, "alt") };
}

function inlineOf(nodes: readonly AnyNode[], marks: Marks): RichTextInline[] {
  const inline: RichTextInline[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      inline.push({ type: "text", text: (node as unknown as { data: string }).data, ...marks });
      continue;
    }
    if (!isElement(node)) continue;
    const name = tagName(node);
    if (name === "br") inline.push({ type: "break" });
    else if (name === "img") {
      const image = imageOf(node);
      if (image) inline.push({ type: "image", ...image });
    } else if (name === "a") {
      const href = attribute(node, "href");
      const link: Marks =
        href && isSafeUrl(href)
          ? { link: href, ...(attribute(node, "target") === "_blank" && { newTab: true as const }) }
          : {};
      inline.push(...inlineOf(node.children, { ...marks, ...link }));
    } else {
      const mark = MARKS[name];
      inline.push(...inlineOf(node.children, mark ? { ...marks, [mark]: true } : marks));
    }
  }
  return inline;
}

function languageOf(node: AnyNode): string | undefined {
  const code = isElement(node) ? node.children.find((child) => tagName(child) === "code") : undefined;
  const named = [...classes(code), ...classes(node)].find((name) => name.startsWith("language-"));
  const language = named?.slice("language-".length) || attribute(node, "data-language");
  return language || undefined;
}

function tableRows(node: AnyNode): Array<{ header: boolean; cells: RichTextInline[][] }> {
  const rows: Array<{ header: boolean; cells: RichTextInline[][] }> = [];
  const visit = (parent: AnyNode, header: boolean) => {
    if (!isElement(parent)) return;
    for (const child of parent.children) {
      const name = tagName(child);
      if (name === "thead") visit(child, true);
      else if (name === "tbody" || name === "tfoot") visit(child, false);
      else if (name === "tr" && isElement(child)) {
        const cells = child.children.filter((cell) => ["td", "th"].includes(tagName(cell)));
        rows.push({
          header: header || (cells.length > 0 && cells.every((cell) => tagName(cell) === "th")),
          cells: cells.map((cell) => tidyInline(inlineOf(isElement(cell) ? cell.children : [], {}))),
        });
      }
    }
  };
  visit(node, false);
  return rows;
}

function blocksOf(nodes: readonly AnyNode[]): RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  let pending: AnyNode[] = [];
  const flush = () => {
    const children = tidyInline(inlineOf(pending, {}));
    pending = [];
    if (children.length === 0) return;
    // A picture on a line of its own is a picture, not a paragraph.
    const [only] = children;
    if (children.length === 1 && only?.type === "image") blocks.push(only);
    else blocks.push({ type: "paragraph", children });
  };
  for (const node of nodes) {
    if (!isElement(node) || !isBlockElement(node)) {
      if (node.type === "text" || isElement(node)) pending.push(node);
      continue;
    }
    flush();
    const name = tagName(node);
    const heading = HEADINGS[name];
    if (name === "p") {
      pending = [...node.children];
      flush();
    } else if (heading) {
      const children = tidyInline(inlineOf(node.children, {}));
      const id = attribute(node, "id");
      if (children.length > 0) blocks.push({ type: "heading", level: heading, ...(id && { id }), children });
    } else if (name === "blockquote") {
      const children = blocksOf(node.children);
      if (children.length > 0) blocks.push({ type: "quote", children });
    } else if (name === "ul" || name === "ol") {
      const items = node.children.filter((child) => tagName(child) === "li");
      const start = Number.parseInt(attribute(node, "start"), 10);
      blocks.push({
        type: "list",
        ordered: name === "ol",
        ...(name === "ol" && Number.isInteger(start) && start !== 1 && { start }),
        items: items.map((item) => (isElement(item) ? blocksOf(item.children) : [])),
      });
    } else if (name === "pre") {
      const language = languageOf(node);
      blocks.push({ type: "code", code: textOf(node).replace(/\n$/, ""), ...(language && { language }) });
    } else if (name === "hr") blocks.push({ type: "rule" });
    else if (name === "table") {
      const rows = tableRows(node);
      if (rows.length > 0) blocks.push({ type: "table", rows });
    } else if (name === "figure") {
      const image = node.children.find((child) => tagName(child) === "img");
      const found = image && imageOf(image);
      if (
        found &&
        !node.children.some((child) => isElement(child) && child !== image && tagName(child) !== "figcaption")
      ) {
        const caption = node.children.find((child) => tagName(child) === "figcaption");
        const captionText = caption && isElement(caption) ? tidyInline(inlineOf(caption.children, {})) : [];
        blocks.push({ type: "image", ...found, ...(captionText.length > 0 && { caption: captionText }) });
      } else blocks.push(...blocksOf(node.children));
    } else blocks.push(...blocksOf(node.children));
  }
  flush();
  return blocks;
}

/**
 * Rich text's HTML as a simple structure (`RichTextBlock`s): what an app needs
 * to draw it without an HTML renderer. The HTML is sanitized first, as pages
 * show it, so only what a page would show is kept; elements it doesn't know,
 * such as a `<span>`, give their text.
 */
export function richTextNodes(html: string): RichTextBlock[] {
  return blocksOf(parseHtml(sanitizeHtml(html)).children);
}

/** Markdown as the Entry field block renders it (`markdownParts()`), as the same structure. */
export function markdownPartsNodes(parts: readonly MarkdownPart[]): RichTextBlock[] {
  return parts.flatMap((part): RichTextBlock[] =>
    part.kind === "code"
      ? [{ type: "code", code: part.code, ...(part.language && { language: part.language }) }]
      : richTextNodes(part.html),
  );
}

/** Whether a value is Markdown as `markdownParts()` gives it, as a prop that blocks render Markdown from holds. */
export function isMarkdownParts(value: unknown): value is MarkdownPart[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (part) =>
        part !== null &&
        typeof part === "object" &&
        typeof (part as { html?: unknown }).html === "string" &&
        ((part as { kind?: unknown }).kind === "html" ||
          ((part as { kind?: unknown }).kind === "code" && typeof (part as { code?: unknown }).code === "string")),
    )
  );
}
