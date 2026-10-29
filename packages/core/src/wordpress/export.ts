/**
 * Writes a Goodfellow site as a WordPress export file (WXR), which
 * WordPress's importer (Tools → Import → WordPress) reads: pages with their
 * blocks turned into WordPress's, collections' items as posts, the menus, and
 * the media library, which the importer downloads from the site's address.
 */
import { isEventLike, zonedInstant, zonedTime } from "../calendar.js";
import {
  type Collection,
  choiceSlug,
  choicesOf,
  entryTitle,
  formatFieldValue,
  isChoiceField,
} from "../content/collections.js";
import { dateField } from "../content/entry-details.js";
import type { SiteContent } from "../content/load.js";
import { isSafeUrl, markdownToHtml } from "../content/markdown.js";
import { mediaKind } from "../content/media-files.js";
import { MEDIA_DIR } from "../content/paths.js";
import { type Schedule, scheduleState } from "../content/schedule.js";
import type { CollectionField } from "../content/schemas.js";
import { type EmbedSite, embeddedPost } from "../embeds.js";
import { vimeoVideo, youtubeVideo } from "../video.js";
import {
  audio,
  buttons,
  code,
  columns,
  cover,
  details,
  embed,
  escapeAttribute,
  file,
  gallery,
  group,
  heading,
  htmlBlocks,
  image,
  latestPosts,
  mediaText,
  pageList,
  paragraph,
  preformatted,
  pullquote,
  separator,
  spacer,
  textTable,
  video,
  type WpButton,
  type WpCoverLook,
} from "./gutenberg.js";

export interface WordPressExportOptions {
  /** The site's media files (`public/media/…`), which become WordPress's media library. */
  mediaFiles?: readonly string[];
  /** When the export is made, for pages and posts without a date, and for schedules. */
  now?: Date;
}

/** What an export couldn't bring across as it was, for the person exporting to check. */
export type WordPressExportNote =
  /** A block WordPress has nothing like, such as a form or a calendar, left out of the pages named. */
  | { kind: "left-out-block"; name: string; items: string[] }
  /** Collections without pages of their own, shown only in lists, whose items aren't exported. */
  | { kind: "no-pages"; collections: string[] }
  /** Redirects, which WordPress needs a plugin for. */
  | { kind: "redirects"; count: number }
  /** Pages and items their schedule has hidden again, exported as drafts. */
  | { kind: "hidden"; items: string[] }
  /** The site has no address, so WordPress can't download its media. */
  | { kind: "no-address" }
  /** The header and footer, which WordPress's theme shows instead, with the menus. */
  | { kind: "layout" };

export interface WordPressExportSummary {
  pages: number;
  posts: number;
  media: number;
  menus: number;
  categories: number;
  tags: number;
}

export interface WordPressExport {
  /** The export file. */
  xml: string;
  summary: WordPressExportSummary;
  notes: WordPressExportNote[];
}

/** Blocks with nothing like them in WordPress's own blocks, left out. */
const LEFT_OUT = new Set([
  "Form",
  "Calendar",
  "AddToCalendar",
  "Search",
  "Menu",
  "SiteBrand",
  "DarkModeSwitch",
  "CollectionNav",
  "EntryPager",
  "OnThisPage",
  "EntryField",
  "CollectionLoop",
  "Breadcrumbs",
]);

/** The Space block's sizes, in pixels. */
const SPACES: Record<string, number> = { sm: 16, md: 32, lg: 64, xl: 96 };

/** A Section's overlay strengths, heights and focuses as a cover's `dimRatio`, least height and focal point. */
const DIM_RATIOS: Record<string, number> = { light: 30, medium: 50, strong: 70 };
const MIN_HEIGHTS: Record<string, number> = { small: 256, medium: 384, large: 576, screen: 800 };
const FOCAL_POINTS: Record<string, { x: number; y: number }> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
};

/** The Media and text block's picture widths, as percentages. */
const MEDIA_WIDTHS: Record<string, number> = { third: 33, half: 50, "two-thirds": 67 };

