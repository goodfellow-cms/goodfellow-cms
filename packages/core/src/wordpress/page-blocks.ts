/**
 * Parts as a page's Puck blocks, built from Goodfellow's built-in blocks:
 * Sections holding Headings, Text, Images, Columns, Rows of Buttons, Space,
 * Videos, Code and Collection lists, with every prop written out as the
 * editor would, and the blocks made for WordPress's own (`WORDPRESS_BLOCKS`)
 * where the site has them.
 */
import { vimeoVideo, youtubeVideo } from "../video.js";
import type { CoverLook, ImagePart, Part, TableRow } from "./convert.js";
import { collapsed, textOf } from "./html.js";
import { inlineRichText, richTextHtml } from "./rich-text.js";

/** A Puck block as content files store it. */
export interface BlockData {
  type: string;
  props: Record<string, unknown> & { id: string };
}

/** The built-in blocks imported pages are made of. */
export const IMPORT_BLOCKS = [
  "Section",
  "Grid",
  "Flex",
  "Space",
  "Heading",
  "Text",
  "Button",
  "Image",
  "Video",
  "Code",
  "CollectionList",
];

/**
 * Built-in blocks like WordPress's own, which imports use where the site has
 * them; where it doesn't, the parts come across as the blocks above would show
 * them, as before they existed.
 */
export const WORDPRESS_BLOCKS = [
  "Separator",
  "Pullquote",
  "Preformatted",
  "Verse",
  "Details",
  "Table",
  "File",
  "Audio",
  "MediaText",
  "Gallery",
  "PageList",
  "Embed",
  "Document",
];

export interface PageBlocksOptions {
  link(address: string): string;
  /** The posts collection, for lists of the latest posts. */
  posts?: string;
  /** The page's writer, where it has more blocks than these. */
  writer?: BlockWriter;
  /** The site's blocks, where only some of `WORDPRESS_BLOCKS` may be there. Every one without it. */
  blocks?: readonly string[];
}

/** Writes blocks with ids of their own on one page, each `<type>-<prefix>-<count>`. */
export class BlockWriter {
  private count = 0;

  constructor(private readonly prefix = "wp") {}

  block(type: string, props: Record<string, unknown>): BlockData {
    this.count += 1;
    return {
      type,
      props: { id: `${type}-${this.prefix}-${this.count}`, ...props, className: (props.className as string) ?? "" },
    };
  }

  /** A Section holding blocks, with space between them, as the starter's pages have. */
  section(content: BlockData[], props: { width?: string; backgroundImage?: string; look?: CoverLook } = {}): BlockData {
    content.forEach((block, index) => {
      if (index > 0 && !block.props.className) block.props.className = "mt-6";
    });
    const look = props.look;
    return this.block("Section", {
      background: "none",
      backgroundImage: props.backgroundImage ?? "",
      content,
      focus: look?.focus ? coverFocus(look.focus) : "center",
      minHeight: look ? coverHeight(look.minHeight) : "none",
      overlay: look && look.dim > 0 ? "dark" : "none",
      overlayStrength: look ? coverStrength(look.dim) : "medium",
      padding: "lg",
      width: props.width ?? "narrow",
    });
  }

  heading(text: string, level: string, className = ""): BlockData {
    return this.block("Heading", { align: "left", className, level, text });
  }

  collectionList(props: Record<string, unknown>): BlockData {
    return this.block("CollectionList", {
      collection: "",
      columns: "3",
      dateField: "date",
      emptyText: "",
      imageField: "image",
      layout: "cards",
      limit: 0,
      order: "default",
      show: "all",
      summaryField: "summary",
      ...props,
    });
  }
}

const HEADING_LEVELS: Record<number, string> = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h4", 6: "h4" };

/** A cover's overlay, WordPress's `dimRatio`, as the Section's strength. */
function coverStrength(dim: number): string {
  if (dim < 40) return "light";
  if (dim < 65) return "medium";
  return "strong";
}

/** A cover's least height, in pixels, as the nearest of the Section's. */
function coverHeight(pixels: number): string {
  if (pixels <= 0) return "none";
  if (pixels < 320) return "small";
  if (pixels < 480) return "medium";
  if (pixels < 700) return "large";
  return "screen";
}

/** A cover's focal point as the side of the picture to keep in view. */
function coverFocus({ x, y }: { x: number; y: number }): string {
  if (Math.abs(y - 0.5) >= Math.abs(x - 0.5)) return y < 0.35 ? "top" : y > 0.65 ? "bottom" : "center";
  return x < 0.35 ? "left" : x > 0.65 ? "right" : "center";
}

