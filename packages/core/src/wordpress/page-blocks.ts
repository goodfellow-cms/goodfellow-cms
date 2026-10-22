/**
 * Parts as a page's Puck blocks, built from Goodfellow's built-in blocks:
 * Sections holding Headings, Text, Images, Columns, Rows of Buttons, Space,
 * Videos, Code and Collection lists, with every prop written out as the
 * editor would.
 */
import { vimeoVideo, youtubeVideo } from "../video.js";
import type { ImagePart, Part, TableRow } from "./convert.js";
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

export interface PageBlocksOptions {
  link(address: string): string;
  /** The posts collection, for lists of the latest posts. */
  posts?: string;
  /** The page's writer, where it has more blocks than these. */
  writer?: BlockWriter;
}

/** Writes blocks with ids of their own on one page. */
export class BlockWriter {
  private count = 0;

  block(type: string, props: Record<string, unknown>): BlockData {
    this.count += 1;
    return { type, props: { id: `${type}-wp-${this.count}`, ...props, className: (props.className as string) ?? "" } };
  }

  /** A Section holding blocks, with space between them, as the starter's pages have. */
  section(content: BlockData[], props: { width?: string; backgroundImage?: string } = {}): BlockData {
    content.forEach((block, index) => {
      if (index > 0 && !block.props.className) block.props.className = "mt-6";
    });
    return this.block("Section", {
      background: "none",
      backgroundImage: props.backgroundImage ?? "",
      content,
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
  const out: BlockData[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push(writer.block("Text", { align: "left", content: text }));
    text = "";
  };
  for (const part of parts) {
    if (part.kind === "text" || part.kind === "table") {
      text += part.kind === "text" ? richTextHtml(part.nodes, options.link) : tableText(part.rows, options.link);
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
          writer.block("Grid", {
            columns: columnCount(part.columns),
            gap: "md",
            items: part.images.map((image) => imageBlock(writer, image, "square")),
          }),
        );
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
  return parts.some((part) => part.kind === "columns" || part.kind === "gallery" || part.kind === "posts");
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
    sections.push(writer.section(content, { width: "normal", backgroundImage: part.image }));
  }
  flush();
  if (sections.length === 0 && title) sections.push(writer.section([writer.heading(title, "h1")]));
  return sections;
}
