/**
 * Text parts as the Text block's rich text holds it: paragraphs, lists,
 * quotes, line breaks, bold, italics, underlines, strikethrough, code and
 * links, and nothing else, so it's what the editor would have written.
 */
import { attribute, type ChildNode, isElement, tagName, textOf } from "./html.js";

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, "&quot;");

const MARKS: Record<string, string> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  cite: "em",
  u: "u",
  ins: "u",
  s: "s",
  del: "s",
  strike: "s",
  code: "code",
  kbd: "code",
  samp: "code",
};

const BLOCKS = new Set(["p", "ul", "ol", "blockquote"]);

/** Inline content: text, marks and links, with whitespace as browsers show it. */
function inline(nodes: ChildNode[], link: (address: string) => string): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return escapeText(textOf(node).replace(/\s+/g, " "));
      if (!isElement(node)) return "";
      const name = tagName(node);
      if (name === "br") return "<br>";
      if (name === "img") return "";
      const inner = inline(node.children, link);
      const mark = MARKS[name];
      if (mark) return inner.trim() ? `<${mark}>${inner}</${mark}>` : inner;
      if (name === "a") {
        const href = link(attribute(node, "href"));
        return href && inner.trim() ? `<a href="${escapeAttribute(href)}">${inner}</a>` : inner;
      }
      return inner;
    })
    .join("");
}

function trimmed(html: string): string {
  return html.replace(/\s*<br>\s*/g, "<br>").replace(/^(\s|<br>)+|(\s|<br>)+$/g, "");
}

/** Block content: paragraphs, lists and quotes, with text that isn't in one put in a paragraph. */
function blocks(nodes: ChildNode[], link: (address: string) => string): string {
  const out: string[] = [];
  let loose: ChildNode[] = [];
  const flush = () => {
    const text = trimmed(inline(loose, link));
    if (text) out.push(`<p>${text}</p>`);
    loose = [];
  };
  for (const node of nodes) {
    const name = tagName(node);
    if (
      !isElement(node) ||
      (!BLOCKS.has(name) &&
        !/^h[1-6]$/.test(name) &&
        ![
          "div",
          "li",
          "details",
          "summary",
          "dl",
          "dt",
          "dd",
          "figure",
          "figcaption",
          "section",
          "address",
          "pre",
        ].includes(name))
    ) {
      loose.push(node);
      continue;
    }
    flush();
    if (name === "p" || name === "summary" || name === "dt" || name === "figcaption" || name === "pre") {
      const text = trimmed(inline(node.children, link));
      if (text) out.push(name === "summary" || name === "dt" ? `<p><strong>${text}</strong></p>` : `<p>${text}</p>`);
    } else if (/^h[1-6]$/.test(name)) {
      const text = trimmed(inline(node.children, link));
      if (text) out.push(`<p><strong>${text}</strong></p>`);
    } else if (name === "ul" || name === "ol") {
      const items = node.children.filter((child) => tagName(child) === "li").map((item) => listItem(item, link));
      if (items.length) out.push(`<${name}>${items.join("")}</${name}>`);
    } else if (name === "blockquote") {
      const inner = blocks(node.children, link);
      if (inner) out.push(`<blockquote>${inner}</blockquote>`);
    } else {
      const inner = blocks(node.children, link);
      if (inner) out.push(inner);
    }
  }
  flush();
  return out.join("");
}

function listItem(item: ChildNode, link: (address: string) => string): string {
  if (!isElement(item)) return "";
  const lists = item.children.filter((child) => tagName(child) === "ul" || tagName(child) === "ol");
  const text = trimmed(
    inline(
      item.children.filter((child) => !lists.includes(child)),
      link,
    ),
  );
  const nested = lists.map((list) => blocks([list], link)).join("");
  return `<li><p>${text}</p>${nested}</li>`;
}

/** Text parts' elements as rich text, with links' addresses changed by `link`. */
export function richTextHtml(nodes: ChildNode[], link: (address: string) => string): string {
  return blocks(nodes, link);
}

/** A table's cell, or a heading's text, as inline rich text. */
export function inlineRichText(nodes: ChildNode[], link: (address: string) => string): string {
  return trimmed(inline(nodes, link));
}
