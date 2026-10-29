/**
 * Turns WordPress content into parts Goodfellow can show: headings, text,
 * images, galleries, columns, buttons, videos, code and tables. Content saved
 * by the block editor is read block by block; classic content and the HTML
 * WordPress shows are read element by element, by WordPress's class names
 * where they say what a block was. `blocks.ts` and `markdown.ts` write the
 * parts as Puck blocks and as Markdown.
 */
import { embeddedPost } from "../embeds.js";
import { vimeoVideo, youtubeVideo } from "../video.js";
import { blockHtml, hasBlocks, parseBlocks, type WordPressBlock } from "./blocks.js";
import {
  attribute,
  autoParagraphs,
  backgroundImage,
  type ChildNode,
  childElements,
  classes,
  collapsed,
  type Element,
  findElement,
  findElements,
  hasClass,
  isElement,
  parseHtml,
  tagName,
  textOf,
} from "./html.js";
import type { WordPressItem, WordPressMedia } from "./model.js";

export interface ImagePart {
  src: string;
  alt: string;
  caption: string;
}

export interface ButtonPart {
  label: string;
  href: string;
  outline: boolean;
  newTab: boolean;
}

export interface TableRow {
  header: boolean;
  /** A row of the table's footer (`<tfoot>`), such as totals. */
  footer?: boolean;
  cells: ChildNode[][];
}

export type SpaceSize = "sm" | "md" | "lg" | "xl";

/** How a cover's picture is shown: how strong a color over it, how tall, and the part kept in view. */
export interface CoverLook {
  /** WordPress's `dimRatio`, from 0 to 100. */
  dim: number;
  /** The least height in pixels, or 0. */
  minHeight: number;
  /** WordPress's focal point, each from 0 to 1. */
  focus?: { x: number; y: number };
}

export type MediaWidth = "third" | "half" | "two-thirds";

/** One part of a page or post. `text` holds paragraphs, lists and quotes as HTML elements. */
export type Part =
  | { kind: "heading"; level: number; text: string }
  | { kind: "text"; nodes: ChildNode[] }
  | { kind: "image"; image: ImagePart }
  | { kind: "gallery"; images: ImagePart[]; columns: number }
  | { kind: "columns"; columns: Part[][] }
  | { kind: "cover"; image: string; parts: Part[]; look?: CoverLook }
  | { kind: "buttons"; buttons: ButtonPart[] }
  | { kind: "space"; size: SpaceSize }
  | { kind: "separator"; style: "default" | "wide" | "dots" }
  | { kind: "pullquote"; quote: string; citation: string }
  /** Text kept as it's typed: WordPress's Preformatted block, or its Verse block. */
  | { kind: "preformatted"; text: string; verse: boolean }
  | { kind: "details"; summary: string; open: boolean; parts: Part[] }
  | { kind: "file"; href: string; label: string; button: boolean; buttonLabel: string }
  | { kind: "audio"; url: string; caption: string }
  | {
      kind: "media-text";
      media: string;
      alt: string;
      right: boolean;
      width: MediaWidth;
      parts: Part[];
    }
  /** WordPress's Page List block. */
  | { kind: "pages" }
  /** A YouTube or Vimeo video, or a video file, by its address. */
  | { kind: "video"; url: string; caption: string }
  /** A post from a social site the Social post block shows (`embeddedPost()`), by the address it came with, and that address on the new site as a link. */
  | { kind: "post"; url: string; link: string; caption: string }
  | { kind: "code"; code: string; language: string }
  | { kind: "table"; rows: TableRow[]; caption?: string }
  /** A list of the latest posts. */
  | { kind: "posts"; count: number };

/** What couldn't come across as it was. */
export type ConversionNote =
  /** A block of another plugin's, brought across as its HTML. */
  | "block"
  /** A block that shows something of WordPress's own, such as comments, left out. */
  | "dropped"
  /** A shortcode, which only WordPress can show, left out. */
  | "shortcode"
  /** Something from another site that isn't a video, such as a post on social media, now a link. */
  | "embed"
  /** A form, which needs the Form block. */
  | "form"
  /** A script or something else that would run code, left out. */
  | "script"
  /** A table, which pages show as text on sites without the Table block. */
  | "table"
  /** A list of the latest posts, which posts can't show. */
  | "posts"
  /** A video in a post, which Markdown shows as a link to it. */
  | "video";