function coverLook(props: Record<string, unknown>): WpCoverLook {
  const overlay = text(props.overlay);
  const minHeight = MIN_HEIGHTS[text(props.minHeight)];
  const focalPoint = FOCAL_POINTS[text(props.focus)];
  return {
    // A Section with no overlay is a cover with none.
    dimRatio: overlay && overlay !== "none" ? (DIM_RATIOS[text(props.overlayStrength)] ?? 50) : 0,
    ...(minHeight && { minHeight }),
    ...(focalPoint && { focalPoint }),
  };
}

interface PuckBlock {
  type: string;
  props: Record<string, unknown>;
}

function isBlock(value: unknown): value is PuckBlock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PuckBlock).type === "string" &&
    typeof (value as PuckBlock).props === "object"
  );
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const blocksIn = (value: unknown) => (Array.isArray(value) ? value.filter(isBlock) : []);

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `2026-06-14T12:00` → `2026-06-14 12:00:00`, as WordPress writes dates. */
function wpDate(local: string): string {
  return `${local.replace("T", " ")}:00`.slice(0, 19);
}

interface ConvertContext {
  link(address: string): string;
  media(address: string): string;
  /** The collections exported as posts, which lists of their items can show. */
  posts: ReadonlySet<string>;
  content: SiteContent;
  note(block: string): void;
}

function videoBlocks(props: Record<string, unknown>, context: ConvertContext): string[] {
  const caption = text(props.caption);
  if (props.source === "youtube") {
    const found = youtubeVideo(text(props.youtube));
    return found ? [embed(`https://www.youtube.com/watch?v=${found.id}`, "youtube", caption)] : [];
  }
  if (props.source === "vimeo") {
    const found = vimeoVideo(text(props.vimeo));
    return found ? [embed(`https://vimeo.com/${found.id}${found.hash ? `/${found.hash}` : ""}`, "vimeo", caption)] : [];
  }
  if (props.source === "upload" || props.source === "file") {
    const src = context.media(text(props.file));
    return src ? [video(src, caption)] : [];
  }
  context.note("Video");
  return [];
}

/** WordPress's names for the sites whose posts it embeds itself; it links the rest. */
const WORDPRESS_PROVIDERS: Partial<Record<EmbedSite, string>> = {
  x: "twitter",
  spotify: "spotify",
  soundcloud: "soundcloud",
};

function socialPostBlocks(props: Record<string, unknown>): string[] {
  const found = embeddedPost(text(props.post));
  const link = "post" in found ? found.post.link : "link" in found ? found.link : undefined;
  if (!link) return [];
  const site = "post" in found ? found.post.site : "bluesky";
  return [embed(link, WORDPRESS_PROVIDERS[site], text(props.caption), "rich")];
}

function contactBlocks(props: Record<string, unknown>, context: ConvertContext): string[] {
  const contact = context.content.settings.contact ?? {};
  const lines: string[] = [];
  if (props.address !== false && contact.address) lines.push(escapeText(contact.address).replace(/\n/g, "<br>"));
  if (props.phone !== false && contact.phone) {
    lines.push(
      `<a href="tel:${escapeAttribute(contact.phone.replace(/(?!^\+)[^\d]/g, ""))}">${escapeText(contact.phone)}</a>`,
    );
  }
  if (props.email !== false && contact.email) {
    lines.push(`<a href="mailto:${escapeAttribute(contact.email)}">${escapeText(contact.email)}</a>`);
  }
  return lines.map(paragraph);
}

