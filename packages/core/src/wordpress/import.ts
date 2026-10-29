/**
 * Plans bringing a WordPress site into a Goodfellow site: the files to write
 * and the media to copy, with no disk or network access, so the admin panel
 * and the command line import the same way.
 *
 * - **Pages** keep their addresses, as Puck pages of built-in blocks.
 * - **Posts** become a collection of Markdown items, with their categories and
 *   tags as tags fields, at their old addresses where a collection's address
 *   pattern can say them (`/%postname%/`, `/blog/%postname%/`), and otherwise
 *   at `/news/{slug}`, with redirects from the old ones. A page lists them, with
 *   a page for each category, where WordPress's category archives redirect.
 * - **Menus** become the site's menus: the main one, the footer's, and others.
 * - **Media** that pages and posts use is copied into the media library; links
 *   to the old site's pages that weren't imported stay as they were.
 */

import type { Data } from "@puckeditor/core";
import {
  collectionFileChange,
  entryFileChange,
  menusFileChange,
  pageFileChange,
  redirectsFileChange,
  siteSettingsFileChange,
  slugify,
  uniqueName,
} from "../content/changes.js";
import { type Collection, choiceSlug } from "../content/collections.js";
import { SUMMARY_LENGTH } from "../content/entry-details.js";
import { allPages, type SiteContent } from "../content/load.js";
import { isSafeUrl } from "../content/markdown.js";
import { mediaKind, uploadName } from "../content/media-files.js";
import { entryAddress, isAddressSegment, isReservedPagePath, MEDIA_DIR, SLUG_PLACEHOLDER } from "../content/paths.js";
import { isReservedRedirect, type Redirect, redirectFrom } from "../content/redirects.js";
import type { CollectionField, CollectionFile, MenuItem, Menus } from "../content/schemas.js";
import type { FileChange } from "../content/store.js";
import { type ConversionNote, type ConvertContext, itemParts, type Part } from "./convert.js";
import { collapsed, plainText, tagName, textOf } from "./html.js";
import { partsMarkdown } from "./markdown.js";
import type { WordPressItem, WordPressMedia, WordPressMenu, WordPressSite, WordPressTerm } from "./model.js";
import { type BlockData, BlockWriter, IMPORT_BLOCKS, pageBlocks } from "./page-blocks.js";

/** Words the import writes into content: the posts collection's names, its fields' labels and the link back to all posts. */
export interface WordPressImportNames {
  posts: string;
  post: string;
  title: string;
  date: string;
  summary: string;
  image: string;
  categories: string;
  tags: string;
  text: string;
  allPosts: string;
}

export const DEFAULT_IMPORT_NAMES: WordPressImportNames = {
  posts: "Posts",
  post: "Post",
  title: "Title",
  date: "Date",
  summary: "Summary",
  image: "Image",
  categories: "Categories",
  tags: "Tags",
  text: "Text",
  allPosts: "All posts",
};

export interface WordPressImportOptions {
  /** The site's media files now (`public/media/…`), so copies get names of their own. */
  mediaFiles?: readonly string[];
  /**
   * The media that was copied, by `WordPressMediaCopy.url`, after an earlier
   * plan's `media` was downloaded. Content links to the rest where they are on
   * the WordPress site. Leave it out to plan as if every file will be copied.
   */
  copied?: ReadonlySet<string>;
  /** The site's blocks. Imported pages need the built-in ones (`IMPORT_BLOCKS`, and Entry field for posts). */
  blocks?: readonly string[];
  names?: Partial<WordPressImportNames>;
}

/** A media file to copy from the WordPress site. */
export interface WordPressMediaCopy {
  /** Where it is on the WordPress site. */
  url: string;
  /** Where it goes, such as `public/media/photo.jpg`. */
  path: string;
}

export interface WordPressImportSummary {
  /** The imported pages' addresses. */
  pages: string[];
  posts: number;
  /** The posts collection, and its items' address pattern. */
  collection?: { id: string; path: string };
  /** The page listing the posts. */
  listPath?: string;
  categories: number;
  tags: number;
  /** The menus written, by id. */
  menus: string[];
  redirects: number;
  /** The site's pages the import replaces, at the same addresses. */
  replaced: string[];
}

