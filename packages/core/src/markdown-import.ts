/**
 * Plans bringing a folder of Markdown files into a site, such as another
 * static site's content (Hugo, Jekyll, Eleventy, Astro, Docusaurus) or notes:
 * the files to write and the media to copy, with no disk or network access, so
 * the admin panel and the command line import the same way.
 *
 * - **Folders** are each imported as a collection of Markdown items (the
 *   default for every folder) or as pages (the default for the files at the
 *   top), as the person importing chooses.
 * - **Pages** are converted to built-in blocks with the WordPress import's
 *   conversion: the Markdown as HTML, read as a page shows it.
 * - **Items** keep their Markdown, with their front matter as fields.
 * - **Links** between the files get their new addresses, pictures beside them
 *   are copied into the media library, and addresses that changed get redirects.
 */
import type { Data } from "@puckeditor/core";
import { Marked } from "marked";
import { parse as parseYaml } from "yaml";
import {
  collectionFileChange,
  entryFileChange,
  menusFileChange,
  pageFileChange,
  redirectsFileChange,
  slugify,
  uniqueName,
} from "./content/changes.js";
import type { Collection } from "./content/collections.js";
import { choiceSlug } from "./content/collections.js";
import { SUMMARY_LENGTH } from "./content/entry-details.js";
import { allPages, type SiteContent } from "./content/load.js";
import { isSafeUrl } from "./content/markdown.js";
import { mediaKind, uploadName } from "./content/media-files.js";
import { entryAddress, isAddressSegment, isReservedPagePath, MEDIA_DIR, SLUG_PLACEHOLDER } from "./content/paths.js";
import { isReservedRedirect, type Redirect, redirectFrom } from "./content/redirects.js";
import type { CollectionField, CollectionFile, MenuItem } from "./content/schemas.js";
import type { FileChange } from "./content/store.js";
import { type ConversionNote, type ConvertContext, itemParts } from "./wordpress/convert.js";
import { BlockWriter, IMPORT_BLOCKS, pageBlocks } from "./wordpress/page-blocks.js";

/** How a folder's files are imported. */
export type MarkdownFolderUse = "collection" | "pages";

/** Words the import writes into content: collections' item names, fields' labels and the link back to a list. */
export interface MarkdownImportNames {
  item: string;
  post: string;
  title: string;
  date: string;
  summary: string;
  image: string;
  categories: string;
  tags: string;
  text: string;
  all: string;
}

export const DEFAULT_MARKDOWN_NAMES: MarkdownImportNames = {
  item: "Item",
  post: "Post",
  title: "Title",
  date: "Date",
  summary: "Summary",
  image: "Image",
  categories: "Categories",
  tags: "Tags",
  text: "Text",
  all: "See all",
};

export interface MarkdownImportOptions {
  /** How each folder at the top is imported, by its name, `""` for the files at the top. */
  folders?: Readonly<Record<string, MarkdownFolderUse>>;
  /** Whether the top's `index.md` (or `README.md`) takes the place of the site's home page. */
  replaceHome?: boolean;
  /** Whether files at addresses the site's pages already have take their place, rather than being left out. */
  replacePages?: boolean;
  /** Whether drafts (`draft: true`, `published: false`) are imported too, which callers put in a draft. */
  drafts?: boolean;
  /** Whether the top-level pages are added to the main menu, in their `weight` or `order`. */
  menu?: boolean;
  /** Whether front matter the import doesn't know becomes fields of collections' items, where it can. */
  keepFields?: boolean;
  /** The site's media files now (`public/media/…`), so copies get names of their own. */
  mediaFiles?: readonly string[];
  /**
   * The files that were copied, by their path in the folder, after an earlier
   * plan's `media` was read. Content leaves the rest out. Leave it out to plan
   * as if every file will be copied.
   */
  copied?: ReadonlySet<string>;
  /** The site's blocks. Imported pages need the built-in ones (`IMPORT_BLOCKS`, and Entry field for items). */
  blocks?: readonly string[];
  names?: Partial<MarkdownImportNames>;
}

/** A folder of Markdown files, as `markdownFolders()` finds it, with how it's imported unless the person chooses. */
export interface MarkdownFolder {
  /** Its name, `""` for the files at the top. */
  name: string;
  files: number;
  suggested: MarkdownFolderUse;
}

/** A file to copy into the media library from the folder. */
export interface MarkdownMediaCopy {
  /** Where it is in the folder. */
  file: string;
  /** Where it goes, such as `public/media/photo.jpg`. */
  path: string;
}

export interface MarkdownImportSummary {
  /** The pages written, by address. */
  pages: string[];
  /** The site's pages the import replaces. */
  replaced: string[];
  /** The collections written, with their items' address pattern and how many items. */
  collections: Array<{ id: string; name: string; path: string; items: number; list?: string }>;
  /** Pages added to the main menu. */
  menu: number;
  redirects: number;
  /** Drafts imported, which callers put in a draft. */
  drafts: number;
}

