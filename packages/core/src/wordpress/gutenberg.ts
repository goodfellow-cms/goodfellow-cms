/**
 * Writing WordPress's blocks as the block editor saves them: HTML with a
 * comment around each block, `<!-- wp:paragraph -->…<!-- /wp:paragraph -->`,
 * the markup matching what each core block saves, so WordPress opens them as
 * blocks rather than as HTML it can't edit.
 */
import { type ChildNode, childElements, collapsed, isElement, parseHtml, tagName, textOf } from "./html.js";
import { inlineRichText } from "./rich-text.js";

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, "&quot;");

/** A block's attributes as WordPress writes them in its comment: JSON, with nothing that could end the comment. */
function attributes(attrs: Record<string, unknown> | undefined): string {
  if (!attrs || Object.keys(attrs).length === 0) return "";
  const json = JSON.stringify(attrs)
    .replace(/--/g, "\\u002d\\u002d")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  return ` ${json}`;
}

/** One block: its comment around its HTML, or a comment of its own for a block with none. */
export function wpBlock(name: string, attrs?: Record<string, unknown>, html?: string): string {
  if (html === undefined) return `<!-- wp:${name}${attributes(attrs)} /-->`;
  return `<!-- wp:${name}${attributes(attrs)} -->\n${html}\n<!-- /wp:${name} -->`;
}

/** Blocks inside another, as the block editor joins them. */
export function innerBlocks(blocks: string[]): string {
  return blocks.join("\n\n");
}

export function paragraph(html: string): string {
  return wpBlock("paragraph", undefined, `<p>${html}</p>`);
}

export function heading(text: string, level: number, align?: string): string {
  const shown = Math.min(6, Math.max(1, level));
  const aligned = align && align !== "left" ? ` has-text-align-${align}` : "";
  return wpBlock(
    "heading",
    { ...(shown !== 2 && { level: shown }), ...(aligned && { textAlign: align }) },
    `<h${shown} class="wp-block-heading${aligned}">${escapeText(text)}</h${shown}>`,
  );
}

export function image(src: string, alt: string, caption: string): string {
  const figcaption = caption ? `<figcaption class="wp-element-caption">${escapeText(caption)}</figcaption>` : "";
  return wpBlock(
    "image",
    undefined,
    `<figure class="wp-block-image"><img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}"/>${figcaption}</figure>`,
  );
}

export interface WpButton {
  label: string;
  href: string;
  outline: boolean;
  newTab: boolean;
}

export function buttons(list: WpButton[]): string {
  const inner = list.map((button) => {
    const outline = button.outline ? " is-style-outline" : "";
    const target = button.newTab ? ' target="_blank" rel="noreferrer noopener"' : "";
    return wpBlock(
      "button",
      { ...(button.outline && { className: "is-style-outline" }), ...(button.newTab && { linkTarget: "_blank" }) },
      `<div class="wp-block-button${outline}"><a class="wp-block-button__link wp-element-button" href="${escapeAttribute(button.href)}"${target}>${escapeText(button.label)}</a></div>`,
    );
  });
  return wpBlock("buttons", undefined, `<div class="wp-block-buttons">${innerBlocks(inner)}</div>`);
}

export function columns(list: string[][]): string {
  const inner = list.map((column) =>
    wpBlock("column", undefined, `<div class="wp-block-column">${innerBlocks(column)}</div>`),
  );
  return wpBlock("columns", undefined, `<div class="wp-block-columns">${innerBlocks(inner)}</div>`);
}

/** A group of blocks, one under another or, as a row, across. */
export function group(blocks: string[], row = false): string {
  const layout = row ? { type: "flex", flexWrap: "wrap" } : { type: "constrained" };
  return wpBlock("group", { layout }, `<div class="wp-block-group">${innerBlocks(blocks)}</div>`);
}

/** How a cover shows its picture: its overlay's strength, its least height and its focal point. */
export interface WpCoverLook {
  dimRatio: number;
  /** In pixels, or 0. */
  minHeight?: number;
  focalPoint?: { x: number; y: number };
}