/** What the import couldn't bring across as it was, for the person importing to check. */
export type WordPressImportNote =
  /** Content that's never imported: `drafts` (and pending), `private`, `trash`, `comments`, or other kinds of content by name. */
  | { kind: "left-out"; what: string; count: number }
  /** Something converted with a loss, in the pages and posts named. */
  | { kind: "converted"; note: ConversionNote; name: string; items: string[] }
  /** Links to the old site's pages that weren't imported, which still go there. */
  | { kind: "old-links"; urls: string[] }
  /** Media that wasn't copied, which pages still show from the old site. */
  | { kind: "not-copied"; urls: string[] }
  /** Files in the media library that nothing imported uses, which aren't copied. */
  | { kind: "unused-media"; count: number }
  /** The source had no menus, so the main menu lists the top-level pages. */
  | { kind: "no-menus" };

export interface WordPressImport {
  /** The files to write, apart from media. */
  changes: FileChange[];
  /** The media to copy, each to its `path`. */
  media: WordPressMediaCopy[];
  summary: WordPressImportSummary;
  notes: WordPressImportNote[];
}

export class WordPressImportError extends Error {
  override name = "WordPressImportError";

  constructor(
    /** The blocks the site needs and doesn't have. */
    readonly missingBlocks: string[],
  ) {
    super(`Importing needs these blocks, which the site doesn't have: ${missingBlocks.join(", ")}.`);
  }
}

/** Statuses of items that are imported. `future` items are scheduled. */
const SHOWN = new Set(["publish", "future"]);
const LEFT_OUT_STATUS: Record<string, string> = {
  draft: "drafts",
  pending: "drafts",
  private: "private",
  trash: "trash",
};
/** Names for the page listing posts, where WordPress's own isn't known. */
const LIST_NAMES = ["news", "posts", "blog", "articles"];
/** The most words in a summary made from a post's text, as WordPress's own excerpts have. */
const SUMMARY_WORDS = 55;

interface SiteAddress {
  url: URL;
  /** The host without `www.`. */
  host: string;
  /** The path WordPress is at, such as `/blog`, or `""`. */
  path: string;
}