/** What the import couldn't bring across as it was, for the person importing to check. */
export type MarkdownImportNote =
  /** Drafts left out. */
  | { kind: "drafts"; files: string[] }
  /** Files at addresses the site's pages have, left out (the top's `index.md` among them, unless it replaces the home page). */
  | { kind: "taken"; files: string[] }
  /** Files whose front matter couldn't be read, imported without it. */
  | { kind: "front-matter"; files: string[] }
  /** Links to files or addresses the import doesn't have, made into their words alone. */
  | { kind: "missing-links"; files: string[] }
  /** Pictures and files the folder doesn't have, left out. */
  | { kind: "missing-media"; files: string[] }
  /** Pictures and files that couldn't be copied, such as ones too large, left out, by their path in the folder. */
  | { kind: "not-copied"; files: string[] }
  /** Template code of another site's (`{{< … >}}`, `{% … %}`), which shows as written. */
  | { kind: "template-code"; files: string[] }
  /** HTML in items' Markdown, which shows as text. */
  | { kind: "html"; files: string[] }
  /** Front matter left out, by name. */
  | { kind: "fields"; names: string[] }
  /** Something in a page converted with a loss, as the WordPress import says it. */
  | { kind: "converted"; note: ConversionNote; name: string; files: string[] };

export interface MarkdownImport {
  /** The files to write, apart from media. */
  changes: FileChange[];
  /** The media to copy from the folder, each to its `path`. */
  media: MarkdownMediaCopy[];
  summary: MarkdownImportSummary;
  notes: MarkdownImportNote[];
}

export class MarkdownImportError extends Error {
  override name = "MarkdownImportError";

  constructor(
    /** The blocks the site needs and doesn't have. */
    readonly missingBlocks: string[],
  ) {
    super(`Importing needs these blocks, which the site doesn't have: ${missingBlocks.join(", ")}.`);
  }
}

/** Front matter between two lines of `---`, or TOML's `+++`, which is read only for what it can say as `key = value`. */
const YAML_FRONT = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const TOML_FRONT = /^\+\+\+\r?\n(?:([\s\S]*?)\r?\n)?\+\+\+[ \t]*(?:\r?\n|$)/;
/** The files read as Markdown. */
const MARKDOWN = /\.(md|markdown|mdx)$/i;
/** Names that mean a folder's own page. */
const INDEX_NAMES = new Set(["index", "_index", "readme"]);
/** Folders whose files are dated posts: the import names their items Post. */
const POST_FOLDERS = new Set(["posts", "_posts", "blog", "news", "articles", "updates"]);
/** Front matter the import reads. Anything else is left out, or kept as fields with `keepFields`. */
const KNOWN = new Set([
  "title",
  "date",
  "description",
  "summary",
  "excerpt",
  "tags",
  "categories",
  "category",
  "draft",
  "published",
  "slug",
  "permalink",
  "url",
  "image",
  "cover",
  "featured_image",
  "thumbnail",
  "weight",
  "order",
  "nav_order",
  "sidebar_position",
  "noindex",
  "robots",
  "layout",
  "type",
  "aliases",
  "redirect_from",
]);

/** Shows a folder's or file's name as words: `blog-posts` → `Blog posts`. */
function words(name: string): string {
  const text = name.replace(/^_+/, "").replace(/[-_]+/g, " ").trim();
  return text ? text[0]?.toUpperCase() + text.slice(1) : name;
}

/** The folders a list of files has Markdown in, with how each is imported unless chosen. */
export function markdownFolders(files: readonly string[]): MarkdownFolder[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!MARKDOWN.test(file)) continue;
    const name = file.includes("/") ? (file.split("/")[0] ?? "") : "";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]): MarkdownFolder => ({ name, files: count, suggested: name === "" ? "pages" : "collection" }))
    .sort((a, b) => (a.name === "" ? -1 : b.name === "" ? 1 : a.name.localeCompare(b.name)));
}

interface ReadFile {
  file: string;
  front: Record<string, unknown>;
  body: string;
  /** Front matter that couldn't be read. */
  broken: boolean;
}

/** TOML front matter's simple lines, `key = "value"`, `key = 3`, `key = true` and `key = ["a", "b"]`. */
function simpleToml(text: string): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][\w-]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (!match?.[1] || match[2] === undefined) continue;
    const raw = match[2];
    try {
      values[match[1]] = JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      values[match[1]] = raw;
    }
  }
  return values;
}