/** Puck blocks as WordPress's. */
function puckBlocks(blocks: PuckBlock[], context: ConvertContext): string[] {
  return blocks.flatMap((block): string[] => {
    const { props } = block;
    switch (block.type) {
      case "Section": {
        const inner = puckBlocks(blocksIn(props.content), context);
        const background = context.media(text(props.backgroundImage));
        return background ? [cover(background, inner, coverLook(props))] : inner;
      }
      case "Heading": {
        const shown = text(props.text).trim();
        return shown ? [heading(shown, Number(text(props.level).slice(1)) || 2, text(props.align))] : [];
      }
      case "Text":
        return htmlBlocks(text(props.content), context.link, context.media);
      case "Button":
      case "Flex":
      case "Grid":
        return layoutBlocks(block, context);
      case "Image": {
        const src = context.media(text(props.src));
        return src ? [image(src, props.decorative === true ? "" : text(props.alt), text(props.caption))] : [];
      }
      case "Video":
        return videoBlocks(props, context);
      case "Embed":
        return socialPostBlocks(props);
      case "Space":
        return [spacer(SPACES[text(props.size)] ?? 32)];
      case "Code":
        return [code(text(props.code))];
      case "ContactDetails":
        return contactBlocks(props, context);
      case "Separator": {
        const style = text(props.style);
        return [separator(style === "wide" || style === "dots" ? style : "default")];
      }
      case "Pullquote": {
        const quote = text(props.quote).trim();
        return quote ? [pullquote(quote, text(props.citation).trim())] : [];
      }
      case "Preformatted":
      case "Verse": {
        const shown = text(props.text);
        return shown.trim() ? [preformatted(shown, block.type === "Verse")] : [];
      }
      case "Details":
        return [details(text(props.summary), props.open === true, puckBlocks(blocksIn(props.content), context))];
      case "Table": {
        const cells = Array.isArray(props.cells)
          ? props.cells.map((row) => (Array.isArray(row) ? row.map(text) : []))
          : [];
        return cells.length
          ? [
              textTable(cells, {
                header: props.header === true,
                footer: props.footer === true,
                caption: text(props.caption),
                striped: props.striped === true,
              }),
            ]
          : [];
      }
      case "File": {
        const href = context.link(text(props.file));
        if (!href) return [];
        const label = text(props.label).trim() || decodeURIComponent(href.slice(href.lastIndexOf("/") + 1));
        return [file(href, label, props.button === false ? undefined : text(props.buttonLabel) || "Download")];
      }
      case "Audio": {
        const src = context.media(text(props.src));
        return src ? [audio(src, text(props.caption), props.loop === true)] : [];
      }
      case "MediaText": {
        const inner = puckBlocks(blocksIn(props.content), context);
        const src = context.media(text(props.media));
        if (!src) return inner;
        return [
          mediaText(
            { src, alt: text(props.alt), video: mediaKind(src) === "video" },
            { right: props.position === "right", width: MEDIA_WIDTHS[text(props.width)] ?? 50 },
            inner,
          ),
        ];
      }
      case "Gallery": {
        const images = (Array.isArray(props.images) ? props.images : []).flatMap((item) => {
          const picture = item as Record<string, unknown>;
          const src = context.media(text(picture?.src));
          return src ? [{ src, alt: text(picture.alt), caption: text(picture.caption) }] : [];
        });
        return images.length
          ? [
              gallery(images, {
                columns: Number(text(props.columns)) || 3,
                crop: props.crop !== false,
                caption: text(props.caption),
              }),
            ]
          : [];
      }
      case "PageList":
        return [pageList()];
      case "CollectionList": {
        if (!context.posts.has(text(props.collection))) {
          context.note(block.type);
          return [];
        }
        const title = text(props.heading).trim();
        const limit = typeof props.limit === "number" && props.limit > 0 ? props.limit : 10;
        return [...(title ? [heading(title, 2)] : []), latestPosts(limit)];
      }
      default: {
        if (LEFT_OUT.has(block.type)) {
          context.note(block.type);
          return [];
        }
        // A block of the site's own: what's in its slots, if it has any.
        const slots = Object.values(props).flatMap(blocksIn);
        if (slots.length === 0) context.note(block.type);
        return puckBlocks(slots, context);
      }
    }
  });
}

function buttonOf(props: Record<string, unknown>, context: ConvertContext): WpButton | undefined {
  const label = text(props.label).trim();
  const href = context.link(text(props.href));
  return label && href
    ? { label, href, outline: props.variant === "outline", newTab: props.newTab === true }
    : undefined;
}

