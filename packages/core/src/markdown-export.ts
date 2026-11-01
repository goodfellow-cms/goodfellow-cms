/**
 * Writes a site as a folder of Markdown files, for other static sites (Hugo,
 * Jekyll, Eleventy, Astro), notes apps and AI tools: each page and item a
 * Markdown file with YAML front matter, at its address, beside the media
 * library and the menus, with no disk or network access, so the admin panel and
 * the command line export the same way. It's the Markdown import's opposite
 * (`planMarkdownImport()`), which reads what it writes back.
 *
 * Blocks become Markdown through the WordPress export and import's
 * conversion (`puckBlocks()`, `itemParts()`, `partsMarkdown()`), from the
 * site's content alone, never its code: built-in blocks are written as what
 * they show, blocks of the site's own as what's in their slots, and blocks
 * Markdown can't hold, such as forms and calendars, are left out with a note.
 */
import { stringify as stringifyYaml } from "yaml";
import { type Collection, type Entry, entryTitle } from "./content/collections.js";
import { dateField } from "./content/entry-details.js";
import { mainLanguage, pathLanguage } from "./content/languages.js";
import type { Page, SiteContent } from "./content/load.js";
import { isSafeUrl } from "./content/markdown.js";
import { mediaKind } from "./content/media-files.js";
import { withStoredMedia } from "./content/media-storage.js";
import { linkTarget, pageAddressPath, pageLink } from "./content/page-address.js";
import { MEDIA_DIR } from "./content/paths.js";
import { type Schedule, scheduleState } from "./content/schedule.js";
import type { CollectionField } from "./content/schemas.js";
import { expandSyncedBlocks } from "./content/synced-blocks.js";
import { rewriteMarkdown } from "./markdown-import.js";
import { itemParts, type ConvertContext as ReadContext } from "./wordpress/convert.js";
import { blocksIn, type ConvertContext, type PuckBlock, puckBlocks, withoutTitle } from "./wordpress/export.js";
import { partsMarkdown } from "./wordpress/markdown.js";

export interface MarkdownExportOptions {
  /** The site's media files (`public/media/…`), which the export copies into `media/`. */
  mediaFiles?: readonly string[];
  /** When the export is made, for schedules. */
  now?: Date;
  /** Also export pages and items their schedule doesn't show now, marked `draft: true`. */
  scheduled?: boolean;
  /**
   * How links to the site's own pages and media are written: as the site's
   * addresses (`/about/`), which static site generators serve the files at,
   * or as paths to the exported files (`../about.md`), for notes apps.
   */
  links?: "site" | "files";
}

/** What an export couldn't bring across as it was, for the person exporting to check. */
export type MarkdownExportNote =
  /** A block Markdown can't hold, such as a form or a calendar, left out of the pages and items named. */
  | { kind: "left-out-block"; name: string; items: string[] }
  /** Pages and items their schedule doesn't show now: left out, or with `scheduled`, exported as drafts. */
  | { kind: "scheduled"; items: string[]; included: boolean }
  /** Collections without pages of their own, exported in a folder of their own (`_<id>/`). */
  | { kind: "no-pages"; collections: string[] }
  /** Redirects that don't go to an exported page or item, which front matter can't say. */
  | { kind: "redirects"; count: number }
  /** The header and footer, which Markdown can't hold: only the menus are exported, as `menus.json`. */
  | { kind: "layout" }
  /** Collections' templates, the layout their items' pages share, which aren't exported: items are their fields. */
  | { kind: "templates"; collections: string[] };

export interface MarkdownExportSummary {
  pages: number;
  items: number;
  media: number;
  menus: number;
}

export interface MarkdownExport {
  /** The Markdown files and `menus.json`, by their path in the export. */
  files: Array<{ path: string; content: string }>;
  /** The media to copy: the file in the site (`public/media/…`) and its path in the export (`media/…`). */
  media: Array<{ from: string; path: string }>;
  summary: MarkdownExportSummary;
  notes: MarkdownExportNote[];
}

/** Blocks with nothing like them in Markdown, left out with a note. */
const LEFT_OUT = new Set([
  "Form",
  "Newsletter",
  "Calendar",
  "AddToCalendar",
  "Search",
  "Menu",
  "SiteBrand",
  "DarkModeSwitch",
  "CollectionNav",
  "CollectionList",
  "CollectionLoop",
  "EntryPager",
  "EntryField",
  "OnThisPage",
  "Breadcrumbs",
  "ShareButtons",
  "PageList",
  "LanguageSwitch",
]);