export function cover(url: string, blocks: string[], look: WpCoverLook = { dimRatio: 50 }): string {
  const { dimRatio, minHeight, focalPoint } = look;
  const dim = dimRatio === 50 ? "has-background-dim" : `has-background-dim-${dimRatio} has-background-dim`;
  const position = focalPoint && `${Math.round(focalPoint.x * 100)}% ${Math.round(focalPoint.y * 100)}%`;
  return wpBlock(
    "cover",
    {
      url,
      dimRatio,
      ...(focalPoint && { focalPoint }),
      ...(minHeight && { minHeight, minHeightUnit: "px" }),
    },
    `<div class="wp-block-cover"${minHeight ? ` style="min-height:${minHeight}px"` : ""}><span aria-hidden="true" class="wp-block-cover__background ${dim}"></span><img class="wp-block-cover__image-background" alt="" src="${escapeAttribute(url)}"${position ? ` style="object-position:${position}"` : ""} data-object-fit="cover"${position ? ` data-object-position="${position}"` : ""}/><div class="wp-block-cover__inner-container">${innerBlocks(blocks)}</div></div>`,
  );
}

export function spacer(pixels: number): string {
  return wpBlock(
    "spacer",
    { height: `${pixels}px` },
    `<div style="height:${pixels}px" aria-hidden="true" class="wp-block-spacer"></div>`,
  );
}

export function separator(style: "default" | "wide" | "dots" = "default"): string {
  if (style === "default") {
    return wpBlock("separator", undefined, '<hr class="wp-block-separator has-alpha-channel-opacity"/>');
  }
  return wpBlock(
    "separator",
    { className: `is-style-${style}` },
    `<hr class="wp-block-separator has-alpha-channel-opacity is-style-${style}"/>`,
  );
}

/** Text with its line breaks as the block editor keeps them, `<br>`. */
const withBreaks = (text: string) => escapeText(text).replace(/\n/g, "<br>");

export function pullquote(quote: string, citation: string): string {
  const cite = citation ? `<cite>${escapeText(citation)}</cite>` : "";
  return wpBlock(
    "pullquote",
    undefined,
    `<figure class="wp-block-pullquote"><blockquote><p>${withBreaks(quote)}</p>${cite}</blockquote></figure>`,
  );
}

/** Text kept as it's typed: WordPress's Preformatted block, or its Verse block. */
export function preformatted(text: string, verse = false): string {
  const name = verse ? "verse" : "preformatted";
  return wpBlock(name, undefined, `<pre class="wp-block-${name}">${withBreaks(text)}</pre>`);
}

export function details(summary: string, open: boolean, blocks: string[]): string {
  return wpBlock(
    "details",
    open ? { showContent: true } : undefined,
    `<details class="wp-block-details"${open ? " open" : ""}><summary>${escapeText(summary)}</summary>${innerBlocks(blocks)}</details>`,
  );
}

/** A table of plain text, with its first row as headings and its last as a footer where asked. */
export function textTable(
  cells: string[][],
  options: { header: boolean; footer: boolean; caption: string; striped: boolean },
): string {
  const row = (cellsOf: string[], tag: "td" | "th") =>
    `<tr>${cellsOf.map((cell) => `<${tag}>${escapeText(cell)}</${tag}>`).join("")}</tr>`;
  const head = options.header && cells.length > 1 ? cells[0] : undefined;
  const foot = options.footer && cells.length > (head ? 2 : 1) ? cells[cells.length - 1] : undefined;
  const body = cells.slice(head ? 1 : 0, foot ? -1 : undefined);
  const stripes = options.striped ? " is-style-stripes" : "";
  const caption = options.caption
    ? `<figcaption class="wp-element-caption">${escapeText(options.caption)}</figcaption>`
    : "";
  return wpBlock(
    "table",
    options.striped ? { className: "is-style-stripes" } : undefined,
    `<figure class="wp-block-table${stripes}"><table>${head ? `<thead>${row(head, "th")}</thead>` : ""}<tbody>${body.map((cellsOf) => row(cellsOf, "td")).join("")}</tbody>${foot ? `<tfoot>${row(foot, "td")}</tfoot>` : ""}</table>${caption}</figure>`,
  );
}

/** A link to a file, with WordPress's download button, and its viewer on the page for a PDF with `preview`'s height. */
export function file(href: string, label: string, button: string | undefined, preview?: number): string {
  const download = button
    ? `<a href="${escapeAttribute(href)}" class="wp-block-file__button wp-element-button" download>${escapeText(button)}</a>`
    : "";
  const viewer = preview
    ? `<object class="wp-block-file__embed" data="${escapeAttribute(href)}" type="application/pdf" style="width:100%;height:${preview}px" aria-label="${escapeAttribute(label)}"></object>`
    : "";
  return wpBlock(
    "file",
    {
      href,
      ...(preview && { displayPreview: true, previewHeight: preview }),
      ...(!button && { showDownloadButton: false }),
    },
    `<div class="wp-block-file">${viewer}<a href="${escapeAttribute(href)}">${escapeText(label)}</a>${download}</div>`,
  );
}