function siteAddress(url: string): SiteAddress {
  const parsed = new URL(url.endsWith("/") ? url : `${url}/`);
  return { url: parsed, host: parsed.hostname.replace(/^www\./, ""), path: parsed.pathname.replace(/\/+$/, "") };
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** A path without its trailing slash, `/` for the home page. */
function pathKey(path: string): string {
  const trimmed = decoded(path).replace(/\/+$/, "");
  return trimmed || "/";
}

/** An address's part that's on the WordPress site, under where WordPress is, or `undefined` for one elsewhere. */
function sitePath(site: SiteAddress, url: URL): string | undefined {
  if (url.hostname.replace(/^www\./, "") !== site.host) return undefined;
  const path = url.pathname;
  if (site.path && path !== site.path && !path.startsWith(`${site.path}/`)) return undefined;
  return pathKey(path.slice(site.path.length) || "/");
}

/** Jetpack's image service gives addresses of the site's uploads on its own host: `i0.wp.com/example.org/wp-content/…`. */
function withoutImageService(url: URL): URL {
  if (!/^i\d\.wp\.com$/.test(url.hostname)) return url;
  const [, host, ...rest] = url.pathname.split("/");
  try {
    return new URL(`${url.protocol}//${host}/${rest.join("/")}`);
  } catch {
    return url;
  }
}

/** The same file whatever size WordPress made of it: `photo-1024x768.jpg` and `photo-scaled.jpg` are `photo.jpg`. */
function mediaKey(url: URL): string {
  return decoded(url.pathname)
    .toLowerCase()
    .replace(/-\d+x\d+(?=\.[a-z0-9]+$)/, "")
    .replace(/-scaled(?=\.[a-z0-9]+$)/, "");
}

/** A part of an address for text, such as a WordPress slug: kept where it can be one, made into one otherwise. */
function segment(text: string, fallback: string): string {
  const slug = decoded(text);
  return isAddressSegment(slug) ? slug : slugify(slug) || fallback;
}

/** Text for a summary: up to WordPress's 55 words. */
function shortSummary(text: string): string {
  const words = text.split(" ").filter(Boolean);
  const short = words.slice(0, SUMMARY_WORDS).join(" ");
  const ended = words.length > SUMMARY_WORDS ? `${short}…` : short;
  return ended.length > SUMMARY_LENGTH ? `${ended.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…` : ended;
}

/** A summary written as HTML, such as a WordPress excerpt. */
function summaryOf(html: string): string {
  return shortSummary(plainText(html.replace(/<!--[\s\S]*?-->/g, " ")));
}

/** A summary from a post's first paragraphs, where it has none of its own. */
function partsSummary(parts: Part[]): string {
  const paragraphs: string[] = [];
  walkParts(parts, (part) => {
    if (part.kind !== "text") return;
    for (const node of part.nodes) if (tagName(node) === "p") paragraphs.push(collapsed(textOf(node)));
  });
  return shortSummary(paragraphs.filter(Boolean).join(" "));
}

/** A post's site, as notes name it, as the conversion's own notes do. */
function hostName(address: string): string {
  try {
    return new URL(address).hostname.replace(/^www\./, "");
  } catch {
    return address;
  }
}

function walkParts(parts: Part[], visit: (part: Part) => void): void {
  for (const part of parts) {
    visit(part);
    if (part.kind === "columns") for (const column of part.columns) walkParts(column, visit);
    if (part.kind === "cover" || part.kind === "details" || part.kind === "media-text") walkParts(part.parts, visit);
  }
}

/** A page's Puck data, with its settings and blocks. */
function pageData(props: Record<string, unknown>, content: BlockData[]): Data {
  return { root: { props }, content } as Data;
}

class Notes {
  private converted = new Map<string, { note: ConversionNote; name: string; items: Set<string> }>();
  readonly list: WordPressImportNote[] = [];

  convert(note: ConversionNote, name: string, item: string): void {
    const key = `${note}:${name}`;
    const found = this.converted.get(key) ?? { note, name, items: new Set<string>() };
    found.items.add(item);
    this.converted.set(key, found);
  }

  all(): WordPressImportNote[] {
    return [
      ...this.list,
      ...[...this.converted.values()].map(
        ({ note, name, items }): WordPressImportNote => ({ kind: "converted", note, name, items: [...items] }),
      ),
    ];
  }
}

/** Plans importing a WordPress site into `content`. Throws `WordPressImportError` if the site lacks the blocks it needs. */
export function planWordPressImport(
  source: WordPressSite,
  content: SiteContent,
  options: WordPressImportOptions = {},
): WordPressImport {
  const names = { ...DEFAULT_IMPORT_NAMES, ...options.names };
  if (options.blocks) {
    const missing = [...IMPORT_BLOCKS, "EntryField"].filter((block) => !options.blocks?.includes(block));
    if (missing.length > 0) throw new WordPressImportError(missing);
  }
  const site = siteAddress(source.url);
  const notes = new Notes();
  const changes: FileChange[] = [];

  /* What's imported, and what's left out. */
  const shown = source.items.filter((item) => SHOWN.has(item.status));
  const leftOut = new Map<string, number>();
  for (const item of source.items) {
    const what = LEFT_OUT_STATUS[item.status];
    if (what) leftOut.set(what, (leftOut.get(what) ?? 0) + 1);
  }
  for (const [what, count] of Object.entries(source.other)) leftOut.set(what, (leftOut.get(what) ?? 0) + count);
  for (const [what, count] of leftOut) notes.list.push({ kind: "left-out", what, count });

  const byId = new Map(source.items.map((item) => [item.id, item]));
  const pages = shown.filter((item) => item.type === "page");
  const posts = shown.filter((item) => item.type === "post");

  const linkPath = (item: WordPressItem): string | undefined => {
    try {
      const url = new URL(item.link);
      return url.search ? undefined : sitePath(site, url);
    } catch {
      return undefined;
    }
  };

  /* Pages' addresses: their old ones, made into ones Goodfellow can use. */
  const pagePaths = new Map<number, string>();
  const takenPagePaths = new Set<string>();
  const chain = (item: WordPressItem, seen = new Set<number>()): string[] => {
    const parent = byId.get(item.parent);
    const own = segment(item.slug || item.title, `page-${item.id}`);
    return parent && parent.type === "page" && !seen.has(parent.id)
      ? [...chain(parent, new Set([...seen, item.id])), own]
      : [own];
  };
  for (const page of pages) {
    const old = linkPath(page);
    const segments =
      old === "/"
        ? []
        : old
          ? old
              .split("/")
              .filter(Boolean)
              .map((part, index) => segment(part, `page-${page.id}-${index}`))
          : chain(page);
    let path = `/${segments.join("/")}`;
    if (isReservedPagePath(path))
      path = `/${segments.map((part, index) => (index === 0 ? `${part}-page` : part)).join("/")}`;
    if (takenPagePaths.has(path)) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const siblings = [...takenPagePaths]
        .filter((taken) => taken.slice(0, taken.lastIndexOf("/")) === parent)
        .map((taken) => taken.slice(taken.lastIndexOf("/") + 1));
      path = `${parent}/${uniqueName(path.slice(path.lastIndexOf("/") + 1), siblings)}`;
    }
    pagePaths.set(page.id, path);
    takenPagePaths.add(path);
  }
  const importedPagePaths = new Set(pagePaths.values());
  const keptPages = content.pages.filter((page) => !importedPagePaths.has(page.path));

  /* Posts: a collection, its items' names and their addresses. */
  const existingPosts = content.collections.find((collection) => collection.id === "posts");
  const collectionId =
    posts.length === 0
      ? undefined
      : !existingPosts || existingPosts.settings.markdown?.body === "body"
        ? "posts"
        : uniqueName(
            "posts",
            content.collections.map((collection) => collection.id),
          );
  const otherCollections = content.collections.filter((collection) => collection.id !== collectionId);
  const postSlugs = new Map<number, string>();
  for (const post of posts) {
    const slug = uniqueName(segment(post.slug || post.title, `post-${post.id}`), postSlugs.values(), `post-${post.id}`);
    postSlugs.set(post.id, slug);
  }

  const otherAddresses = new Set([
    ...keptPages.map((page) => page.path),
    ...importedPagePaths,
    ...otherCollections.flatMap((collection) =>
      collection.entries.flatMap((entry) => (entry.path ? [entry.path] : [])),
    ),
  ]);
  const fits = (pattern: string) =>
    posts.every((post) => {
      const path = entryAddress(pattern, postSlugs.get(post.id) ?? "");
      return !otherAddresses.has(path) && !isReservedPagePath(path);
    });
  const oldPattern = (): string | undefined => {
    let prefix: string | undefined;
    for (const post of posts) {
      const old = linkPath(post);
      if (!old) return undefined;
      const at = old.lastIndexOf("/");
      const own = old.slice(at + 1);
      if (own !== decoded(post.slug)) return undefined;
      const start = old.slice(0, at);
      if (prefix !== undefined && prefix !== start) return undefined;
      prefix = start;
    }
    if (prefix === undefined || !prefix.split("/").filter(Boolean).every(isAddressSegment)) return undefined;
    return `${prefix}/${SLUG_PLACEHOLDER}`;
  };
  let pattern: string | undefined;
  if (collectionId) {
    const old = oldPattern();
    const usedPrefixes = new Set(
      otherCollections.flatMap((collection) => collection.settings.path?.split("/")[1] ?? []),
    );
    pattern =
      old && fits(old)
        ? old
        : (LIST_NAMES.filter((name) => !usedPrefixes.has(name))
            .map((name) => `/${name}/${SLUG_PLACEHOLDER}`)
            .find(fits) ?? `/${uniqueName("posts", usedPrefixes)}/${SLUG_PLACEHOLDER}`);
  }
  const postPath = (post: WordPressItem) => (pattern ? entryAddress(pattern, postSlugs.get(post.id) ?? "") : undefined);

  /* The page listing posts: where their addresses start, or WordPress's own page for them, or the home page. */
  let listPath: string | undefined;
  if (pattern) {
    const prefix = pattern.slice(0, pattern.indexOf(`/${SLUG_PLACEHOLDER}`));
    const emptyPage = pages.find(
      (page) => !page.content.trim() && LIST_NAMES.includes(pagePaths.get(page.id)?.slice(1) ?? ""),
    );
    // WordPress's own page for posts, which has no content of its own, lists them wherever they are.
    if (emptyPage) listPath = pagePaths.get(emptyPage.id);
    else if (prefix) listPath = prefix;
    else if (!importedPagePaths.has("/")) listPath = "/";
    else {
      const top = new Set([...otherAddresses].map((path) => path.split("/")[1] ?? ""));
      listPath = `/${uniqueName("blog", top)}`;
    }
  }

  /* Categories and tags, as the posts collection's choices. */
  const usedTerms = (key: "categories" | "tags") => new Set(posts.flatMap((post) => post[key]));
  const choices = (terms: WordPressTerm[], used: Set<string>, kind: string) => {
    const values = new Map<string, string>();
    const taken: string[] = [];
    for (const term of terms) {
      if (!used.has(term.slug) || (kind === "category" && term.slug === "uncategorized")) continue;
      const value = uniqueName(
        isAddressSegment(term.slug) ? term.slug : (choiceSlug(term.name) ?? `${kind}-${taken.length + 1}`),
        taken,
      );
      taken.push(value);
      values.set(term.slug, value);
    }
    return values;
  };
  const categoryValues = choices(source.categories, usedTerms("categories"), "category");
  const tagValues = choices(source.tags, usedTerms("tags"), "tag");
  const termOptions = (terms: WordPressTerm[], values: Map<string, string>) =>
    terms
      .filter((term) => values.has(term.slug))
      .map((term) => ({ value: values.get(term.slug) ?? term.slug, label: term.name || term.slug }))
      .sort((a, b) => a.label.localeCompare(b.label));

  /* Old addresses and what they are now. */
  const newPaths = new Map<string, string>();
  const idPaths = new Map<number, string>();
  for (const page of pages) {
    const path = pagePaths.get(page.id);
    const old = linkPath(page);
    if (path && old) newPaths.set(old, path);
    if (path) idPaths.set(page.id, path);
  }
  for (const post of posts) {
    const path = postPath(post);
    const old = linkPath(post);
    if (path && old) newPaths.set(old, path);
    if (path) idPaths.set(post.id, path);
  }
  const termArchive = (term: WordPressTerm, kind: "category" | "tag", terms: WordPressTerm[]): string | undefined => {
    if (term.link) {
      try {
        return sitePath(site, new URL(term.link));
      } catch {
        return undefined;
      }
    }
    const parents: string[] = [];
    let parent = term.parent;
    while (parent && parents.length < 10) {
      parents.unshift(parent);
      parent = terms.find((candidate) => candidate.slug === parent)?.parent;
    }
    return `/${kind}/${[...parents, term.slug].join("/")}`;
  };
  const archives: Array<{ old: string; to: string }> = [];
  if (listPath) {
    for (const term of source.categories) {
      const value = categoryValues.get(term.slug);
      const old = termArchive(term, "category", source.categories);
      if (!value || !old) continue;
      const to = `${listPath === "/" ? "" : listPath}/categories/${choiceSlug(value) ?? value}`;
      newPaths.set(old, to);
      archives.push({ old, to });
    }
    for (const term of source.tags) {
      const old = tagValues.has(term.slug) ? termArchive(term, "tag", source.tags) : undefined;
      if (!old) continue;
      newPaths.set(old, listPath);
      archives.push({ old, to: listPath });
    }
  }

  /* Media: the files pages and posts use, each copied once, whatever size of it they show. */
  const attachments = new Map<string, WordPressMedia>();
  for (const media of source.media) {
    try {
      attachments.set(mediaKey(new URL(media.url)), media);
    } catch {
      // A file without a usable address can't be copied.
    }
  }
  const attachmentById = new Map(source.media.map((media) => [media.id, media]));
  const copies = new Map<string, WordPressMediaCopy>();
  const takenNames = (options.mediaFiles ?? []).map((path) => path.slice(path.lastIndexOf("/") + 1));
  const notCopied = new Set<string>();
  const oldLinks = new Set<string>();

  const media = (address: string): string => {
    let url: URL;
    try {
      url = withoutImageService(new URL(address.trim(), site.url.href));
    } catch {
      return "";
    }
    if (sitePath(site, url) === undefined && url.hostname.replace(/^www\./, "") !== site.host) {
      return isSafeUrl(url.href) && /^https?:$/.test(url.protocol) ? url.href : "";
    }
    const original = attachments.get(mediaKey(url))?.url ?? `${url.origin}${url.pathname}`;
    if (!mediaKind(original)) return original;
    let copy = copies.get(original);
    if (!copy) {
      const file = decoded(original.slice(original.lastIndexOf("/") + 1)).replace(/-scaled(?=\.[a-z0-9]+$)/i, "");
      const name = uploadName(file, takenNames);
      takenNames.push(name);
      copy = { url: original, path: `${MEDIA_DIR}/${name}` };
      copies.set(original, copy);
    }
    if (options.copied && !options.copied.has(copy.url)) {
      notCopied.add(copy.url);
      return copy.url;
    }
    return `/media/${copy.path.slice(MEDIA_DIR.length + 1)}`;
  };

  const link = (address: string): string => {
    const text = address.trim();
    if (!text) return "";
    if (text.startsWith("#") || /^(mailto|tel):/i.test(text)) return text;
    let url: URL;
    try {
      url = new URL(text, site.url.href);
    } catch {
      return "";
    }
    if (!/^https?:$/.test(url.protocol)) return isSafeUrl(text) ? text : "";
    const path = sitePath(site, url);
    if (path === undefined)
      return url.hostname.replace(/^www\./, "") === site.host ? url.href : isSafeUrl(text) ? text : "";
    if (/\/wp-content\/uploads\//.test(url.pathname) || (mediaKind(url.pathname) && path !== "/"))
      return media(url.href);
    const id = Number(url.searchParams.get("p") ?? url.searchParams.get("page_id") ?? "");
    const found = (id > 0 ? idPaths.get(id) : undefined) ?? (url.search ? undefined : newPaths.get(path));
    if (found) return `${found}${url.hash}`;
    oldLinks.add(url.href);
    return url.href;
  };

  const context = (item: string): ConvertContext => ({
    link,
    media,
    attachment: (id) => attachmentById.get(id),
    reusable: (id) => source.reusableBlocks[id],
    note: (note, name) => notes.convert(note, name, item),
  });
  const featured = (item: WordPressItem): string => {
    const image = item.image ? attachmentById.get(item.image) : undefined;
    return image ? media(image.url) : "";
  };
  const schedule = (item: WordPressItem) =>
    item.status === "future" && item.date ? { showFrom: item.date } : undefined;

  /* Pages. */
  const listProps = {
    collection: collectionId ?? "",
    limit: 10,
    paginate: true,
    choicePages: categoryValues.size > 0 ? "categories" : "",
  };
  let listWritten = false;
  for (const page of pages) {
    const path = pagePaths.get(page.id) ?? "/";
    const title = page.title || source.title;
    const parts = itemParts(page, context(title));
    walkParts(parts, (part) => {
      // Sites without the Table block show tables as text.
      if (part.kind === "table" && options.blocks && !options.blocks.includes("Table")) {
        notes.convert("table", "table", title);
      }
      // And posts from social sites as links to them.
      if (part.kind === "post" && options.blocks && !options.blocks.includes("Embed")) {
        notes.convert("embed", hostName(part.url), title);
      }
    });
    const writer = new BlockWriter();
    // Every page has its title as its heading, unless its content starts with one of its own.
    const ownHeading = parts.some((part) => part.kind === "heading" && part.level === 1);
    const blocks = pageBlocks(ownHeading ? undefined : title, parts, {
      link,
      posts: collectionId,
      writer,
      ...(options.blocks && { blocks: options.blocks }),
    });
    if (collectionId && path === listPath) {
      blocks.push(writer.section([writer.collectionList({ ...listProps, className: "mt-8" })], { width: "normal" }));
      listWritten = true;
    }
    changes.push(
      pageFileChange(
        path,
        pageData({ className: "", description: summaryOf(page.excerpt), image: featured(page), title }, blocks),
        schedule(page),
      ),
    );
  }
  if (collectionId && listPath && !listWritten) {
    const writer = new BlockWriter();
    const title = listPath === "/" ? source.title || names.posts : names.posts;
    changes.push(
      pageFileChange(
        listPath,
        pageData({ className: "", description: source.description, image: "", title }, [
          writer.section([writer.heading(title, "h1"), writer.collectionList({ ...listProps, className: "mt-8" })], {
            width: "normal",
          }),
        ]),
        undefined,
      ),
    );
  }

  /* Posts. */
  if (collectionId && pattern) {
    const fields: CollectionField[] = [
      { name: "title", label: names.title, type: "text", required: true },
      { name: "date", label: names.date, type: "date", required: true },
      { name: "summary", label: names.summary, type: "textarea" },
      { name: "image", label: names.image, type: "image" },
      ...(categoryValues.size > 0
        ? [
            {
              name: "categories",
              label: names.categories,
              type: "tags" as const,
              options: termOptions(source.categories, categoryValues),
            },
          ]
        : []),
      ...(tagValues.size > 0
        ? [{ name: "tags", label: names.tags, type: "tags" as const, options: termOptions(source.tags, tagValues) }]
        : []),
      { name: "body", label: names.text, type: "richtext" },
    ];
    const field = (id: string, name: string, style: string, className: string) => ({
      type: "EntryField",
      props: { id, className, field: name, style },
    });
    const settings: CollectionFile = {
      version: 1,
      name: names.posts,
      entryName: names.post,
      path: pattern,
      fields,
      sort: { field: "date", order: "desc" },
      markdown: { body: "body" },
      template: {
        root: { props: { className: "", description: "{summary}", image: "{image}", title: "{title}" } },
        content: [
          {
            type: "Section",
            props: {
              id: "Section-post",
              background: "none",
              backgroundImage: "",
              className: "",
              content: [
                field("EntryField-date", "date", "small", ""),
                field("EntryField-title", "title", "title", "mt-2"),
                ...(categoryValues.size > 0 ? [field("EntryField-categories", "categories", "small", "mt-2")] : []),
                field("EntryField-image", "image", "text", "mt-8"),
                field("EntryField-body", "body", "text", "mt-8"),
                {
                  type: "Button",
                  props: {
                    id: "Button-posts",
                    className: "mt-10",
                    href: listPath ?? "/",
                    label: names.allPosts,
                    newTab: false,
                    size: "md",
                    variant: "outline",
                  },
                },
              ],
              padding: "lg",
              width: "narrow",
            },
          },
        ],
      },
    };
    changes.push(collectionFileChange(collectionId, settings));
    const collection: Pick<Collection, "id" | "settings"> = { id: collectionId, settings };
    for (const post of posts) {
      const title = post.title || source.title;
      const parts = itemParts(post, context(title));
      walkParts(parts, (part) => {
        if (part.kind === "video") notes.convert("video", "video", title);
        if (part.kind === "post") notes.convert("embed", hostName(part.url), title);
        if (part.kind === "posts") notes.convert("posts", "posts", title);
      });
      const values: Record<string, unknown> = {
        title,
        date: post.date.slice(0, 10),
        summary: summaryOf(post.excerpt) || partsSummary(parts),
        image: featured(post),
        body: partsMarkdown(parts, link),
      };
      if (categoryValues.size > 0)
        values.categories = post.categories.flatMap((slug) => categoryValues.get(slug) ?? []);
      if (tagValues.size > 0) values.tags = post.tags.flatMap((slug) => tagValues.get(slug) ?? []);
      changes.push(entryFileChange(collection, postSlugs.get(post.id) ?? `post-${post.id}`, values, schedule(post)));
    }
  }

  /* Menus. */
  const menus: Menus = { ...content.menus };
  const writtenMenus: string[] = [];
  const menuHref = (item: WordPressMenu["items"][number]): string => {
    if (item.target?.kind === "item") {
      const path = idPaths.get(item.target.id);
      if (path) return path;
    }
    return item.url ? link(item.url) : "";
  };
  const menuLabel = (item: WordPressMenu["items"][number]): string =>
    item.label || (item.target?.kind === "item" ? (byId.get(item.target.id)?.title ?? "") : "");
  const menuItems = (menu: WordPressMenu): MenuItem[] => {
    const ids = new Set(menu.items.map((item) => item.id));
    const byOrder = [...menu.items].sort((a, b) => a.order - b.order);
    const topOf = (item: WordPressMenu["items"][number], seen = new Set<number>()): number => {
      const parent = menu.items.find((candidate) => candidate.id === item.parent);
      return parent && !seen.has(parent.id) ? topOf(parent, new Set([...seen, item.id])) : item.id;
    };
    return byOrder
      .filter((item) => !item.parent || !ids.has(item.parent))
      .flatMap((top): MenuItem[] => {
        const href = menuHref(top);
        const label = menuLabel(top);
        const children = byOrder
          .filter((item) => item.id !== top.id && topOf(item) === top.id)
          .flatMap((item) => {
            const childHref = menuHref(item);
            const childLabel = menuLabel(item);
            return childHref && childLabel ? [{ label: childLabel, href: childHref }] : [];
          });
        if (!label || (!href && children.length === 0)) return [];
        return [{ label, href: href || (children[0]?.href ?? "/"), ...(children.length > 0 && { children }) }];
      });
  };
  const sourceMenus = (source.menus ?? []).filter((menu) => menu.items.length > 0);
  if (sourceMenus.length > 0) {
    const named = (pattern: RegExp) => sourceMenus.find((menu) => pattern.test(`${menu.name} ${menu.slug}`));
    const main =
      named(/primary|main|header|top|navigation|menu/i) ??
      [...sourceMenus].sort((a, b) => b.items.length - a.items.length)[0];
    const footer = sourceMenus.find((menu) => menu !== main && /footer/i.test(`${menu.name} ${menu.slug}`));
    for (const menu of sourceMenus) {
      const id =
        menu === main
          ? "main"
          : menu === footer
            ? "footer"
            : uniqueName(slugify(menu.slug || menu.name) || "menu", [...Object.keys(menus), "main", "footer"]);
      const items = menuItems(menu);
      if (items.length === 0) continue;
      menus[id] = items;
      writtenMenus.push(id);
    }
  } else if (pages.length > 0 || listPath) {
    if (source.source === "address") notes.list.push({ kind: "no-menus" });
    const front = pages.find((page) => pagePaths.get(page.id) === "/");
    const top = pages
      .filter((page) => page !== front && !(page.parent && byId.get(page.parent)?.type === "page"))
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
      .slice(0, 7)
      .map((page) => ({ label: page.title, href: pagePaths.get(page.id) ?? "/" }));
    const items: MenuItem[] = [
      ...(front ? [{ label: front.title || source.title, href: "/" }] : []),
      ...top,
      ...(listPath && listPath !== "/" && !top.some((item) => item.href === listPath)
        ? [{ label: names.posts, href: listPath }]
        : []),
    ];
    if (items.length > 0) {
      menus.main = items;
      writtenMenus.push("main");
    }
  }
  if (writtenMenus.length > 0) changes.push(menusFileChange({ menus, languageMenus: content.languageMenus }));

  /* Site settings. */
  const settings = {
    ...content.settings,
    ...(source.title && { title: source.title }),
    description: source.description,
    ...(source.language && { language: source.language }),
  };
  if (JSON.stringify(settings) !== JSON.stringify(content.settings)) changes.push(siteSettingsFileChange(settings));

  /* Redirects from old addresses that changed. */
  const addresses = new Set([
    ...keptPages.map((page) => page.path),
    ...importedPagePaths,
    ...(listPath ? [listPath] : []),
    ...posts.flatMap((post) => postPath(post) ?? []),
    ...otherCollections.flatMap((collection) =>
      collection.entries.flatMap((entry) => (entry.path ? [entry.path] : [])),
    ),
    ...allPages(content).map((page) => page.path),
  ]);
  const redirects: Redirect[] = [];
  const addRedirect = (old: string, to: string) => {
    const from = redirectFrom(`${site.path}${old}`);
    if (
      !from.ok ||
      from.path === to ||
      isReservedRedirect(from.path) ||
      addresses.has(from.path) ||
      redirects.some((redirect) => redirect.from === from.path)
    )
      return;
    redirects.push({ from: from.path, to });
  };
  for (const item of shown) {
    const old = linkPath(item);
    const to = item.type === "page" ? pagePaths.get(item.id) : postPath(item);
    if (old && to && old !== "/") addRedirect(old, to);
  }
  for (const archive of archives) addRedirect(archive.old, archive.to);
  if (redirects.length > 0) {
    const fresh = new Set(redirects.map((redirect) => redirect.from));
    changes.push(
      redirectsFileChange({
        redirects: [
          ...(content.redirects ?? []).filter((redirect) => !fresh.has(redirect.from) && !addresses.has(redirect.from)),
          ...redirects,
        ],
        message: content.redirectMessage,
      }),
    );
  }

  /* What to tell the person importing. */
  if (oldLinks.size > 0) notes.list.push({ kind: "old-links", urls: [...oldLinks] });
  if (notCopied.size > 0) notes.list.push({ kind: "not-copied", urls: [...notCopied] });
  const used = new Set([...copies.keys()]);
  const unused = source.media.filter((file) => !used.has(file.url)).length;
  if (unused > 0) notes.list.push({ kind: "unused-media", count: unused });

  return {
    changes,
    media: [...copies.values()],
    summary: {
      pages: [...importedPagePaths],
      posts: posts.length,
      ...(collectionId && pattern && { collection: { id: collectionId, path: pattern } }),
      ...(listPath && { listPath }),
      categories: categoryValues.size,
      tags: tagValues.size,
      menus: writtenMenus,
      redirects: redirects.length,
      replaced: content.pages
        .filter((page) => importedPagePaths.has(page.path) || (!listWritten && page.path === listPath))
        .map((page) => page.path),
    },
    notes: notes.all(),
  };
}