/** Buttons, rows and columns. */
function layoutBlocks(block: PuckBlock, context: ConvertContext): string[] {
  const { props } = block;
  if (block.type === "Button") {
    const button = buttonOf(props, context);
    return button ? [buttons([button])] : [];
  }
  const items = blocksIn(props.items);
  if (block.type === "Grid") {
    const list = items.map((item) => puckBlocks([item], context)).filter((column) => column.length > 0);
    return list.length > 1 ? [columns(list)] : (list[0] ?? []);
  }
  if (items.length > 0 && items.every((item) => item.type === "Button")) {
    const list = items.flatMap((item) => buttonOf(item.props, context) ?? []);
    return list.length ? [buttons(list)] : [];
  }
  const inner = puckBlocks(items, context);
  return inner.length ? [group(inner, props.direction !== "column")] : [];
}

/**
 * A page's blocks without its heading for its own title, which WordPress shows
 * as the page's heading itself: the first block, or a first Section's first.
 */
function withoutTitle(blocks: PuckBlock[], title: string): PuckBlock[] {
  const isTitle = (block: PuckBlock | undefined) =>
    block?.type === "Heading" && text(block.props.text).trim() === title;
  const [first, ...rest] = blocks;
  if (isTitle(first)) return rest;
  if (first?.type === "Section" && isTitle(blocksIn(first.props.content)[0])) {
    return [{ ...first, props: { ...first.props, content: blocksIn(first.props.content).slice(1) } }, ...rest];
  }
  return blocks;
}

/** The field a collection's items' summaries come from, as `entryDetails()` finds it. */
function summaryField(collection: Collection): CollectionField | undefined {
  const { fields, calendar } = collection.settings;
  return (
    fields.find((field) => field.name === calendar?.summary) ??
    fields.find((field) => field.type === "textarea" && field.name !== calendar?.place)
  );
}

interface Item {
  id: number;
  type: "page" | "post";
  title: string;
  slug: string;
  path: string;
  parent: number;
  order: number;
  /** Its date in the site's time zone, `YYYY-MM-DDTHH:MM`. */
  date: string;
  status: "publish" | "future" | "draft";
  content: string;
  excerpt: string;
  image?: number;
  terms: Array<{ domain: "category" | "post_tag"; slug: string; name: string }>;
}