function readMarkdown(file: string, text: string): ReadFile {
  const yaml = YAML_FRONT.exec(text);
  const toml = yaml ? undefined : TOML_FRONT.exec(text);
  const match = yaml ?? toml;
  if (!match) return { file, front: {}, body: text.trim(), broken: false };
  const body = text.slice(match[0].length).trim();
  if (toml) return { file, front: simpleToml(toml[1] ?? ""), body, broken: false };
  try {
    const front = parseYaml(match[1] ?? "") ?? {};
    if (typeof front !== "object" || Array.isArray(front)) return { file, front: {}, body, broken: true };
    return { file, front: front as Record<string, unknown>, body, broken: false };
  } catch {
    return { file, front: {}, body, broken: true };
  }
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() || undefined : typeof value === "number" ? String(value) : undefined;

/** A date as `YYYY-MM-DD`, from front matter or a Jekyll post's file name. */
function dateOf(value: unknown, file: string): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const found = /^(\d{4}-\d{2}-\d{2})/.exec(text(value) ?? "");
  if (found?.[1]) return found[1];
  return /(?:^|\/)(\d{4}-\d{2}-\d{2})-[^/]+$/.exec(file)?.[1];
}

/** A list of words from front matter: `tags: [a, b]`, `tags: "a, b"` or `category: a`. */
function listOf(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value.flatMap((item) => text(item) ?? []));
    else if (typeof value === "string") out.push(...value.split(",").map((item) => item.trim()));
  }
  return [...new Set(out.filter(Boolean))];
}

function isDraft(front: Record<string, unknown>): boolean {
  return front.draft === true || front.draft === "true" || front.published === false || front.published === "false";
}

/** The page's or item's title: its front matter's, its first heading's, or its file's name. */
function titleOf(read: ReadFile): string {
  const own = text(read.front.title);
  if (own) return own;
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(read.body)?.[1];
  if (heading) return heading.trim();
  const stem = (read.file.split("/").pop() ?? "").replace(MARKDOWN, "");
  const name = INDEX_NAMES.has(stem.toLowerCase()) ? (read.file.split("/").slice(-2, -1)[0] ?? stem) : stem;
  return words(name.replace(/^\d{4}-\d{2}-\d{2}-/, ""));
}

/** Text for a summary: up to `SUMMARY_LENGTH`. */
function shortened(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_LENGTH ? `${flat.slice(0, SUMMARY_LENGTH - 1).trimEnd()}…` : flat;
}

/** A path's parts as addresses can have them. */
function segments(path: string): string[] {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const plain = part.replace(/\.html?$/i, "");
      return isAddressSegment(plain) ? plain : slugify(plain);
    })
    .filter(Boolean);
}

/** An address as the source site served a file: `about.md` and `about/index.md` are `/about`. */
function fileAddress(file: string): string {
  const parts = file.replace(MARKDOWN, "").split("/");
  if (INDEX_NAMES.has((parts.at(-1) ?? "").toLowerCase())) parts.pop();
  return `/${parts.join("/")}`;
}