export interface ConvertContext {
  /** A link's new address: the old site's pages become their new addresses, and unsafe addresses `""`. */
  link(address: string): string;
  /** A media file's new address, such as `/media/photo.jpg`. */
  media(address: string): string;
  attachment(id: number): WordPressMedia | undefined;
  /** A reusable block's content. */
  reusable(id: number): string | undefined;
  note(note: ConversionNote, name: string): void;
}

/** An item's content as parts. */
export function itemParts(item: Pick<WordPressItem, "content" | "rendered">, context: ConvertContext): Part[] {
  if (item.rendered) return htmlParts(parseHtml(item.content).children, context);
  if (hasBlocks(item.content)) return blockParts(parseBlocks(item.content), context, new Set());
  return classicParts(item.content, context);
}

function classicParts(text: string, context: ConvertContext): Part[] {
  return htmlParts(parseHtml(autoParagraphs(expandShortcodes(text, context))).children, context);
}

/* Shortcodes */

const SHORTCODE_ATTRIBUTE = /([a-z_][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))/gi;

function shortcodeAttributes(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of text.matchAll(SHORTCODE_ATTRIBUTE)) {
    values[(match[1] ?? "").toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return values;
}

const escapeAttribute = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function attachmentImage(context: ConvertContext, id: number): string {
  const media = context.attachment(id);
  return media
    ? `<img src="${escapeAttribute(media.url)}" alt="${escapeAttribute(media.alt)}" class="wp-image-${id}">`
    : "";
}

function embedFigure(url: string): string {
  return `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">${escapeAttribute(url.trim())}</div></figure>`;
}

/**
 * Puts WordPress's own shortcodes in HTML: `[caption]`, `[gallery]`,
 * `[embed]`, `[video]` and `[audio]`, and addresses on lines of their own,
 * which WordPress shows as what they link to. Other shortcodes are left out,
 * keeping any text they wrap.
 */
export function expandShortcodes(text: string, context: ConvertContext): string {
  let html = text
    .replace(/\[caption([^\]]*)\]([\s\S]*?)\[\/caption\]/gi, (_, _attributes: string, inner: string) => {
      const image = /<a\b[^>]*>\s*<img\b[^>]*>\s*<\/a>|<img\b[^>]*>/i.exec(inner)?.[0] ?? "";
      const caption = inner.replace(image, "").trim();
      return `<figure class="wp-caption">${image}<figcaption>${caption}</figcaption></figure>`;
    })
    .replace(/\[gallery([^\]]*)\]/gi, (_, attributes: string) => {
      const values = shortcodeAttributes(attributes);
      const ids = (values.ids ?? values.include ?? "")
        .split(",")
        .map((id) => Number.parseInt(id.trim(), 10))
        .filter((id) => id > 0);
      if (ids.length === 0) {
        context.note("shortcode", "gallery");
        return "";
      }
      return `<figure class="wp-block-gallery columns-${values.columns ?? "3"}">${ids.map((id) => attachmentImage(context, id)).join("")}</figure>`;
    })
    .replace(/\[embed[^\]]*\]([\s\S]*?)\[\/embed\]/gi, (_, url: string) => embedFigure(url))
    .replace(/\[(video|audio)([^\]]*)\](?:\[\/\1\])?/gi, (_, kind: string, attributes: string) => {
      const values = shortcodeAttributes(attributes);
      const src = values.src ?? values.mp4 ?? values.webm ?? values.mp3 ?? values.m4a ?? values.ogg ?? "";
      return src ? `<${kind.toLowerCase()} src="${escapeAttribute(src)}"></${kind.toLowerCase()}>` : "";
    })
    // An address alone on a line is shown as what it links to, such as a video.
    .replace(/^\s*(https?:\/\/[^\s<>"]+)\s*$/gim, (_, url: string) => embedFigure(url));

  // Other shortcodes: a pair keeps what's inside it; one on its own is left out.
  const names = new Set<string>();
  html = html.replace(/\[\/([a-z][a-z0-9_-]*)\]/gi, (_, name: string) => {
    names.add(name.toLowerCase());
    return "";
  });
  html = html.replace(/\[([a-z][a-z0-9_-]*)(\s[^\]]*)?\]/gi, (whole, name: string, attributes?: string) => {
    const lower = name.toLowerCase();
    // Text in brackets, such as "[sic]", isn't a shortcode.
    if (!names.has(lower) && !attributes?.includes("=") && !/[_-]/.test(lower)) return whole;
    if (!names.has(lower)) context.note("shortcode", lower);
    return "";
  });
  return html;
}

/* Blocks */

const DROPPED =
  /^core\/(comments|comment-|post-|query-|site-|navigation|template-part|search|loginout|archives|categories|calendar|tag-cloud|rss|latest-comments|read-more|home-link|avatar|term-description|pattern)/;
const SILENT = new Set(["core/more", "core/nextpage"]);

function htmlOf(html: string, context: ConvertContext): Part[] {
  return htmlParts(parseHtml(html).children, context);
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** The Media & Text block's picture width, a percentage, as the nearest of Goodfellow's. */
function mediaWidth(percent: number): MediaWidth {
  if (percent < 42) return "third";
  if (percent > 58) return "two-thirds";
  return "half";
}

function blockParts(blocks: WordPressBlock[], context: ConvertContext, reused: Set<number>): Part[] {
  return blocks.flatMap((block) => blockToParts(block, context, reused));
}

function blockToParts(block: WordPressBlock, context: ConvertContext, reused: Set<number>): Part[] {
  const inner = () => blockParts(block.innerBlocks, context, reused);
  const html = () => blockHtml(block);
  const name = block.name.startsWith("core-embed/") ? "core/embed" : block.name;
  switch (name) {
    case "core/freeform":
      return classicParts(block.innerHTML, context);
    case "core/shortcode":
      return htmlOf(autoParagraphs(expandShortcodes(html(), context)), context);
    case "core/paragraph":
    case "core/html":
      return htmlOf(expandShortcodes(html(), context), context);
    case "core/embed": {
      const url = typeof block.attrs.url === "string" ? block.attrs.url : textOf(parseHtml(html())).trim();
      const caption = collapsed(
        textOf(findElement(parseHtml(html()).children, (element) => element.name === "figcaption") ?? []),
      );
      return url ? embedParts(url, caption, context) : [];
    }
    case "core/gallery":
      if (block.innerBlocks.length > 0) {
        const images = inner().flatMap((part) => (part.kind === "image" ? [part.image] : []));
        return images.length
          ? [{ kind: "gallery", images, columns: number(block.attrs.columns, Math.min(images.length, 3)) }]
          : [];
      }
      return htmlOf(html(), context);
    case "core/columns":
      return [
        {
          kind: "columns",
          columns: block.innerBlocks.map((column) => blockParts(column.innerBlocks, context, reused)),
        },
      ];
    case "core/column":
    case "core/group":
    case "core/row":
    case "core/stack":
      return block.innerBlocks.length > 0 ? inner() : htmlOf(html(), context);
    case "core/cover": {
      const image = typeof block.attrs.url === "string" ? context.media(block.attrs.url) : "";
      const parts = inner();
      const focal = block.attrs.focalPoint as { x?: unknown; y?: unknown } | undefined;
      const look: CoverLook = {
        dim: number(block.attrs.dimRatio, 50),
        minHeight:
          block.attrs.minHeightUnit && block.attrs.minHeightUnit !== "px" ? 0 : number(block.attrs.minHeight, 0),
        ...(focal && { focus: { x: number(focal.x, 0.5), y: number(focal.y, 0.5) } }),
      };
      return image ? [{ kind: "cover", image, parts, look }] : parts;
    }
    case "core/media-text": {
      // WordPress keeps the picture's address and description in the block's HTML, not its comment.
      const picture = findElement(
        parseHtml(html()).children,
        (element) =>
          (element.name === "img" || element.name === "video") &&
          hasClass(element.parent ?? undefined, "wp-block-media-text__media"),
      );
      const url =
        typeof block.attrs.mediaUrl === "string" && block.attrs.mediaUrl
          ? block.attrs.mediaUrl
          : attribute(picture, "src");
      const right = block.attrs.mediaPosition === "right";
      if (!url) {
        const columns: Part[][] = [[], inner()];
        return [{ kind: "columns", columns: right ? columns.reverse() : columns }];
      }
      return [
        {
          kind: "media-text",
          media: context.media(url),
          alt: typeof block.attrs.mediaAlt === "string" ? block.attrs.mediaAlt : attribute(picture, "alt"),
          right,
          width: mediaWidth(number(block.attrs.mediaWidth, 50)),
          parts: inner(),
        },
      ];
    }
    case "core/page-list":
      return [{ kind: "pages" }];
    case "core/buttons":
    case "core/button":
      return htmlOf(html(), context);
    case "core/block": {
      const ref = number(block.attrs.ref, 0);
      const content = context.reusable(ref);
      if (!content || reused.has(ref)) return [];
      return blockParts(parseBlocks(content), context, new Set([...reused, ref]));
    }
    case "core/latest-posts":
      return [{ kind: "posts", count: number(block.attrs.postsToShow, 5) }];
    case "core/query": {
      const query = block.attrs.query as { perPage?: unknown } | undefined;
      return [{ kind: "posts", count: number(query?.perPage, 10) }];
    }
    case "core/social-links": {
      const links = block.innerBlocks.flatMap((link) => {
        const url = typeof link.attrs.url === "string" ? context.link(link.attrs.url) : "";
        const label =
          typeof link.attrs.label === "string" && link.attrs.label
            ? link.attrs.label
            : String(link.attrs.service ?? url);
        return url ? [`<a href="${escapeAttribute(url)}">${escapeAttribute(label)}</a>`] : [];
      });
      return links.length ? htmlOf(`<p>${links.join(" · ")}</p>`, context) : [];
    }
    default:
      if (SILENT.has(name)) return [];
      if (DROPPED.test(name)) {
        context.note("dropped", name);
        return [];
      }
      if (name.startsWith("core/"))
        return block.innerBlocks.length > 0 && !block.innerHTML.trim() ? inner() : htmlOf(html(), context);
      context.note("block", name);
      return block.innerBlocks.length > 0 && !block.innerHTML.replace(/<[^>]*>/g, "").trim()
        ? inner()
        : htmlOf(html(), context);
  }
}

/* HTML */

const INLINE = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "br",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "i",
  "ins",
  "kbd",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "u",
  "var",
  "wbr",
]);