/** Writes a Goodfellow site as a WordPress export file. */
export function wordPressExport(content: SiteContent, options: WordPressExportOptions = {}): WordPressExport {
  const now = options.now ?? new Date();
  const { settings } = content;
  const timeZone = settings.timeZone;
  const siteUrl = (settings.url ?? "").replace(/\/+$/, "");
  const notes: WordPressExportNote[] = [];
  let nextId = 1;
  const newId = () => nextId++;

  /* The media library. */
  const attachments = new Map<string, { id: number; url: string; name: string }>();
  for (const path of options.mediaFiles ?? []) {
    if (!path.startsWith(`${MEDIA_DIR}/`) || !mediaKind(path)) continue;
    const address = `/media/${path.slice(MEDIA_DIR.length + 1)}`;
    attachments.set(address, { id: newId(), url: `${siteUrl}${address}`, name: path.slice(path.lastIndexOf("/") + 1) });
  }
  const absolute = (address: string) =>
    siteUrl && address.startsWith("/") && !address.startsWith("//") ? `${siteUrl}${address}` : address;
  const media = (address: string) => {
    const value = address.trim();
    return value && isSafeUrl(value) ? absolute(value) : "";
  };
  const link = (address: string) => {
    const value = address.trim();
    if (!value || !isSafeUrl(value)) return "";
    return value.startsWith("/media/") ? absolute(value) : value;
  };

  const leftOut = new Map<string, Set<string>>();
  const hidden: string[] = [];
  const exported = new Set(
    content.collections.filter((collection) => collection.settings.path).map((collection) => collection.id),
  );
  const context = (item: string): ConvertContext => ({
    link,
    media,
    posts: exported,
    content,
    note: (block) => leftOut.set(block, (leftOut.get(block) ?? new Set()).add(item)),
  });
  const timing = (schedule: Schedule, fallback: string, title: string) => {
    const state = scheduleState(schedule, now, timeZone);
    if (state === "hidden") hidden.push(title);
    const status: Item["status"] = state === "waiting" ? "future" : state === "hidden" ? "draft" : "publish";
    return { status, date: state === "waiting" && schedule.showFrom ? schedule.showFrom : fallback };
  };
  const today = zonedTime(now, timeZone);

  /* Pages, parents first, so each page's parent is already numbered. */
  const items: Item[] = [];
  const pageIds = new Map<string, number>();
  const pages = content.pages
    .filter((page) => page.path !== "/404")
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  for (const [order, page] of pages.entries()) {
    const props = page.content.data.root.props ?? {};
    const segments = page.path.split("/").filter(Boolean);
    const title = text(props.title).trim() || segments.at(-1) || settings.title;
    const blocks = withoutTitle(blocksIn(page.content.data.content), title);
    const id = newId();
    pageIds.set(page.path, id);
    const image = attachments.get(text(props.image))?.id;
    items.push({
      id,
      type: "page",
      title,
      slug: segments.at(-1) ?? "home",
      path: page.path,
      // Top-level pages have no parent: the home page isn't one.
      parent: segments.length > 1 ? (pageIds.get(`/${segments.slice(0, -1).join("/")}`) ?? 0) : 0,
      order,
      ...timing(page.content, today, title),
      content: puckBlocks(blocks, context(title)).join("\n\n"),
      excerpt: text(props.description),
      ...(image && { image }),
      terms: [],
    });
  }

  /* Collections' items, as posts, each in its collection's category, with its choices as tags. */
  const categories = new Map<string, string>();
  const tags = new Map<string, string>();
  const withoutPages: string[] = [];
  for (const collection of content.collections) {
    if (!collection.settings.path) {
      if (collection.entries.length > 0) withoutPages.push(collection.settings.name);
      continue;
    }
    categories.set(collection.id, collection.settings.name);
    const { fields, markdown } = collection.settings;
    const dated = dateField(collection);
    const summary = summaryField(collection);
    const featured = fields.find((field) => field.type === "image");
    const when = collection.settings.calendar?.when;
    for (const entry of collection.entries) {
      const values = entry.content.fields;
      const title = entryTitle(entry);
      const blocks: string[] = [];
      for (const field of fields) {
        const value = values[field.name];
        if (value === undefined || value === "" || field.name === "title" || field === summary || field === dated)
          continue;
        if (field === featured || isChoiceField(field)) continue;
        if (field.type === "richtext" && typeof value === "string") {
          const html = markdown?.body === field.name ? markdownToHtml(value) : value;
          blocks.push(...htmlBlocks(html, link, media));
        } else if (field.type === "image" && typeof value === "string") {
          const src = media(value);
          if (src) blocks.push(image(src, "", ""));
        } else if (field.type === "link" && typeof value === "string") {
          const href = link(value);
          if (href)
            blocks.push(
              paragraph(
                `<strong>${escapeText(field.label)}:</strong> <a href="${escapeAttribute(href)}">${escapeText(value)}</a>`,
              ),
            );
        } else {
          const shown = formatFieldValue(field, value, settings.language, timeZone);
          if (shown) blocks.push(paragraph(`<strong>${escapeText(field.label)}:</strong> ${escapeText(shown)}`));
        }
      }
      const happens = when ? values[when] : undefined;
      const event = isEventLike(happens)
        ? happens.start.length === 10
          ? `${happens.start}T00:00`
          : happens.start
        : undefined;
      const date = dated && typeof values[dated.name] === "string" ? `${values[dated.name]}T00:00` : (event ?? today);
      const choices = fields.filter(isChoiceField).flatMap((field) =>
        choicesOf(field, values[field.name]).map((value) => {
          const slug = choiceSlug(value) ?? value;
          const name = field.options?.find((option) => option.value === value)?.label ?? value;
          tags.set(slug, name);
          return { domain: "post_tag" as const, slug, name };
        }),
      );
      const imageValue = featured ? text(values[featured.name]) : "";
      const imageId = attachments.get(imageValue)?.id;
      items.push({
        id: newId(),
        type: "post",
        title,
        slug: entry.slug,
        path: entry.path ?? "",
        parent: 0,
        order: 0,
        ...timing(entry.content, date.length === 10 ? `${date}T00:00` : date, title),
        content: [
          // A featured image that isn't in the media library is shown in the post instead.
          ...(imageValue && !imageId && media(imageValue) ? [image(media(imageValue), "", "")] : []),
          ...blocks,
        ].join("\n\n"),
        excerpt: summary ? text(values[summary.name]) : "",
        ...(imageId && { image: imageId }),
        terms: [{ domain: "category", slug: collection.id, name: collection.settings.name }, ...choices],
      });
    }
  }

  /* Menus, linking to the pages and posts they go to. */
  const itemIds = new Map(items.map((item) => [item.path, item]));
  const menuItems: string[] = [];
  const menuTerms: Array<{ slug: string; name: string }> = [];
  for (const [menu, entries] of Object.entries(content.menus)) {
    if (entries.length === 0) continue;
    const name = menu.charAt(0).toUpperCase() + menu.slice(1).replace(/-/g, " ");
    menuTerms.push({ slug: menu, name });
    let order = 0;
    const add = (label: string, href: string, parent: number) => {
      const id = newId();
      order += 1;
      const target = itemIds.get(href.replace(/\/+$/, "") || "/");
      const meta = target
        ? { type: "post_type", object: target.type, objectId: String(target.id), url: "" }
        : { type: "custom", object: "custom", objectId: String(id), url: link(href) };
      menuItems.push(`<item>
<title>${cdata(label)}</title>
<wp:post_id>${id}</wp:post_id>
<wp:post_date>${cdata(wpDate(today))}</wp:post_date>
<wp:post_name>${cdata(`menu-item-${id}`)}</wp:post_name>
<wp:status>${cdata("publish")}</wp:status>
<wp:post_parent>0</wp:post_parent>
<wp:menu_order>${order}</wp:menu_order>
<wp:post_type>${cdata("nav_menu_item")}</wp:post_type>
<category domain="nav_menu" nicename="${escapeAttribute(menu)}">${cdata(name)}</category>
${postmeta("_menu_item_type", meta.type)}
${postmeta("_menu_item_menu_item_parent", String(parent))}
${postmeta("_menu_item_object_id", meta.objectId)}
${postmeta("_menu_item_object", meta.object)}
${postmeta("_menu_item_target", "")}
${postmeta("_menu_item_classes", 'a:1:{i:0;s:0:"";}')}
${postmeta("_menu_item_xfn", "")}
${postmeta("_menu_item_url", meta.url)}
</item>`);
      return id;
    };
    for (const entry of entries) {
      const parent = add(entry.label, entry.href, 0);
      for (const child of entry.children ?? []) add(child.label, child.href, parent);
    }
  }

  /* What to tell the person exporting. */
  for (const [name, where] of leftOut) notes.push({ kind: "left-out-block", name, items: [...where] });
  if (withoutPages.length > 0) notes.push({ kind: "no-pages", collections: withoutPages });
  if (hidden.length > 0) notes.push({ kind: "hidden", items: hidden });
  if ((content.redirects?.length ?? 0) > 0) notes.push({ kind: "redirects", count: content.redirects?.length ?? 0 });
  if (!siteUrl && attachments.size > 0) notes.push({ kind: "no-address" });
  if (content.header.data.content.length > 0 || content.footer.data.content.length > 0) notes.push({ kind: "layout" });

  const instant = (local: string) => zonedInstant(local, timeZone);
  const gmt = (local: string) => instant(local).toISOString().slice(0, 19).replace("T", " ");
  const itemXml = (item: Item) => `<item>
<title>${cdata(item.title)}</title>
<link>${escapeText(`${siteUrl}${item.path}`)}</link>
<pubDate>${instant(item.date).toUTCString()}</pubDate>
<dc:creator>${cdata("")}</dc:creator>
<guid isPermaLink="false">${escapeText(`${siteUrl}/?p=${item.id}`)}</guid>
<description></description>
<content:encoded>${cdata(item.content)}</content:encoded>
<excerpt:encoded>${cdata(item.excerpt)}</excerpt:encoded>
<wp:post_id>${item.id}</wp:post_id>
<wp:post_date>${cdata(wpDate(item.date))}</wp:post_date>
<wp:post_date_gmt>${cdata(gmt(item.date))}</wp:post_date_gmt>
<wp:comment_status>${cdata("closed")}</wp:comment_status>
<wp:ping_status>${cdata("closed")}</wp:ping_status>
<wp:post_name>${cdata(item.slug)}</wp:post_name>
<wp:status>${cdata(item.status)}</wp:status>
<wp:post_parent>${item.parent}</wp:post_parent>
<wp:menu_order>${item.order}</wp:menu_order>
<wp:post_type>${cdata(item.type)}</wp:post_type>
<wp:post_password>${cdata("")}</wp:post_password>
<wp:is_sticky>0</wp:is_sticky>
${item.terms.map((term) => `<category domain="${term.domain}" nicename="${escapeAttribute(term.slug)}">${cdata(term.name)}</category>`).join("\n")}
${item.image ? postmeta("_thumbnail_id", String(item.image)) : ""}
</item>`;
  const attachmentXml = [...attachments.values()].map(
    (file) => `<item>
<title>${cdata(file.name.replace(/\.[^.]+$/, ""))}</title>
<link>${escapeText(file.url)}</link>
<guid isPermaLink="false">${escapeText(file.url)}</guid>
<wp:post_id>${file.id}</wp:post_id>
<wp:post_date>${cdata(wpDate(today))}</wp:post_date>
<wp:post_name>${cdata(file.name.replace(/\.[^.]+$/, ""))}</wp:post_name>
<wp:status>${cdata("inherit")}</wp:status>
<wp:post_parent>0</wp:post_parent>
<wp:post_type>${cdata("attachment")}</wp:post_type>
<wp:attachment_url>${cdata(file.url)}</wp:attachment_url>
</item>`,
  );

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<!-- A WordPress export file, written by Goodfellow. Import it in WordPress with Tools → Import → WordPress. -->
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
<title>${escapeText(settings.title)}</title>
<link>${escapeText(siteUrl)}</link>
<description>${escapeText(settings.description)}</description>
<pubDate>${now.toUTCString()}</pubDate>
<language>${escapeText(settings.language)}</language>
<wp:wxr_version>1.2</wp:wxr_version>
<wp:base_site_url>${escapeText(siteUrl)}</wp:base_site_url>
<wp:base_blog_url>${escapeText(siteUrl)}</wp:base_blog_url>
${[...categories].map(([slug, name], index) => `<wp:category><wp:term_id>${index + 1}</wp:term_id><wp:category_nicename>${cdata(slug)}</wp:category_nicename><wp:category_parent>${cdata("")}</wp:category_parent><wp:cat_name>${cdata(name)}</wp:cat_name></wp:category>`).join("\n")}
${[...tags].map(([slug, name], index) => `<wp:tag><wp:term_id>${categories.size + index + 1}</wp:term_id><wp:tag_slug>${cdata(slug)}</wp:tag_slug><wp:tag_name>${cdata(name)}</wp:tag_name></wp:tag>`).join("\n")}
${menuTerms.map((term, index) => `<wp:term><wp:term_id>${categories.size + tags.size + index + 1}</wp:term_id><wp:term_taxonomy>${cdata("nav_menu")}</wp:term_taxonomy><wp:term_slug>${cdata(term.slug)}</wp:term_slug><wp:term_name>${cdata(term.name)}</wp:term_name></wp:term>`).join("\n")}
${[...attachmentXml, ...items.map(itemXml), ...menuItems].join("\n")}
</channel>
</rss>
`;

  return {
    xml,
    summary: {
      pages: items.filter((item) => item.type === "page").length,
      posts: items.filter((item) => item.type === "post").length,
      media: attachments.size,
      menus: menuTerms.length,
      categories: categories.size,
      tags: tags.size,
    },
    notes,
  };
}

function postmeta(key: string, value: string): string {
  return `<wp:postmeta><wp:meta_key>${cdata(key)}</wp:meta_key><wp:meta_value>${cdata(value)}</wp:meta_value></wp:postmeta>`;
}

/** A file name for the export: the site's title, then `.wordpress.xml`. */
export function wordPressExportName(content: Pick<SiteContent, "settings">): string {
  const base = content.settings.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "site"}.wordpress.xml`;
}