/** An address from front matter's `permalink` or `url`, without its site and slashes at the ends. */
function permalinkOf(front: Record<string, unknown>): string | undefined {
  const value = text(front.permalink) ?? text(front.url);
  if (!value || /:\w/.test(value)) return undefined;
  try {
    const url = new URL(value, "https://site.invalid");
    return `/${url.pathname
      .split("/")
      .filter(Boolean)
      .join("/")
      .replace(/(^|\/)index\.html?$/i, "")
      .replace(/\.html?$/i, "")}`.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

/** A folder path joined with a relative one, `..` included, or `undefined` past the top. */
function joined(folder: string, relative: string): string | undefined {
  const parts = relative.startsWith("/") ? [] : folder.split("/").filter(Boolean);
  for (const part of relative.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

class Notes {
  private sets = new Map<string, Set<string>>();
  private converted = new Map<string, { note: ConversionNote; name: string; files: Set<string> }>();

  add(kind: Exclude<MarkdownImportNote["kind"], "converted">, value: string): void {
    const set = this.sets.get(kind) ?? new Set<string>();
    set.add(value);
    this.sets.set(kind, set);
  }

  convert(note: ConversionNote, name: string, file: string): void {
    const key = `${note}:${name}`;
    const found = this.converted.get(key) ?? { note, name, files: new Set<string>() };
    found.files.add(file);
    this.converted.set(key, found);
  }

  all(): MarkdownImportNote[] {
    const notes: MarkdownImportNote[] = [];
    for (const [kind, values] of this.sets) {
      const list = [...values];
      notes.push(kind === "fields" ? { kind: "fields", names: list } : ({ kind, files: list } as MarkdownImportNote));
    }
    for (const { note, name, files } of this.converted.values()) {
      notes.push({ kind: "converted", note, name, files: [...files] });
    }
    return notes;
  }
}

interface PlannedPage {
  read: ReadFile;
  path: string;
  title: string;
  /** The address the source site served it at. */
  old: string;
  weight: number;
}

interface PlannedItem {
  read: ReadFile;
  slug: string;
  title: string;
  old: string;
}

interface PlannedCollection {
  folder: string;
  id: string;
  name: string;
  items: PlannedItem[];
  pattern: string;
  list?: string;
}

/**
 * Plans importing Markdown files into `content`. `files` lists every file in
 * the folder, by its path in it with `/` between folders; `text` reads a
 * Markdown file's text. Throws `MarkdownImportError` if the site lacks the
 * blocks it needs.
 */
export function planMarkdownImport(
  files: readonly string[],
  read: (file: string) => string | undefined,
  content: SiteContent,
  options: MarkdownImportOptions = {},
): MarkdownImport {
  const names = { ...DEFAULT_MARKDOWN_NAMES, ...options.names };
  if (options.blocks) {
    const missing = [...IMPORT_BLOCKS, "EntryField"].filter((block) => !options.blocks?.includes(block));
    if (missing.length > 0) throw new MarkdownImportError(missing);
  }
  const notes = new Notes();
  const changes: FileChange[] = [];
  const fileSet = new Set(files);
  const folderUse = (folder: string): MarkdownFolderUse =>
    options.folders?.[folder] ?? (folder === "" ? "pages" : "collection");

  /* What's imported, and what's left out. */
  const markdown: ReadFile[] = [];
  let drafts = 0;
  for (const file of [...files].filter((file) => MARKDOWN.test(file)).sort()) {
    const found = read(file);
    if (found === undefined) continue;
    const parsed = readMarkdown(file, found);
    if (parsed.broken) notes.add("front-matter", file);
    if (isDraft(parsed.front)) {
      if (!options.drafts) {
        notes.add("drafts", file);
        continue;
      }
      drafts += 1;
    }
    if (/\{\{[<%].*?[>%]\}\}|\{%.*?%\}/s.test(parsed.body)) notes.add("template-code", file);
    markdown.push(parsed);
  }
  const folderOf = (file: string) => (file.includes("/") ? (file.split("/")[0] ?? "") : "");
  /** A collection folder's own page, such as Hugo's `blog/_index.md`, which becomes the page listing its items. */
  const isListPage = (file: string) => {
    const parts = file.split("/");
    return (
      parts.length === 2 &&
      folderUse(parts[0] ?? "") === "collection" &&
      INDEX_NAMES.has((parts[1] ?? "").replace(MARKDOWN, "").toLowerCase())
    );
  };
  const asPage = (file: ReadFile) => folderUse(folderOf(file.file)) === "pages" || isListPage(file.file);

  /* Pages' addresses: their permalinks, or where the files are. */
  const sitePaths = new Set(content.pages.map((page) => page.path));
  const pages: PlannedPage[] = [];
  const takenPaths = new Set<string>();
  for (const file of markdown.filter(asPage)) {
    const old = permalinkOf(file.front) ?? fileAddress(file.file);
    let parts = segments(old);
    const slug = text(file.front.slug);
    if (slug && parts.length > 0 && !permalinkOf(file.front)) parts = [...parts.slice(0, -1), slugify(slug) || slug];
    let path = `/${parts.join("/")}`;
    if (path === "/" && !options.replaceHome) {
      notes.add("taken", file.file);
      continue;
    }
    if (isReservedPagePath(path))
      path = `/${parts.map((part, index) => (index === 0 ? `${part}-page` : part)).join("/")}`;
    if (path !== "/" && sitePaths.has(path) && !options.replacePages) {
      notes.add("taken", file.file);
      continue;
    }
    if (takenPaths.has(path)) {
      const parent = path.slice(0, path.lastIndexOf("/"));
      const siblings = [...takenPaths].filter((taken) => taken.slice(0, taken.lastIndexOf("/")) === parent);
      path = `${parent}/${uniqueName(
        path.slice(path.lastIndexOf("/") + 1),
        siblings.map((taken) => taken.slice(taken.lastIndexOf("/") + 1)),
      )}`;
    }
    takenPaths.add(path);
    const weight = Number(file.front.weight ?? file.front.order ?? file.front.nav_order ?? file.front.sidebar_position);
    pages.push({
      read: file,
      path,
      title: titleOf(file),
      old: old || "/",
      weight: Number.isFinite(weight) ? weight : Number.POSITIVE_INFINITY,
    });
  }
  const importedPaths = new Set(pages.map((page) => page.path));

  /* Collections: one for each folder imported as one, with its items' names and addresses. */
  const collectionIds = content.collections.map((collection) => collection.id);
  const otherAddresses = new Set([
    ...content.pages.filter((page) => !importedPaths.has(page.path)).map((page) => page.path),
    ...importedPaths,
    ...content.collections.flatMap((collection) => collection.entries.flatMap((entry) => entry.path ?? [])),
  ]);
  const usedPrefixes = new Set(
    content.collections.flatMap((collection) => collection.settings.path?.split("/")[1] ?? []),
  );
  const collections: PlannedCollection[] = [];
  const folders = [...new Set(markdown.map((file) => folderOf(file.file)))].filter(
    (folder) => folder !== "" && folderUse(folder) === "collection",
  );
  // Files at the top, imported as a collection, need a folder's name of their own.
  if (folderUse("") === "collection" && markdown.some((file) => folderOf(file.file) === "" && !asPage(file))) {
    folders.unshift("");
  }
  for (const folder of folders) {
    const id = uniqueName(slugify(folder.replace(/^_+/, "")) || "items", collectionIds, "items");
    collectionIds.push(id);
    const slugs: string[] = [];
    const items = markdown
      .filter((file) => folderOf(file.file) === folder && !asPage(file))
      .map((file): PlannedItem => {
        const stem = (file.file.split("/").pop() ?? "").replace(MARKDOWN, "");
        const named = INDEX_NAMES.has(stem.toLowerCase()) ? (file.file.split("/").slice(-2, -1)[0] ?? stem) : stem;
        const base = slugify(text(file.front.slug) ?? named.replace(/^\d{4}-\d{2}-\d{2}-/, "")) || "item";
        const slug = uniqueName(base, slugs);
        slugs.push(slug);
        return { read: file, slug, title: titleOf(file), old: permalinkOf(file.front) ?? fileAddress(file.file) };
      });
    const fits = (pattern: string) =>
      items.every((item) => {
        const path = entryAddress(pattern, item.slug);
        return !otherAddresses.has(path) && !isReservedPagePath(path);
      });
    // Where their old addresses all end with their names under one address, they keep them.
    const prefixes = new Set(
      items.map((item) => (item.old.endsWith(`/${item.slug}`) ? item.old.slice(0, -item.slug.length - 1) : "\0")),
    );
    const [shared] = prefixes;
    const old =
      prefixes.size === 1 &&
      shared !== undefined &&
      shared !== "\0" &&
      shared.split("/").filter(Boolean).every(isAddressSegment)
        ? `${shared}/${SLUG_PLACEHOLDER}`
        : undefined;
    const pattern =
      old && fits(old)
        ? old
        : ([id, ...Array.from({ length: 5 }, (_, n) => `${id}-${n + 2}`)]
            .filter((prefix) => !usedPrefixes.has(prefix))
            .map((prefix) => `/${prefix}/${SLUG_PLACEHOLDER}`)
            .find(fits) ?? `/${uniqueName(id, usedPrefixes)}/${SLUG_PLACEHOLDER}`);
    usedPrefixes.add(pattern.split("/")[1] ?? "");
    for (const item of items) otherAddresses.add(entryAddress(pattern, item.slug));
    const prefix = pattern.slice(0, pattern.indexOf(`/${SLUG_PLACEHOLDER}`));
    collections.push({
      folder,
      id,
      name: words(folder || id),
      items,
      pattern,
      ...(prefix && { list: prefix }),
    });
  }

  /* Old addresses, and the files they were, for links. */
  const byFile = new Map<string, string>();
  const byOld = new Map<string, string>();
  for (const page of pages) {
    byFile.set(page.read.file, page.path);
    byOld.set(page.old, page.path);
  }
  for (const collection of collections) {
    for (const item of collection.items) {
      const path = entryAddress(collection.pattern, item.slug);
      byFile.set(item.read.file, path);
      // Folders starting with _, such as Jekyll's _posts, were never addresses of the old site.
      if (!collection.folder.startsWith("_") || permalinkOf(item.read.front)) byOld.set(item.old, path);
    }
  }
  const known = new Set([...allPages(content).map((page) => page.path), ...byFile.values()]);

  /* Media: the files pages and items use, each copied once. */
  const copies = new Map<string, MarkdownMediaCopy>();
  const takenNames = (options.mediaFiles ?? []).map((path) => path.slice(path.lastIndexOf("/") + 1));
  const copy = (file: string): string => {
    if (options.copied && !options.copied.has(file)) {
      notes.add("not-copied", file);
      return "";
    }
    let found = copies.get(file);
    if (!found) {
      const name = uploadName(file.slice(file.lastIndexOf("/") + 1), takenNames);
      takenNames.push(name);
      found = { file, path: `${MEDIA_DIR}/${name}` };
      copies.set(file, found);
    }
    return `/media/${found.path.slice(MEDIA_DIR.length + 1)}`;
  };

  /** A file in the folder an address in `from` names, trying `static/` and `public/` for root-relative ones, as Hugo and Astro keep them. */
  const fileAt = (from: string, address: string): string | undefined => {
    const folder = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
    const tries = address.startsWith("/")
      ? ["", "static/", "public/", "assets/"].map((root) => `${root}${address.slice(1)}`)
      : [address];
    for (const attempt of tries) {
      const path = joined(address.startsWith("/") ? "" : folder, attempt);
      if (path === undefined) continue;
      for (const candidate of [path, `${path}.md`, `${path}/index.md`, `${path}/_index.md`, `${path}/README.md`]) {
        if (fileSet.has(candidate)) return candidate;
      }
    }
    return undefined;
  };

  const mediaFor =
    (from: string) =>
    (address: string): string => {
      const value = address.trim();
      if (/^https?:\/\//i.test(value)) return isSafeUrl(value) ? value : "";
      if (!value || !isSafeUrl(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return "";
      const path = decoded(value.split(/[?#]/)[0] ?? "");
      const file = fileAt(from, path);
      if (file && mediaKind(file) && !MARKDOWN.test(file)) return copy(file);
      notes.add("missing-media", from);
      return "";
    };

  const linkFor =
    (from: string) =>
    (address: string): string => {
      const value = address.trim();
      if (!value) return "";
      if (value.startsWith("#") || /^(mailto|tel):/i.test(value)) return value;
      if (/^https?:\/\//i.test(value)) return isSafeUrl(value) ? value : "";
      if (/^[a-z][a-z0-9+.-]*:/i.test(value) || !isSafeUrl(value)) return "";
      const [rest = "", hash = ""] = value.split("#");
      const path = decoded(rest.split("?")[0] ?? "");
      const fragment = hash ? `#${hash}` : "";
      if (!path) return value;
      const file = fileAt(from, path);
      if (file && MARKDOWN.test(file)) {
        const to = byFile.get(file);
        if (to) return `${to}${fragment}`;
      } else if (file && mediaKind(file)) {
        return copy(file);
      }
      // An address as the old site had it, which may be one of the files' old addresses or a page the site has.
      const address_ = path.startsWith("/") ? `/${segments(path).join("/")}` : undefined;
      if (address_ !== undefined) {
        const to = byOld.get(address_) ?? (known.has(address_) ? address_ : undefined);
        if (to) return `${to}${fragment}`;
      }
      notes.add("missing-links", from);
      return "";
    };

  /* Pages. */
  const marked = new Marked({ gfm: true });
  const listsWritten = new Set<string>();
  const listFor = new Map(
    collections.flatMap((collection) => (collection.list ? [[collection.list, collection]] : [])),
  );
  for (const page of pages) {
    const html = marked.parse(page.read.body) as string;
    const context: ConvertContext = {
      link: linkFor(page.read.file),
      media: mediaFor(page.read.file),
      attachment: () => undefined,
      reusable: () => undefined,
      note: (note, name) => notes.convert(note, name, page.read.file),
    };
    const parts = itemParts({ content: html, rendered: true }, context);
    const writer = new BlockWriter("md");
    const ownHeading = parts.some((part) => part.kind === "heading" && part.level === 1);
    const blocks = pageBlocks(ownHeading ? undefined : page.title, parts, {
      link: context.link,
      writer,
      ...(options.blocks && { blocks: options.blocks }),
    });
    const listed = listFor.get(page.path);
    if (listed) {
      blocks.push(
        writer.section(
          [writer.collectionList({ collection: listed.id, limit: 10, paginate: true, className: "mt-8" })],
          {
            width: "normal",
          },
        ),
      );
      listsWritten.add(page.path);
    }
    const front = page.read.front;
    const description = text(front.description) ?? text(front.summary) ?? text(front.excerpt);
    const image = text(front.image) ?? text(front.cover) ?? text(front.featured_image) ?? text(front.thumbnail);
    const noIndex = front.noindex === true || /noindex/i.test(text(front.robots) ?? "");
    changes.push(
      pageFileChange(
        page.path,
        {
          root: {
            props: {
              className: "",
              description: description ? shortened(description) : "",
              image: image ? context.media(image) : "",
              title: page.title,
              ...(noIndex && { noIndex: true }),
            },
          },
          content: blocks,
        } as Data,
        undefined,
      ),
    );
  }

  /* Collections and their items. */
  const leftOutFields = new Set<string>();
  const writtenCollections: MarkdownImportSummary["collections"] = [];
  for (const collection of collections) {
    const fronts = collection.items.map((item) => item.read.front);
    const hasDate = collection.items.some((item) => dateOf(item.read.front.date, item.read.file));
    const hasSummary = fronts.some((front) => text(front.description) ?? text(front.summary) ?? text(front.excerpt));
    const hasImage = fronts.some(
      (front) => text(front.image) ?? text(front.cover) ?? text(front.featured_image) ?? text(front.thumbnail),
    );
    const choices = (lists: string[][]) => {
      const values = new Map<string, string>();
      for (const word of lists.flat()) {
        if (values.has(word)) continue;
        values.set(word, uniqueName(choiceSlug(word) ?? `choice-${values.size + 1}`, values.values()));
      }
      return values;
    };
    const categories = choices(fronts.map((front) => listOf(front.categories, front.category)));
    const tags = choices(fronts.map((front) => listOf(front.tags)));
    const options_ = (values: Map<string, string>) =>
      [...values].map(([label, value]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));

    // Front matter of their own, as fields, where it's text or yes and no.
    const kept = new Map<string, CollectionField>();
    for (const front of fronts) {
      for (const [key, value] of Object.entries(front)) {
        if (KNOWN.has(key.toLowerCase())) continue;
        const name = slugify(key);
        const fits =
          options.keepFields &&
          /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name) &&
          !["title", "date", "summary", "image", "categories", "tags", "body"].includes(name) &&
          (typeof value === "string" || typeof value === "boolean" || typeof value === "number");
        if (!fits) {
          leftOutFields.add(key);
          continue;
        }
        if (!kept.has(name)) {
          kept.set(name, {
            name,
            label: words(key),
            type: typeof value === "boolean" ? "yesno" : "text",
          } as CollectionField);
        }
      }
    }

    const fields: CollectionField[] = [
      { name: "title", label: names.title, type: "text", required: true },
      ...(hasDate ? [{ name: "date", label: names.date, type: "date" as const }] : []),
      ...(hasSummary ? [{ name: "summary", label: names.summary, type: "textarea" as const }] : []),
      ...(hasImage ? [{ name: "image", label: names.image, type: "image" as const }] : []),
      ...(categories.size > 0
        ? [{ name: "categories", label: names.categories, type: "tags" as const, options: options_(categories) }]
        : []),
      ...(tags.size > 0 ? [{ name: "tags", label: names.tags, type: "tags" as const, options: options_(tags) }] : []),
      ...kept.values(),
      { name: "body", label: names.text, type: "richtext" },
    ];
    const field = (name: string, style: string, className: string) => ({
      type: "EntryField",
      props: { id: `EntryField-${name}`, className, field: name, style },
    });
    const posts = POST_FOLDERS.has(collection.folder.toLowerCase());
    const settings: CollectionFile = {
      version: 1,
      name: collection.name,
      entryName: posts ? names.post : names.item,
      path: collection.pattern,
      fields,
      ...(hasDate && { sort: { field: "date", order: "desc" as const } }),
      markdown: { body: "body" },
      template: {
        root: {
          props: {
            className: "",
            description: hasSummary ? "{summary}" : "",
            image: hasImage ? "{image}" : "",
            title: "{title}",
          },
        },
        content: [
          {
            type: "Section",
            props: {
              id: "Section-item",
              background: "none",
              backgroundImage: "",
              className: "",
              content: [
                ...(hasDate ? [field("date", "small", "")] : []),
                field("title", "title", hasDate ? "mt-2" : ""),
                ...(hasImage ? [field("image", "text", "mt-8")] : []),
                field("body", "text", "mt-8"),
                ...(collection.list
                  ? [
                      {
                        type: "Button",
                        props: {
                          id: "Button-all",
                          className: "mt-10",
                          href: collection.list,
                          label: names.all,
                          newTab: false,
                          size: "md",
                          variant: "outline",
                        },
                      },
                    ]
                  : []),
              ],
              padding: "lg",
              width: "narrow",
            },
          },
        ],
      } as unknown as CollectionFile["template"],
    };
    changes.push(collectionFileChange(collection.id, settings));
    const written: Pick<Collection, "id" | "settings"> = { id: collection.id, settings };
    for (const item of collection.items) {
      const front = item.read.front;
      const link = linkFor(item.read.file);
      const media = mediaFor(item.read.file);
      let body = rewriteMarkdown(item.read.body, link, media);
      // The title is its own field, so a first heading that says it goes.
      body = body
        .replace(/^#\s+(.+?)\s*#*\s*(?:\r?\n|$)/, (heading, words_: string) =>
          words_.trim() === item.title ? "" : heading,
        )
        .trim();
      if (/<[a-z][\s\S]*?>/i.test(body.replace(/```[\s\S]*?```|`[^`]*`/g, ""))) notes.add("html", item.read.file);
      const summary = text(front.description) ?? text(front.summary) ?? text(front.excerpt);
      const image = text(front.image) ?? text(front.cover) ?? text(front.featured_image) ?? text(front.thumbnail);
      const values: Record<string, unknown> = {
        title: item.title,
        ...(hasDate && { date: dateOf(front.date, item.read.file) ?? "" }),
        ...(summary && { summary: shortened(summary) }),
        ...(image && { image: media(image) }),
        ...(categories.size > 0 && {
          categories: listOf(front.categories, front.category).flatMap((word) => categories.get(word) ?? []),
        }),
        ...(tags.size > 0 && { tags: listOf(front.tags).flatMap((word) => tags.get(word) ?? []) }),
        body,
      };
      for (const [key, value] of Object.entries(front)) {
        const name = slugify(key);
        if (!kept.has(name)) continue;
        values[name] = typeof value === "number" ? String(value) : value;
      }
      changes.push(entryFileChange(written, item.slug, values, undefined));
    }

    // A page listing the items, where their addresses start, unless the site or the import has one there.
    if (collection.list && !listsWritten.has(collection.list) && !otherAddresses.has(collection.list)) {
      const writer = new BlockWriter("md");
      changes.push(
        pageFileChange(
          collection.list,
          {
            root: { props: { className: "", description: "", image: "", title: collection.name } },
            content: [
              writer.section(
                [
                  writer.heading(collection.name, "h1"),
                  writer.collectionList({ collection: collection.id, limit: 10, paginate: true, className: "mt-8" }),
                ],
                { width: "normal" },
              ),
            ],
          } as Data,
          undefined,
        ),
      );
      listsWritten.add(collection.list);
      otherAddresses.add(collection.list);
    }
    writtenCollections.push({
      id: collection.id,
      name: collection.name,
      path: collection.pattern,
      items: collection.items.length,
      ...(collection.list && listsWritten.has(collection.list) && { list: collection.list }),
    });
  }
  for (const name of leftOutFields) notes.add("fields", name);

  /* The main menu: the top-level pages, in their weight's order, then the lists of new collections. */
  let added = 0;
  if (options.menu) {
    const main = [...(content.menus.main ?? [])];
    const top = pages
      .filter((page) => page.path !== "/" && page.path.split("/").length === 2)
      .sort((a, b) => a.weight - b.weight || a.title.localeCompare(b.title));
    const items: MenuItem[] = [
      ...top.map((page) => ({ label: page.title, href: page.path })),
      ...writtenCollections.flatMap((collection) =>
        collection.list && collection.list.split("/").length === 2 && !importedPaths.has(collection.list)
          ? [{ label: collection.name, href: collection.list }]
          : [],
      ),
    ];
    for (const item of items) {
      if (main.some((existing) => existing.href === item.href)) continue;
      main.push(item);
      added += 1;
    }
    if (added > 0) {
      changes.push(menusFileChange({ menus: { ...content.menus, main }, languageMenus: content.languageMenus }));
    }
  }

  /* Redirects from the old addresses that changed. */
  const addresses = new Set([...allPages(content).map((page) => page.path), ...otherAddresses, ...listsWritten]);
  const redirects: Redirect[] = [];
  const addRedirect = (old: string, to: string) => {
    if (old === "/" || old === to) return;
    const from = redirectFrom(old);
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
  for (const [old, to] of byOld) addRedirect(old, to);
  for (const file of markdown) {
    const to = byFile.get(file.file);
    if (!to) continue;
    for (const alias of listOf(file.front.aliases, file.front.redirect_from)) addRedirect(alias, to);
  }
  if (redirects.length > 0) {
    const fresh = new Set(redirects.map((redirect) => redirect.from));
    changes.push(
      redirectsFileChange({
        redirects: [...(content.redirects ?? []).filter((redirect) => !fresh.has(redirect.from)), ...redirects],
        message: content.redirectMessage,
      }),
    );
  }

  return {
    changes,
    media: [...copies.values()],
    summary: {
      pages: pages.map((page) => page.path),
      replaced: content.pages.filter((page) => importedPaths.has(page.path)).map((page) => page.path),
      collections: writtenCollections,
      menu: added,
      redirects: redirects.length,
      drafts,
    },
    notes: notes.all(),
  };
}

/**
 * Markdown with its links' and pictures' addresses given by `link` and
 * `media`: inline ones, `[words](address)` and `![words](address)`, and
 * reference definitions, `[name]: address`. A link whose address goes is just
 * its words, and a picture whose address goes is left out. Code is left as it is.
 */
export function rewriteMarkdown(
  markdown: string,
  link: (address: string) => string,
  media: (address: string) => string,
): string {
  const pieces = markdown.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/);
  return pieces
    .map((piece, index) => {
      if (index % 2 === 1) return piece;
      return piece
        .replace(
          /(!?)\[((?:[^\]\\]|\\.)*)\]\(\s*<?([^)\s>]*)>?((?:\s+(?:"[^"]*"|'[^']*'))?)\s*\)/g,
          (_, bang: string, words_: string, address: string, title: string) => {
            const to = bang ? media(address) : link(address);
            if (to) return `${bang}[${words_}](${to}${title})`;
            return bang ? "" : words_;
          },
        )
        .replace(/^( {0,3}\[[^\]]+\]:[ \t]*)<?(\S+?)>?(?=[ \t]|$)/gm, (whole, start: string, address: string) => {
          const to = mediaKind(address.split(/[?#]/)[0] ?? "") ? media(address) : link(address);
          return to ? `${start}${to}` : whole.replace(address, "#");
        });
    })
    .join("");
}