/** Elements that would run code, or that can't be shown without WordPress. */
const LEFT_OUT: Record<string, ConversionNote> = {
  script: "script",
  noscript: "script",
  object: "script",
  embed: "script",
  applet: "script",
  form: "form",
  input: "form",
  select: "form",
  textarea: "form",
  button: "form",
};

function isImageOnly(element: Element): boolean {
  const meaningful = element.children.filter(
    (node) => !(node.type === "text" && !textOf(node).trim()) && tagName(node) !== "br",
  );
  return (
    meaningful.length > 0 &&
    meaningful.every(
      (node) => tagName(node) === "img" || (tagName(node) === "a" && isElement(node) && isImageOnly(node)),
    )
  );
}

function isBlank(nodes: ChildNode[]): boolean {
  return nodes.every((node) =>
    node.type === "text" ? !textOf(node).trim() : tagName(node) === "br" || node.type === "comment",
  );
}

/** An image's details: its new address, and its description and caption, from WordPress's media library where the HTML has none. */
function imagePart(image: Element, context: ConvertContext, caption = ""): ImagePart | undefined {
  const src = attribute(image, "src") || attribute(image, "data-src");
  if (!src) return undefined;
  const id = Number.parseInt(
    /\bwp-image-(\d+)\b/.exec(attribute(image, "class"))?.[1] ?? attribute(image, "data-id"),
    10,
  );
  const media = Number.isFinite(id) ? context.attachment(id) : undefined;
  return {
    src: context.media(src),
    alt: collapsed(attribute(image, "alt")) || media?.alt || "",
    caption: caption || "",
  };
}

