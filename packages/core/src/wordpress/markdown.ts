/**
 * Parts as a post's Markdown, which collections of Markdown items show with
 * their tables, pictures and code: headings, paragraphs, lists, quotes,
 * pictures with their captions, code and tables. What Markdown can't hold,
 * such as columns, is written one part after another; videos become links.
 */

import type { Part, TableRow } from "./convert.js";
import { attribute, type ChildNode, isElement, tagName, textOf } from "./html.js";

type Link = (address: string) => string;

/** Text that Markdown shows as it is. */
function escapeText(text: string): string {
  return text.replace(/[\\`*_[\]]/g, "\\$&").replace(/&(?=[a-z#][a-z0-9]*;)/gi, "&amp;");
}

/** A paragraph's start can't be read as a heading, a list or a quote. */
function escapeStart(text: string): string {
  return text.replace(/^(#{1,6}\s|[-+]\s|\d+[.)]\s|>)/, "\\$1");
}

function destination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url.replace(/[<>]/g, encodeURIComponent)}>` : url;
}

function fence(code: string, character = "`"): string {
  let longest = 2;
  for (const match of code.matchAll(new RegExp(`${character === "`" ? "`" : "~"}{3,}`, "g")))
    longest = Math.max(longest, match[0].length);
  return character.repeat(longest + 1);
}

/** Wraps text in a mark, keeping the spaces around it outside, as Markdown needs. */
function marked(inner: string, mark: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  const [, before = "", text = "", after = ""] = match ?? [];
  return text ? `${before}${mark}${text}${mark}${after}` : inner;
}

function inline(nodes: ChildNode[], link: Link, breaks = "  \n"): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return escapeText(textOf(node).replace(/\s+/g, " "));
      if (!isElement(node)) return "";
      const name = tagName(node);
      if (name === "br") return breaks;
      if (name === "img") {
        const src = link(attribute(node, "src"));
        return src ? `![${escapeText(attribute(node, "alt"))}](${destination(src)})` : "";
      }
      const inner = inline(node.children, link, breaks);
      switch (name) {
        case "strong":
        case "b":
          return marked(inner, "**");
        case "em":
        case "i":
        case "cite":
          return marked(inner, "*");
        case "s":
        case "del":
        case "strike":
          return marked(inner, "~~");
        case "code":
        case "kbd":
        case "samp": {
          const code = textOf(node);
          const ticks = "`".repeat(Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length)) + 1);
          return code.trim()
            ? `${ticks}${code.startsWith("`") ? " " : ""}${code}${code.endsWith("`") ? " " : ""}${ticks}`
            : "";
        }
        case "a": {
          const href = link(attribute(node, "href"));
          if (!href) return inner;
          return inner.trim() ? `[${inner.trim()}](${destination(href)})` : `<${href}>`;
        }
        default:
          return inner;
      }
    })
    .join("");
}

function paragraph(text: string): string {
  return escapeStart(text.replace(/ *( {2}\n) */g, "$1").replace(/^( {2}\n|\s)+|( {2}\n|\s)+$/g, ""));
}

function blocks(nodes: ChildNode[], link: Link): string[] {
  const out: string[] = [];
  let loose: ChildNode[] = [];
  const flush = () => {
    const text = paragraph(inline(loose, link));
    if (text) out.push(text);
    loose = [];
  };
  for (const node of nodes) {
    const name = tagName(node);
    const block =
      isElement(node) &&
      ([
        "p",
        "ul",
        "ol",
        "blockquote",
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
      ].includes(name) ||
        /^h[1-6]$/.test(name));
    if (!block) {
      loose.push(node);
      continue;
    }
    flush();
    if (!isElement(node)) continue;
    if (name === "ul" || name === "ol") {
      out.push(list(node.children, name === "ol", link));
    } else if (name === "blockquote") {
      const inner = blocks(node.children, link).join("\n\n");
      if (inner)
        out.push(
          inner
            .split("\n")
            .map((line) => (line ? `> ${line}` : ">"))
            .join("\n"),
        );
    } else if (name === "summary" || name === "dt" || /^h[1-6]$/.test(name)) {
      const text = paragraph(inline(node.children, link));
      if (text) out.push(`**${text}**`);
    } else if (name === "p" || name === "figcaption" || name === "pre") {
      const text = paragraph(inline(node.children, link));
      if (text) out.push(text);
    } else {
      out.push(...blocks(node.children, link));
    }
  }
  flush();
  return out;
}