export function audio(src: string, caption = "", loop = false): string {
  const figcaption = caption ? `<figcaption class="wp-element-caption">${escapeText(caption)}</figcaption>` : "";
  return wpBlock(
    "audio",
    loop ? { loop: true } : undefined,
    `<figure class="wp-block-audio"><audio controls src="${escapeAttribute(src)}"${loop ? " loop" : ""}></audio>${figcaption}</figure>`,
  );
}

/** A picture or video beside blocks; `width` is the picture's share, a percentage. */
export function mediaText(
  media: { src: string; alt: string; video: boolean },
  options: { right: boolean; width: number },
  blocks: string[],
): string {
  const { right, width } = options;
  const picture = media.video
    ? `<video controls src="${escapeAttribute(media.src)}"></video>`
    : `<img src="${escapeAttribute(media.src)}" alt="${escapeAttribute(media.alt)}"/>`;
  const figure = `<figure class="wp-block-media-text__media">${picture}</figure>`;
  const content = `<div class="wp-block-media-text__content">${innerBlocks(blocks)}</div>`;
  const style = width === 50 ? "" : ` style="grid-template-columns:${right ? `auto ${width}%` : `${width}% auto`}"`;
  return wpBlock(
    "media-text",
    {
      ...(right && { mediaPosition: "right" }),
      mediaType: media.video ? "video" : "image",
      ...(width !== 50 && { mediaWidth: width }),
    },
    `<div class="wp-block-media-text${right ? " has-media-on-the-right" : ""} is-stacked-on-mobile"${style}>${right ? `${content}${figure}` : `${figure}${content}`}</div>`,
  );
}

export function gallery(
  images: Array<{ src: string; alt: string; caption: string }>,
  options: { columns: number; crop: boolean; caption: string },
): string {
  const caption = options.caption
    ? `<figcaption class="blocks-gallery-caption wp-element-caption">${escapeText(options.caption)}</figcaption>`
    : "";
  return wpBlock(
    "gallery",
    { columns: options.columns, ...(!options.crop && { imageCrop: false }), linkTo: "none" },
    `<figure class="wp-block-gallery has-nested-images columns-${options.columns}${options.crop ? " is-cropped" : ""}">${innerBlocks(images.map((picture) => image(picture.src, picture.alt, picture.caption)))}${caption}</figure>`,
  );
}

export function pageList(): string {
  return wpBlock("page-list");
}

export function code(text: string): string {
  return wpBlock("code", undefined, `<pre class="wp-block-code"><code>${escapeText(text)}</code></pre>`);
}

/** A YouTube or Vimeo video, which WordPress embeds itself. */
export function embed(url: string, provider: "youtube" | "vimeo", caption = ""): string {
  const figcaption = caption ? `<figcaption class="wp-element-caption">${escapeText(caption)}</figcaption>` : "";
  return wpBlock(
    "embed",
    { url, type: "video", providerNameSlug: provider, responsive: true },
    `<figure class="wp-block-embed is-type-video is-provider-${provider} wp-block-embed-${provider}"><div class="wp-block-embed__wrapper">\n${escapeText(url)}\n</div>${figcaption}</figure>`,
  );
}

export function video(src: string, caption = ""): string {
  const figcaption = caption ? `<figcaption class="wp-element-caption">${escapeText(caption)}</figcaption>` : "";
  return wpBlock(
    "video",
    undefined,
    `<figure class="wp-block-video"><video controls src="${escapeAttribute(src)}"></video>${figcaption}</figure>`,
  );
}

export function latestPosts(count: number): string {
  return wpBlock("latest-posts", { postsToShow: count });
}

type Link = (address: string) => string;