function imagesIn(node: Element | ChildNode[], context: ConvertContext): ImagePart[] {
  return findElements(Array.isArray(node) ? node : [node], (element) => element.name === "img").flatMap((image) => {
    const figure =
      (image.parent && tagName(image.parent) === "figure" ? image.parent : image.parent?.parent) ?? undefined;
    const caption =
      figure && tagName(figure) === "figure"
        ? findElement(figure, (element) => element.name === "figcaption")
        : undefined;
    const part = imagePart(image, context, caption ? collapsed(textOf(caption)) : "");
    return part ? [part] : [];
  });
}

/**
 * Something from another site: YouTube and Vimeo videos and video files are
 * videos, posts from the sites the Social post block shows are posts, and
 * anything else is a link to it.
 */
function embedParts(url: string, caption: string, context: ConvertContext): Part[] {
  const address = url.trim();
  if (youtubeVideo(address) || vimeoVideo(address)) return [{ kind: "video", url: address, caption }];
  if (/\.(mp4|webm)(\?|$)/i.test(address)) return [{ kind: "video", url: context.media(address), caption }];
  const href = context.link(address);
  if (!href) return [];
  const post = embeddedPost(address);
  if ("post" in post || post.problem === "handle") return [{ kind: "post", url: address, link: href, caption }];
  try {
    context.note("embed", new URL(address).hostname.replace(/^www\./, ""));
  } catch {
    context.note("embed", address);
  }
  const link = parseHtml(`<p><a href="${escapeAttribute(href)}">${escapeAttribute(caption || address)}</a></p>`);
  return [{ kind: "text", nodes: link.children }];
}