/** Front matter keys the export writes itself, which a field's own name can't take. */
const RESERVED = new Set([
  "title",
  "date",
  "description",
  "permalink",
  "aliases",
  "redirect_from",
  "draft",
  "publishDate",
  "expiryDate",
  "lang",
  "translationKey",
  "noindex",
  "image",
]);

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** A path's folder, `a/b` for `a/b/c.md`. */
function folderOf(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

/** `to` from within `from`'s folder, such as `../about.md`. */
function relativePath(from: string, to: string): string {
  const fromParts = folderOf(from).split("/").filter(Boolean);
  const toParts = to.split("/");
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length - 1 && fromParts[shared] === toParts[shared]) shared++;
  return [...fromParts.slice(shared).map(() => ".."), ...toParts.slice(shared)].join("/") || ".";
}

function frontMatter(front: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(front, { lineWidth: 0 });
  const markdown = body.trim();
  return markdown ? `---\n${yaml}---\n\n${markdown}\n` : `---\n${yaml}---\n`;
}

/** A document to export: a page or an item. */
interface Doc {
  /** Its address, `/` or `/about`, or `undefined` for an item of a collection without pages. */
  path?: string;
  file: string;
  front: Record<string, unknown>;
  body: () => string;
}

/** Writes a site as a folder of Markdown files. */
export function markdownExport(loaded: SiteContent, options: MarkdownExportOptions = {}): MarkdownExport {
  // Media a plugin keeps outside the repository is linked at its storage's address, since it isn't copied.
  const content = withStoredMedia(loaded);
  const now = options.now ?? new Date();
  const { settings } = content;
  const timeZone = settings.timeZone;
  const trailingSlash = settings.trailingSlash !== false;
  const main = mainLanguage(settings);
  const notes: MarkdownExportNote[] = [];
  const leftOut = new Map<string, Set<string>>();
  const scheduled: string[] = [];

  const safe = (address: string) => {
    const value = address.trim();
    return value && isSafeUrl(value) ? value : "";
  };
  const blockContext = (item: string): ConvertContext => ({
    link: safe,
    media: safe,
    describe: (address) => content.descriptions?.[address.trim()]?.text ?? "",
    // Lists of items are left out, so no collection counts as WordPress's posts.
    posts: new Set(),
    content,
    synced: () => undefined,
    note: (block) => leftOut.set(block, (leftOut.get(block) ?? new Set()).add(item)),
  });
  const readContext: ReadContext = {
    link: safe,
    media: safe,
    attachment: () => undefined,
    reusable: () => undefined,
    note: () => {},
  };
  /** Blocks as Markdown, leaving out those Markdown can't hold, by the item they're in. */
  const blocksMarkdown = (blocks: PuckBlock[], item: string): string => {
    const kept = (list: PuckBlock[]): PuckBlock[] =>
      list.flatMap((block) => {
        if (LEFT_OUT.has(block.type)) {
          leftOut.set(block.type, (leftOut.get(block.type) ?? new Set()).add(item));
          return [];
        }
        // What's inside blocks, such as a Section's, is checked the same way.
        const props = Object.fromEntries(
          Object.entries(block.props).map(([key, value]) => {
            const inner = blocksIn(value);
            return [
              key,
              Array.isArray(value) && inner.length === value.length && inner.length > 0 ? kept(inner) : value,
            ];
          }),
        );
        return [{ ...block, props }];
      });
    const html = puckBlocks(kept(blocks), blockContext(item)).join("\n\n");
    return html ? partsMarkdown(itemParts({ content: html, rendered: false }, readContext), safe) : "";
  };
  /** Rich text's HTML as Markdown. */
  const htmlMarkdown = (html: string): string =>
    html.trim() ? partsMarkdown(itemParts({ content: html, rendered: true }, readContext), safe) : "";

  /** Whether to export something by its schedule, and what its front matter says of it. */
  const timing = (schedule: Schedule, title: string): Record<string, unknown> | undefined => {
    const shown = scheduleState(schedule, now, timeZone) === "shown";
    if (!shown) {
      scheduled.push(title);
      if (!options.scheduled) return undefined;
    }
    return {
      ...(!shown && { draft: true }),
      ...(schedule.showFrom && { publishDate: schedule.showFrom }),
      ...(schedule.hideAfter && { expiryDate: schedule.hideAfter }),
    };
  };
  const permalink = (path: string) => pageAddressPath(path, trailingSlash);

  /* Redirects to exported pages and items become their `aliases`; the rest are noted. */
  const addresses = new Set<string>([
    ...content.pages.map((page) => page.path),
    ...content.collections.flatMap((collection) => collection.entries.flatMap((entry) => entry.path ?? [])),
  ]);
  const aliases = new Map<string, string[]>();
  let unsaid = 0;
  for (const redirect of content.redirects ?? []) {
    const target = linkTarget(redirect.to);
    const path = target?.kind === "page" ? target.path.replace(/(.)\/+$/, "$1") : undefined;
    if (path && addresses.has(path) && !/[?#]/.test(redirect.to)) {
      aliases.set(path, [...(aliases.get(path) ?? []), permalink(redirect.from)]);
    } else unsaid++;
  }
  const aliasFront = (path: string) => {
    const list = aliases.get(path);
    // Hugo reads `aliases`, and Jekyll's redirect plugin `redirect_from`.
    return list ? { aliases: list, redirect_from: list } : {};
  };

  /* Which pages and items other languages translate, so both share a `translationKey`. */
  const translatedPages = new Set(content.pages.flatMap((page) => page.content.translationOf ?? []));
  const translatedItems = new Set(
    content.collections.flatMap((collection) =>
      collection.entries.flatMap((entry) =>
        entry.content.translationOf ? `${collection.id}/${entry.content.translationOf}` : [],
      ),
    ),
  );

  /* Pages. */
  const docs: Doc[] = [];
  const pageDoc = (page: Page): Doc | undefined => {
    const props = page.content.data.root.props ?? {};
    const segments = page.path.split("/").filter(Boolean);
    const title = text(props.title).trim() || segments.at(-1) || settings.title;
    const time = timing(page.content, title);
    if (!time) return undefined;
    const language = pathLanguage(settings, page.path);
    const data = expandSyncedBlocks(page.content.data, content, language);
    const blocks = withoutTitle(blocksIn(data.content), title);
    const key = page.content.translationOf ?? (translatedPages.has(page.path) ? page.path : undefined);
    const image = safe(text(props.image));
    return {
      path: page.path,
      file: "",
      front: {
        title,
        ...(text(props.description).trim() && { description: text(props.description).trim() }),
        permalink: permalink(page.path),
        ...aliasFront(page.path),
        ...(language !== main && { lang: language }),
        ...(key && { translationKey: key }),
        ...(props.noIndex === true && { noindex: true }),
        ...(image && { image }),
        ...time,
      },
      body: () => blocksMarkdown(blocks, title),
    };
  };
  let pageCount = 0;
  for (const page of content.pages) {
    if (page.path === "/404" || page.entry || page.view) continue;
    const doc = pageDoc(page);
    if (doc) docs.push(doc);
    if (doc) pageCount++;
  }

  /* Collections' items: their fields as front matter, and their text as the body. */
  const withoutPages: string[] = [];
  const templated: string[] = [];
  const itemDoc = (collection: Collection, entry: Entry): Doc | undefined => {
    const title = entryTitle(entry);
    const time = timing(entry.content, title);
    if (!time) return undefined;
    const { fields, markdown } = collection.settings;
    const values = entry.content.fields;
    const bodyField: CollectionField | undefined = markdown?.body
      ? fields.find((field) => field.name === markdown.body)
      : fields.find((field) => field.type === "richtext" && typeof values[field.name] === "string");
    const dated = dateField(collection);
    const front: Record<string, unknown> = { title };
    if (dated && typeof values[dated.name] === "string") front.date = values[dated.name];
    if (entry.path) {
      front.permalink = permalink(entry.path);
      Object.assign(front, aliasFront(entry.path));
    }
    const language = entry.content.inLanguage;
    if (language && language !== main) front.lang = language;
    const key = entry.content.translationOf
      ? `${collection.id}/${entry.content.translationOf}`
      : translatedItems.has(`${collection.id}/${entry.slug}`)
        ? `${collection.id}/${entry.slug}`
        : undefined;
    if (key) front.translationKey = key;
    for (const field of fields) {
      const value = values[field.name];
      if (value === undefined || field === bodyField || field.name === "title" || field === dated) continue;
      if (RESERVED.has(field.name)) continue;
      front[field.name] =
        field.type === "richtext" && typeof value === "string" && !markdown ? htmlMarkdown(value) : value;
    }
    Object.assign(front, time);
    const body = bodyField ? text(values[bodyField.name]) : "";
    return {
      ...(entry.path && { path: entry.path }),
      file: entry.path ? "" : `_${collection.id}/${entry.slug}.md`,
      front,
      // Markdown items keep their Markdown; rich text becomes Markdown.
      body: () => (markdown ? body : htmlMarkdown(body)),
    };
  };
  for (const collection of content.collections) {
    if (!collection.settings.path && collection.entries.length > 0) withoutPages.push(collection.settings.name);
    if (collection.settings.template?.content.length) templated.push(collection.settings.name);
    for (const entry of collection.entries) {
      const doc = itemDoc(collection, entry);
      if (doc) docs.push(doc);
    }
  }

  /* Files: each page and item at its address, as `<address>.md`, or `<address>/index.md` where others are under it. */
  const paths = docs.flatMap((doc) => doc.path ?? []);
  const hasChildren = (path: string) => path === "/" || paths.some((other) => other.startsWith(`${path}/`));
  const fileByPath = new Map<string, string>();
  for (const doc of docs) {
    if (!doc.path) continue;
    doc.file = hasChildren(doc.path)
      ? `${`${doc.path.slice(1)}/`.replace(/^\//, "")}index.md`
      : `${doc.path.slice(1)}.md`;
    fileByPath.set(doc.path, doc.file);
  }

  /* The media library, copied beside the pages, at the same addresses. */
  const media = (options.mediaFiles ?? []).flatMap((from) =>
    from.startsWith(`${MEDIA_DIR}/`) && mediaKind(from)
      ? [{ from, path: `media/${from.slice(MEDIA_DIR.length + 1)}` }]
      : [],
  );
  const mediaPaths = new Set(media.map((file) => file.path));

  /** Links as the person chose: the site's addresses as they are, or paths to the exported files. */
  const linksFor = (file: string) => (address: string) => {
    // Links to pages end as the site's addresses do, so following one needs no redirect.
    if (options.links !== "files") return pageLink(address, trailingSlash);
    const target = linkTarget(address);
    if (!target) return address;
    const rest = address.slice(address.search(/[?#]|$/));
    if (target.kind === "media") {
      const path = target.path.slice(1);
      return mediaPaths.has(path) ? `${relativePath(file, path)}${rest}` : address;
    }
    const to = fileByPath.get(target.path.replace(/(.)\/+$/, "$1"));
    return to ? `${relativePath(file, to)}${rest}` : address;
  };

  const files = docs.map((doc) => {
    const link = linksFor(doc.file);
    const body = doc.body();
    return {
      path: doc.file,
      content: frontMatter(doc.front, rewriteMarkdown(body, link, link)),
    };
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  /* The menus, as data: Markdown has nowhere to put them. */
  const menuCount = Object.values(content.menus).filter((entries) => entries.length > 0).length;
  if (menuCount > 0 || Object.keys(content.languageMenus ?? {}).length > 0) {
    files.push({
      path: "menus.json",
      content: `${JSON.stringify({ menus: content.menus, ...(content.languageMenus && { languages: content.languageMenus }) }, null, 2)}\n`,
    });
  }

  /* What to tell the person exporting. */
  for (const [name, where] of leftOut) notes.push({ kind: "left-out-block", name, items: [...where] });
  if (scheduled.length > 0) notes.push({ kind: "scheduled", items: scheduled, included: options.scheduled === true });
  if (withoutPages.length > 0) notes.push({ kind: "no-pages", collections: withoutPages });
  if (templated.length > 0) notes.push({ kind: "templates", collections: templated });
  if (unsaid > 0) notes.push({ kind: "redirects", count: unsaid });
  if (content.header.data.content.length > 0 || content.footer.data.content.length > 0) notes.push({ kind: "layout" });

  return {
    files,
    media,
    summary: {
      pages: pageCount,
      items: docs.length - pageCount,
      media: media.length,
      menus: menuCount,
    },
    notes,
  };
}

/** A name for the export: the site's title, then `-markdown`. */
export function markdownExportName(content: Pick<SiteContent, "settings">): string {
  const base = content.settings.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "site"}-markdown`;
}