function list(items: ChildNode[], ordered: boolean, link: Link): string {
  let number = 0;
  return items
    .filter((item) => tagName(item) === "li")
    .map((item) => {
      number += 1;
      const marker = ordered ? `${number}. ` : "- ";
      const indent = " ".repeat(marker.length);
      const children = isElement(item) ? item.children : [];
      const lists = children.filter((child) => tagName(child) === "ul" || tagName(child) === "ol");
      const text = blocks(
        children.filter((child) => !lists.includes(child)),
        link,
      ).join("\n\n");
      const nested = lists.map((nestedList) =>
        list(isElement(nestedList) ? nestedList.children : [], tagName(nestedList) === "ol", link)
          .split("\n")
          .map((line) => (line ? `${indent}${line}` : line))
          .join("\n"),
      );
      const lines = [
        text
          .split("\n")
          .map((line, index) => (index === 0 ? line : line ? `${indent}${line}` : line))
          .join("\n"),
        ...nested,
      ];
      return `${marker}${lines.filter(Boolean).join("\n")}`;
    })
    .join("\n");
}

function table(rows: TableRow[], link: Link): string {
  const width = Math.max(0, ...rows.map((row) => row.cells.length));
  if (width === 0) return "";
  const cell = (nodes: ChildNode[]) => inline(nodes, link, " ").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
  const [head, ...body] = rows;
  return [
    line(head?.cells.map(cell) ?? []),
    line(Array.from({ length: width }, () => "---")),
    ...body.map((row) => line(row.cells.map(cell))),
  ].join("\n");
}

/** A post's parts as Markdown. */
export function partsMarkdown(parts: Part[], link: Link): string {
  const out: string[] = [];
  const image = (src: string, alt: string, caption: string) => {
    if (!src) return;
    out.push(`![${escapeText(alt)}](${destination(src)})`);
    if (caption) out.push(`*${escapeText(caption)}*`);
  };
  const write = (part: Part) => {
    switch (part.kind) {
      case "heading":
        out.push(`${"#".repeat(Math.min(6, Math.max(2, part.level)))} ${escapeText(part.text)}`);
        break;
      case "text":
        out.push(...blocks(part.nodes, link));
        break;
      case "image":
        image(part.image.src, part.image.alt, part.image.caption);
        break;
      case "gallery":
        for (const picture of part.images) image(picture.src, picture.alt, picture.caption);
        break;
      case "columns":
        for (const column of part.columns) column.forEach(write);
        break;
      case "cover":
      case "media-text":
        if (part.kind === "media-text") image(part.media, part.alt, "");
        part.parts.forEach(write);
        break;
      case "details":
        if (part.summary) out.push(`**${escapeText(part.summary)}**`);
        part.parts.forEach(write);
        break;
      case "separator":
        out.push("---");
        break;
      case "pullquote": {
        const lines = part.quote.split("\n").map((line) => `> ${escapeText(line)}`);
        if (part.citation) lines.push(">", `> — ${escapeText(part.citation)}`);
        out.push(lines.join("\n"));
        break;
      }
      case "preformatted":
        if (part.verse) {
          // Each line its own, with a backslash for Markdown's line break.
          out.push(part.text.split("\n").map(escapeText).join("\\\n"));
        } else {
          const marks = fence(part.text);
          out.push(`${marks}\n${part.text}\n${marks}`);
        }
        break;
      case "file":
        out.push(
          `[${escapeText(part.label || part.buttonLabel || part.href.split("/").pop() || part.href)}](${destination(part.href)})`,
        );
        break;
      case "audio":
        out.push(`[${escapeText(part.caption || part.url.split("/").pop() || part.url)}](${destination(part.url)})`);
        break;
      case "buttons": {
        const links = part.buttons.map((button) => `[${escapeText(button.label)}](${destination(button.href)})`);
        if (links.length) out.push(links.join(" · "));
        break;
      }
      case "video":
        out.push(part.caption ? `[${escapeText(part.caption)}](${destination(part.url)})` : `<${part.url}>`);
        break;
      case "code": {
        const marks = fence(part.code);
        out.push(`${marks}${part.language}\n${part.code}\n${marks}`);
        break;
      }
      case "table": {
        const text = table(part.rows, link);
        if (text) out.push(text);
        break;
      }
      case "space":
      case "posts":
      case "pages":
        break;
    }
  };
  parts.forEach(write);
  return out.join("\n\n");
}