function spaceSize(height: string): SpaceSize {
  const pixels = Number.parseFloat(height);
  if (!Number.isFinite(pixels) || pixels <= 24) return "sm";
  if (pixels <= 48) return "md";
  if (pixels <= 96) return "lg";
  return "xl";
}

function tableRows(table: Element): TableRow[] {
  return findElements(table, (element) => element.name === "tr").map((row) => ({
    header: tagName(row.parent ?? undefined) === "thead" || childElements(row).every((cell) => cell.name === "th"),
    ...(tagName(row.parent ?? undefined) === "tfoot" && { footer: true }),
    cells: childElements(row)
      .filter((cell) => cell.name === "td" || cell.name === "th")
      .map((cell) => cell.children),
  }));
}

function buttonsIn(element: Element, context: ConvertContext): ButtonPart[] {
  return findElements(element, (candidate) => candidate.name === "a").flatMap((link) => {
    const label = collapsed(textOf(link));
    const href = context.link(attribute(link, "href"));
    if (!label || !href) return [];
    let wrapper: Element | null = link;
    while (wrapper && !hasClass(wrapper, "wp-block-button")) wrapper = wrapper.parent as Element | null;
    return [
      {
        label,
        href,
        outline: classes(wrapper ?? link).includes("is-style-outline"),
        newTab: attribute(link, "target") === "_blank",
      },
    ];
  });
}

/** Parts from HTML, element by element. Text that isn't in a block element becomes paragraphs. */
export function htmlParts(nodes: ChildNode[], context: ConvertContext): Part[] {
  const parts: Part[] = [];
  let loose: ChildNode[] = [];
  const flush = () => {
    if (!isBlank(loose)) {
      const paragraph = parseHtml("<p></p>").children[0] as Element;
      for (const node of loose) {
        node.parent = paragraph;
        paragraph.children.push(node);
      }
      parts.push({ kind: "text", nodes: [paragraph] });
    }
    loose = [];
  };
  for (const node of nodes) {
    if (node.type === "text") {
      loose.push(node);
      continue;
    }
    if (!isElement(node)) continue;
    const name = node.name.toLowerCase();
    if (INLINE.has(name) && !(name === "a" && isImageOnly(node))) {
      loose.push(node);
      continue;
    }
    flush();
    parts.push(...elementParts(node, name, context));
  }
  flush();
  return parts;
}