function list(element: ChildNode, link: Link): string {
  const ordered = tagName(element) === "ol";
  const items = (isElement(element) ? element.children : [])
    .filter((child) => tagName(child) === "li")
    .map((item) => {
      const children = isElement(item) ? item.children : [];
      const lists = children.filter((child) => tagName(child) === "ul" || tagName(child) === "ol");
      // The rich text editor puts each item's text in a paragraph, which WordPress's list items don't have.
      const text = children
        .filter((child) => !lists.includes(child))
        .flatMap((child) => (tagName(child) === "p" && isElement(child) ? child.children : [child]));
      return wpBlock(
        "list-item",
        undefined,
        `<li>${inlineRichText(text, link)}${lists.map((nested) => list(nested, link)).join("")}</li>`,
      );
    });
  return wpBlock(
    "list",
    ordered ? { ordered: true } : undefined,
    `<${ordered ? "ol" : "ul"} class="wp-block-list">${innerBlocks(items)}</${ordered ? "ol" : "ul"}>`,
  );
}

function table(element: ChildNode, link: Link): string {
  const rows = (isElement(element) ? childElements(element) : []).flatMap((part) =>
    part.name === "tr"
      ? [{ head: false, row: part }]
      : childElements(part).map((row) => ({ head: part.name === "thead", row })),
  );
  const cells = (row: ChildNode, cell: string) =>
    `<tr>${(isElement(row) ? childElements(row) : []).map((item) => `<${cell}>${inlineRichText(item.children, link)}</${cell}>`).join("")}</tr>`;
  const head = rows.filter((row) => row.head).map((row) => cells(row.row, "th"));
  const body = rows.filter((row) => !row.head).map((row) => cells(row.row, "td"));
  return wpBlock(
    "table",
    undefined,
    `<figure class="wp-block-table"><table>${head.length ? `<thead>${head.join("")}</thead>` : ""}<tbody>${body.join("")}</tbody></table></figure>`,
  );
}

/**
 * HTML, such as rich text or rendered Markdown, as WordPress's blocks:
 * paragraphs, headings, lists, quotes, code, tables, images and separators.
 * `link` gives links' and images' addresses as they'll be on WordPress.
 */
export function htmlBlocks(html: string, link: Link, media: Link = link): string[] {
  const out: string[] = [];
  let loose: ChildNode[] = [];
  const flush = () => {
    const text = inlineRichText(loose, link);
    if (text) out.push(paragraph(text));
    loose = [];
  };
  const imageOf = (node: ChildNode) => {
    const src = isElement(node) ? media(node.attribs.src ?? "") : "";
    return src ? image(src, isElement(node) ? (node.attribs.alt ?? "") : "", "") : undefined;
  };
  for (const node of parseHtml(html).children) {
    const name = tagName(node);
    if (
      !isElement(node) ||
      ["a", "strong", "b", "em", "i", "code", "span", "br", "s", "u", "sup", "sub"].includes(name)
    ) {
      loose.push(node);
      continue;
    }
    flush();
    const children = node.children.filter((child) => !(child.type === "text" && !textOf(child).trim()));
    if (/^h[1-6]$/.test(name)) {
      const text = collapsed(textOf(node));
      if (text) out.push(heading(text, Math.max(2, Number(name.slice(1)))));
    } else if (name === "p") {
      if (children.length > 0 && children.every((child) => tagName(child) === "img")) {
        for (const child of children) {
          const block = imageOf(child);
          if (block) out.push(block);
        }
        continue;
      }
      const text = inlineRichText(node.children, link);
      if (text) out.push(paragraph(text));
      for (const child of node.children.filter((item) => tagName(item) === "img")) {
        const block = imageOf(child);
        if (block) out.push(block);
      }
    } else if (name === "ul" || name === "ol") {
      out.push(list(node, link));
    } else if (name === "blockquote") {
      const paragraphs = node.children.flatMap((child) => {
        const text = inlineRichText(tagName(child) === "p" && isElement(child) ? child.children : [child], link);
        return text ? [paragraph(text)] : [];
      });
      if (paragraphs.length) {
        out.push(
          wpBlock("quote", undefined, `<blockquote class="wp-block-quote">${innerBlocks(paragraphs)}</blockquote>`),
        );
      }
    } else if (name === "pre") {
      out.push(code(textOf(node).replace(/\n$/, "")));
    } else if (name === "table") {
      out.push(table(node, link));
    } else if (name === "img") {
      const block = imageOf(node);
      if (block) out.push(block);
    } else if (name === "hr") {
      out.push(separator());
    } else {
      const text = inlineRichText(node.children, link);
      if (text) out.push(paragraph(text));
    }
  }
  flush();
  return out;
}