/** A table's cells as the Table block keeps them: rows of plain text, the header first and the footer last. */
function tableCells(rows: TableRow[]): string[][] {
  const text = (row: TableRow) => row.cells.map((cell) => collapsed(textOf(cell)));
  const head = rows.filter((row) => row.header && !row.footer);
  const foot = rows.filter((row) => row.footer);
  const body = rows.filter((row) => !row.header && !row.footer);
  return [...head.slice(0, 1), ...body, ...head.slice(1), ...foot.slice(-1)].map(text);
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function columnCount(count: number): string {
  return String(Math.min(4, Math.max(1, Math.round(count) || 1)));
}

function imageBlock(writer: BlockWriter, image: ImagePart, aspect = "auto"): BlockData {
  return writer.block("Image", {
    alt: image.alt,
    aspect,
    caption: image.caption,
    decorative: false,
    rounded: false,
    src: image.src,
  });
}

function tableText(rows: TableRow[], link: (address: string) => string): string {
  return rows
    .map((row) => {
      const cells = row.cells.map((cell) => inlineRichText(cell, link)).filter(Boolean);
      if (cells.length === 0) return "";
      const text = cells.join(" · ");
      return row.header ? `<p><strong>${text}</strong></p>` : `<p>${text}</p>`;
    })
    .join("");
}

function videoBlock(writer: BlockWriter, url: string, caption: string): BlockData {
  const youtube = youtubeVideo(url);
  const vimeo = !youtube && vimeoVideo(url);
  return writer.block("Video", {
    autoplay: false,
    caption,
    captions: "",
    captionsLabel: "",
    embed: "",
    file: youtube || vimeo ? "" : url,
    loop: false,
    muted: false,
    poster: "",
    rounded: false,
    shape: "auto",
    source: youtube ? "youtube" : vimeo ? "vimeo" : "upload",
    title: caption,
    vimeo: vimeo ? url : "",
    youtube: youtube ? url : "",
  });
}

/** Parts as blocks, with text parts in a row put in one Text block. */
export function partBlocks(parts: Part[], writer: BlockWriter, options: PageBlocksOptions): BlockData[] {
  const has = (block: string) => !options.blocks || options.blocks.includes(block);
  const out: BlockData[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(writer.block("Text", { align: "left", content: text }));
    text = "";
  };
  const link = (href: string, label: string) =>
    `<p><a href="${escapeHtml(href).replace(/"/g, "&quot;")}">${escapeHtml(label)}</a></p>`;
  for (const part of parts) {
    if (part.kind === "text" || (part.kind === "table" && !has("Table"))) {
      text += part.kind === "text" ? richTextHtml(part.nodes, options.link) : tableText(part.rows, options.link);
      continue;
    }
    // Without their blocks, these come across as text, as they did before them.
    if (part.kind === "pullquote" && !has("Pullquote")) {
      text += `<blockquote><p>${escapeHtml(part.quote).replace(/\n/g, "<br>")}</p>${part.citation ? `<p>${escapeHtml(part.citation)}</p>` : ""}</blockquote>`;
      continue;
    }
    if (part.kind === "file" && !has("File")) {
      text += link(part.href, part.label || decodeURIComponent(part.href.split("/").pop() ?? part.href));
      continue;
    }
    if (part.kind === "audio" && !has("Audio")) {
      text += link(part.url, part.caption || decodeURIComponent(part.url.split("/").pop() ?? part.url));
      continue;
    }
    if (part.kind === "post" && !has("Embed")) {
      text += link(part.link, part.caption || part.url);
      continue;
    }
    if (part.kind === "details" && !has("Details")) {
      if (part.summary) text += `<p><strong>${escapeHtml(part.summary)}</strong></p>`;
      flush();
      out.push(...partBlocks(part.parts, writer, options));
      continue;
    }
    flush();
    switch (part.kind) {
      case "heading":
        out.push(writer.heading(part.text, HEADING_LEVELS[part.level] ?? "h2"));
        break;
      case "image":
        out.push(imageBlock(writer, part.image));
        break;
      case "gallery":
        out.push(
          has("Gallery")
            ? writer.block("Gallery", {
                caption: "",
                columns: String(Math.min(4, Math.max(2, Math.round(part.columns) || 3))),
                crop: true,
                images: part.images.map((image) => ({ alt: image.alt, caption: image.caption, src: image.src })),
                rounded: false,
              })
            : writer.block("Grid", {
                columns: columnCount(part.columns),
                gap: "md",
                items: part.images.map((image) => imageBlock(writer, image, "square")),
              }),
        );
        break;
      case "table":
        out.push(
          writer.block("Table", {
            caption: part.caption ?? "",
            cells: tableCells(part.rows),
            footer: part.rows.some((row) => row.footer),
            header: part.rows.some((row) => row.header && !row.footer),
            striped: false,
          }),
        );
        break;
      case "separator":
        out.push(
          has("Separator") ? writer.block("Separator", { style: part.style }) : writer.block("Space", { size: "md" }),
        );
        break;
      case "pullquote":
        out.push(writer.block("Pullquote", { align: "center", citation: part.citation, quote: part.quote }));
        break;
      case "preformatted": {
        const block = part.verse ? "Verse" : "Preformatted";
        out.push(
          has(block)
            ? writer.block(block, { text: part.text })
            : writer.block("Code", { code: part.text, colors: "page", copyLabel: "", language: "text", title: "" }),
        );
        break;
      }
      case "details":
        out.push(
          writer.block("Details", {
            content: partBlocks(part.parts, writer, options),
            open: part.open,
            summary: part.summary,
          }),
        );
        break;
      case "file":
        if (part.preview && has("Document") && /\.pdf$/i.test(part.href.split(/[?#]/)[0] ?? "")) {
          out.push(
            writer.block("Document", {
              file: part.href,
              title: part.label,
              height: part.preview,
              linkLabel: "Open the document",
            }),
          );
          break;
        }
        out.push(
          writer.block("File", {
            button: part.button,
            buttonLabel: part.buttonLabel || "Download",
            file: part.href,
            label: part.label,
          }),
        );
        break;
      case "audio":
        out.push(writer.block("Audio", { caption: part.caption, loop: false, src: part.url }));
        break;
      case "media-text": {
        const content = partBlocks(part.parts, writer, options);
        if (has("MediaText")) {
          out.push(
            writer.block("MediaText", {
              align: "center",
              alt: part.alt,
              content,
              media: part.media,
              position: part.right ? "right" : "left",
              rounded: false,
              width: part.width,
            }),
          );
          break;
        }
        const media = /\.(mp4|webm)(\?|$)/i.test(part.media)
          ? videoBlock(writer, part.media, "")
          : imageBlock(writer, { src: part.media, alt: part.alt, caption: "" });
        const text =
          content.length === 1 && content[0]
            ? content[0]
            : writer.block("Flex", {
                align: "stretch",
                direction: "column",
                gap: "md",
                items: content,
                justify: "start",
                wrap: false,
              });
        out.push(writer.block("Grid", { columns: "2", gap: "lg", items: part.right ? [text, media] : [media, text] }));
        break;
      }
      case "pages":
        if (has("PageList")) out.push(writer.block("PageList", { parent: "" }));
        break;
      case "columns": {
        const columns = part.columns
          .map((column) => partBlocks(column, writer, options))
          .filter((column) => column.length > 0);
        if (columns.length === 0) break;
        if (columns.length === 1) {
          out.push(...(columns[0] ?? []));
          break;
        }
        out.push(
          writer.block("Grid", {
            columns: columnCount(columns.length),
            gap: "lg",
            items: columns.map((column) =>
              column.length === 1 && column[0]
                ? column[0]
                : writer.block("Flex", {
                    align: "stretch",
                    direction: "column",
                    gap: "md",
                    items: column,
                    justify: "start",
                    wrap: false,
                  }),
            ),
          }),
        );
        break;
      }
      case "cover":
        // Covers are sections of their own; see `pageBlocks()`.
        out.push(...partBlocks(part.parts, writer, options));
        break;
      case "buttons": {
        const buttons = part.buttons.map((button) =>
          writer.block("Button", {
            href: button.href,
            label: button.label,
            newTab: button.newTab,
            size: "md",
            variant: button.outline ? "outline" : "primary",
          }),
        );
        out.push(
          buttons.length === 1 && buttons[0]
            ? buttons[0]
            : writer.block("Flex", {
                align: "center",
                direction: "row",
                gap: "md",
                items: buttons,
                justify: "start",
                wrap: true,
              }),
        );
        break;
      }
      case "space":
        out.push(writer.block("Space", { size: part.size }));
        break;
      case "video":
        out.push(videoBlock(writer, part.url, part.caption));
        break;
      case "post":
        out.push(writer.block("Embed", { post: part.url, title: "", height: 0, caption: part.caption }));
        break;
      case "code":
        out.push(writer.block("Code", { code: part.code, colors: "page", copyLabel: "", language: "text", title: "" }));
        break;
      case "posts":
        if (options.posts) out.push(writer.collectionList({ collection: options.posts, limit: part.count }));
        break;
    }
  }
  flush();
  return out;
}

function isWide(parts: Part[]): boolean {
  return parts.some(
    (part) => part.kind === "columns" || part.kind === "gallery" || part.kind === "posts" || part.kind === "media-text",
  );
}

/**
 * A page's content: its title as its heading, then its parts in a Section,
 * with each cover a Section of its own with the cover's picture behind it.
 */
export function pageBlocks(title: string | undefined, parts: Part[], options: PageBlocksOptions): BlockData[] {
  const writer = options.writer ?? new BlockWriter();
  const sections: BlockData[] = [];
  let pending: Part[] = [];
  let first = true;
  const flush = () => {
    const content = partBlocks(pending, writer, options);
    if (first && title) content.unshift(writer.heading(title, "h1"));
    if (content.length > 0) sections.push(writer.section(content, { width: isWide(pending) ? "normal" : "narrow" }));
    first = first && content.length === 0;
    pending = [];
  };
  for (const part of parts) {
    if (part.kind !== "cover") {
      pending.push(part);
      continue;
    }
    if (pending.length > 0) flush();
    const content = partBlocks(part.parts, writer, options);
    if (first && title) content.unshift(writer.heading(title, "h1"));
    first = false;
    sections.push(writer.section(content, { width: "normal", backgroundImage: part.image, look: part.look }));
  }
  flush();
  if (sections.length === 0 && title) sections.push(writer.section([writer.heading(title, "h1")]));
  return sections;
}