function elementParts(element: Element, name: string, context: ConvertContext): Part[] {
  if (LEFT_OUT[name]) {
    context.note(LEFT_OUT[name], name);
    return [];
  }
  if (/^h[1-6]$/.test(name)) {
    const text = collapsed(textOf(element));
    return text ? [{ kind: "heading", level: Number(name.slice(1)), text }] : [];
  }
  switch (name) {
    case "img":
    case "a": {
      const images = imagesIn(element, context);
      return images.map((image) => ({ kind: "image" as const, image }));
    }
    case "p": {
      if (isImageOnly(element)) return imagesIn(element, context).map((image) => ({ kind: "image" as const, image }));
      const frame = findElement(element, (candidate) => candidate.name === "iframe");
      if (frame) return [...embedParts(attribute(frame, "src"), "", context)];
      // Pictures beside text go after it, since text can't hold them.
      const images = imagesIn(element, context).map((image) => ({ kind: "image" as const, image }));
      return [{ kind: "text", nodes: [element] }, ...images];
    }
    case "ul":
    case "ol":
      if (hasClass(element, "wp-block-latest-posts")) {
        return [{ kind: "posts", count: childElements(element).length || 5 }];
      }
      if (hasClass(element, "wp-block-page-list")) return [{ kind: "pages" }];
      return [{ kind: "text", nodes: [element] }];
    case "blockquote":
      if (hasClass(element, "wp-block-pullquote")) return pullquoteParts(element);
      return [{ kind: "text", nodes: [element] }];
    case "dl":
    case "address":
      return [{ kind: "text", nodes: [element] }];
    case "details": {
      const summary = findElement(element, (candidate) => candidate.name === "summary");
      return [
        {
          kind: "details",
          summary: summary ? collapsed(textOf(summary)) : "",
          open: element.attribs.open !== undefined,
          parts: htmlParts(
            element.children.filter((node) => node !== summary),
            context,
          ),
        },
      ];
    }
    case "pre": {
      if (hasClass(element, "wp-block-verse") || hasClass(element, "wp-block-preformatted")) {
        return [{ kind: "preformatted", text: preText(element.children), verse: hasClass(element, "wp-block-verse") }];
      }
      const code = findElement(element, (candidate) => candidate.name === "code");
      const language =
        /\blang(?:uage)?-([a-z0-9+#-]+)/i.exec(`${attribute(code, "class")} ${attribute(element, "class")}`)?.[1] ?? "";
      return [
        {
          kind: "code",
          code: textOf(element).replace(/^\n/, "").replace(/\s+$/, ""),
          language: language.toLowerCase(),
        },
      ];
    }
    case "table":
      return [{ kind: "table", rows: tableRows(element) }];
    case "hr":
      return [
        {
          kind: "separator",
          style: hasClass(element, "is-style-wide") ? "wide" : hasClass(element, "is-style-dots") ? "dots" : "default",
        },
      ];
    case "iframe":
      return embedParts(attribute(element, "src"), attribute(element, "title"), context);
    case "video": {
      const source =
        attribute(element, "src") ||
        attribute(
          findElement(element, (candidate) => candidate.name === "source"),
          "src",
        );
      return source ? [{ kind: "video", url: context.media(source), caption: "" }] : [];
    }
    case "audio": {
      const source =
        attribute(element, "src") ||
        attribute(
          findElement(element, (candidate) => candidate.name === "source"),
          "src",
        );
      const url = source ? context.media(source) : "";
      return url ? [{ kind: "audio", url, caption: "" }] : [];
    }
    case "figure":
      return figureParts(element, context);
    case "style":
    case "template":
    case "svg":
    case "canvas":
    case "link":
    case "meta":
      return [];
    default:
      return blockElementParts(element, context);
  }
}

function figureParts(figure: Element, context: ConvertContext): Part[] {
  const caption = findElement(figure, (element) => element.name === "figcaption");
  const captionText = caption ? collapsed(textOf(caption)) : "";
  if (hasClass(figure, "wp-block-gallery") || classes(figure).some((name) => name.startsWith("gallery"))) {
    const images = imagesIn(figure, context);
    const columns = Number.parseInt(/\bcolumns-(\d)\b/.exec(attribute(figure, "class"))?.[1] ?? "", 10);
    return images.length
      ? [{ kind: "gallery", images, columns: Number.isFinite(columns) ? columns : Math.min(images.length, 3) }]
      : [];
  }
  if (hasClass(figure, "wp-block-pullquote")) return pullquoteParts(figure);
  const table = findElement(figure, (element) => element.name === "table");
  if (table) return [{ kind: "table", rows: tableRows(table), ...(captionText && { caption: captionText }) }];
  const frame = findElement(figure, (element) => element.name === "iframe");
  if (hasClass(figure, "wp-block-embed") || frame) {
    const wrapper = findElement(figure, (element) => hasClass(element, "wp-block-embed__wrapper"));
    const url = frame ? attribute(frame, "src") : collapsed(textOf(wrapper ?? figure).replace(captionText, ""));
    return url ? embedParts(url, captionText, context) : [];
  }
  const video = findElement(figure, (element) => element.name === "video" || element.name === "audio");
  if (video) {
    return elementParts(video, video.name, context).map((part) =>
      part.kind === "audio" || part.kind === "video" ? { ...part, caption: captionText } : part,
    );
  }
  const quote = findElement(figure, (element) => element.name === "blockquote");
  if (quote) return [{ kind: "text", nodes: [quote] }];
  const images = imagesIn(figure, context);
  if (images.length === 1 && images[0]) return [{ kind: "image", image: { ...images[0], caption: captionText } }];
  if (images.length > 1) return [{ kind: "gallery", images, columns: Math.min(images.length, 3) }];
  return htmlParts(
    figure.children.filter((node) => node !== caption),
    context,
  );
}

/** WordPress's Pullquote: its paragraphs, one to a line, and who said it. */
function pullquoteParts(element: Element): Part[] {
  const cite = findElement(element, (candidate) => candidate.name === "cite");
  const paragraphs = findElements(element, (candidate) => candidate.name === "p").map((p) => collapsed(textOf(p)));
  const quote = (paragraphs.length ? paragraphs : [collapsed(textOf(element).replace(cite ? textOf(cite) : "", ""))])
    .filter(Boolean)
    .join("\n");
  return quote ? [{ kind: "pullquote", quote, citation: cite ? collapsed(textOf(cite)) : "" }] : [];
}

/** Text kept as it's shown, with line breaks where the HTML has `<br>`s. */
function preText(nodes: ChildNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return textOf(node);
      if (!isElement(node)) return "";
      if (node.name === "br") return "\n";
      return preText(node.children);
    })
    .join("")
    .replace(/^\n/, "")
    .replace(/\s+$/, "");
}

/** A cover's look as WordPress shows it: its overlay's strength, its height and its picture's focal point. */
function coverLook(cover: Element, background: Element | undefined): CoverLook {
  const overlay = findElement(cover, (candidate) => hasClass(candidate, "wp-block-cover__background"));
  const dimClass = classes(overlay ?? cover).find((name) => /^has-background-dim(-\d+)?$/.test(name));
  const ratio = dimClass ? Number.parseInt(dimClass.slice("has-background-dim-".length), 10) : Number.NaN;
  const dim = Number.isFinite(ratio) ? ratio : dimClass || overlay ? 50 : 0;
  const minHeight = Number.parseFloat(/min-height\s*:\s*([\d.]+)px/.exec(attribute(cover, "style"))?.[1] ?? "");
  const position = /([\d.]+)%\s+([\d.]+)%/.exec(
    attribute(background, "data-object-position") || attribute(background, "style"),
  );
  return {
    dim,
    minHeight: Number.isFinite(minHeight) ? minHeight : 0,
    ...(position && { focus: { x: Number(position[1]) / 100, y: Number(position[2]) / 100 } }),
  };
}

/** Block elements, such as WordPress's columns, buttons and covers as it shows them, or ones whose content stands on its own. */
function blockElementParts(element: Element, context: ConvertContext): Part[] {
  if (hasClass(element, "wp-block-columns")) {
    const columns = childElements(element).filter((child) => hasClass(child, "wp-block-column"));
    return [
      {
        kind: "columns",
        columns: (columns.length ? columns : childElements(element)).map((column) =>
          htmlParts(column.children, context),
        ),
      },
    ];
  }
  if (hasClass(element, "wp-block-buttons") || hasClass(element, "wp-block-button")) {
    const buttons = buttonsIn(element, context);
    return buttons.length ? [{ kind: "buttons", buttons }] : [];
  }
  if (hasClass(element, "wp-block-cover")) {
    const background = findElement(element, (candidate) => hasClass(candidate, "wp-block-cover__image-background"));
    const source = attribute(background, "src") || backgroundImage(element);
    const container = findElement(element, (candidate) => hasClass(candidate, "wp-block-cover__inner-container"));
    const parts = htmlParts(container?.children ?? [], context);
    return source
      ? [{ kind: "cover", image: context.media(source), parts, look: coverLook(element, background) }]
      : parts;
  }
  if (hasClass(element, "wp-block-media-text")) {
    const media = findElement(element, (candidate) => hasClass(candidate, "wp-block-media-text__media"));
    const content = findElement(element, (candidate) => hasClass(candidate, "wp-block-media-text__content"));
    const right = hasClass(element, "has-media-on-the-right");
    const picture = media && findElement(media, (candidate) => candidate.name === "img" || candidate.name === "video");
    const source = attribute(picture, "src");
    if (picture && source) {
      const percent = Number.parseFloat(
        /grid-template-columns\s*:\s*(?:auto\s+)?([\d.]+)%/.exec(attribute(element, "style"))?.[1] ?? "",
      );
      return [
        {
          kind: "media-text",
          media: context.media(source),
          alt: attribute(picture, "alt"),
          right,
          width: mediaWidth(Number.isFinite(percent) ? percent : 50),
          parts: htmlParts(content?.children ?? [], context),
        },
      ];
    }
    const columns = [media ? htmlParts(media.children, context) : [], htmlParts(content?.children ?? [], context)];
    return [{ kind: "columns", columns: right ? columns.reverse() : columns }];
  }
  if (hasClass(element, "wp-block-file")) {
    const links = findElements(element, (candidate) => candidate.name === "a");
    const button = links.find((link) => hasClass(link, "wp-block-file__button"));
    const link = links.find((candidate) => candidate !== button) ?? button;
    const href = link ? context.link(attribute(link, "href")) : "";
    if (!href) return [];
    return [
      {
        kind: "file",
        href,
        label: link && link !== button ? collapsed(textOf(link)) : "",
        button: Boolean(button),
        buttonLabel: button ? collapsed(textOf(button)) : "",
      },
    ];
  }
  if (hasClass(element, "wp-block-spacer")) {
    return [{ kind: "space", size: spaceSize(/height\s*:\s*([\d.]+)/.exec(attribute(element, "style"))?.[1] ?? "") }];
  }
  if (classes(element).some((name) => name === "gallery" || name.startsWith("gallery-columns-"))) {
    const images = imagesIn(element, context);
    const columns = Number.parseInt(/\bgallery-columns-(\d)\b/.exec(attribute(element, "class"))?.[1] ?? "", 10);
    return images.length ? [{ kind: "gallery", images, columns: Number.isFinite(columns) ? columns : 3 }] : [];
  }
  return htmlParts(element.children, context);
}
