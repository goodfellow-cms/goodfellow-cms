/**
 * Moving content from one Goodfellow site to another: the zip **Download a
 * copy** makes (`content/`, `public/media/` and the records of installed
 * blocks and plugins) with `goodfellow-transfer.json` beside them, and the
 * plan that brings it into another site, adding to its content or replacing
 * it, with no disk or network access, so the admin panel and the command line
 * import the same way. Content files come across as they are, so nothing is
 * lost that the receiving site can show.
 */

import { mediaFileChange } from "./content/changes.js";
import type { Collection } from "./content/collections.js";
import { mediaDetailsOf } from "./content/credits.js";
import { ContentError } from "./content/errors.js";
import { allPages, type ContentSource, loadSiteContent, type SiteContent } from "./content/load.js";
import { type MediaStorage, mediaStorageFileSchema, withStoredAddresses } from "./content/media-storage.js";
import {
  COLLECTIONS_DIR,
  CONTENT_DIR,
  INSTALLED_PLUGINS_FILE,
  INSTALLED_RECORD_FILE,
  MEDIA_DIR,
  MEDIA_FILE,
  MEDIA_STORAGE_FILE,
  MENUS_FILE,
  PAGES_DIR,
  PERMISSIONS_FILE,
  REDIRECTS_FILE,
  SITE_FILE,
  SYNCED_BLOCKS_DIR,
  UPDATES_FILE,
} from "./content/paths.js";
import { type CollectionField, TITLE_FIELD } from "./content/schemas.js";
import { serializeContent } from "./content/serialize.js";
import type { FileChange } from "./content/store.js";
import { SYNCED_BLOCK } from "./content/synced-blocks.js";
import { type ContentKind, CURRENT_VERSION, MigrationError, migrateContent } from "./migrations/index.js";
import { GOODFELLOW_REGISTRY, parseInstalledRecord } from "./registry.js";
import { GOODFELLOW_VERSION } from "./site-description.js";

/** What an export says about itself, beside the site's files. */
export const TRANSFER_MANIFEST = "goodfellow-transfer.json";

/** The folders an export holds whole: the content and the media library. */
export const TRANSFER_FOLDERS = [CONTENT_DIR, MEDIA_DIR] as const;

/** Single files an export holds where the site has them: which blocks and plugins it installed. */
export const TRANSFER_RECORDS = [INSTALLED_RECORD_FILE, INSTALLED_PLUGINS_FILE] as const;

/**
 * Files an import never brings in, whatever is chosen, since they belong to
 * the site receiving it: editors' limits name its people, the update settings
 * are about its code, and which storage keeps its media is its own setup. The
 * Site address in `content/site.json` stays too (see `planSiteImport()`).
 */
export const NEVER_IMPORTED = [PERMISSIONS_FILE, UPDATES_FILE, MEDIA_STORAGE_FILE] as const;

export interface TransferManifest {
  version: 1;
  /** The site's title, for the import to name it. */
  title: string;
  /** The Goodfellow release that made it. */
  goodfellow: string;
  /** The version of each kind of content file it holds. */
  content: Partial<Record<ContentKind, number>>;
  /** When it was made. */
  made: string;
  /** The blocks its pages, templates, headers, footers and synced blocks use. */
  blocks: string[];
  /** Whether it holds the media library. */
  media: boolean;
}

/** The manifest of an export of a site. */
export function transferManifest(
  content: SiteContent,
  { now = new Date(), media = true }: { now?: Date; media?: boolean } = {},
): TransferManifest {
  const blocks = new Set<string>();
  for (const data of puckDataOf(content)) blockTypes(data, blocks);
  return {
    version: 1,
    title: content.settings.title ?? "",
    goodfellow: GOODFELLOW_VERSION,
    content: { ...CURRENT_VERSION },
    made: now.toISOString(),
    blocks: [...blocks].sort(),
    media,
  };
}

/** The manifest's file, to add to an export. */
export function transferManifestFile(
  content: SiteContent,
  options?: { now?: Date; media?: boolean },
): {
  path: string;
  content: string;
} {
  return { path: TRANSFER_MANIFEST, content: serializeContent(transferManifest(content, options)) };
}

/**
 * An export's file name: the site's title in plain letters, then the day,
 * `st-anne-parish-2026-11-01.zip`, or `site-…` for a title with none.
 */
export function transferName(title: string | undefined, date: Date): string {
  const slug =
    (title ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "site";
  const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return `${slug}-${day}.zip`;
}

/** The manifest from its text, or `undefined` where there's none or it can't be read. */
export function parseTransferManifest(text: string | undefined): TransferManifest | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as Partial<TransferManifest>;
    if (value?.version !== 1 || typeof value.content !== "object" || value.content === null) return undefined;
    return {
      version: 1,
      title: typeof value.title === "string" ? value.title : "",
      goodfellow: typeof value.goodfellow === "string" ? value.goodfellow : "",
      content: value.content,
      made: typeof value.made === "string" ? value.made : "",
      blocks: Array.isArray(value.blocks) ? value.blocks.filter((name) => typeof name === "string") : [],
      media: value.media !== false,
    };
  } catch {
    return undefined;
  }
}

/** Whether an export's file is one an import reads: content, media, the records and the manifest, at safe paths. */
export function isTransferPath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  if (path === TRANSFER_MANIFEST || (TRANSFER_RECORDS as readonly string[]).includes(path)) return true;
  return TRANSFER_FOLDERS.some((folder) => path.startsWith(`${folder}/`));
}

/**
 * Where an export's files are in an archive: at its top (`""`), or in one
 * folder (`"my-site/"`), as unpacking a zip and zipping the folder again
 * leaves them, or `undefined` where it holds no site.
 */
export function transferRoot(paths: readonly string[]): string | undefined {
  if (paths.some((path) => path === SITE_FILE || path === TRANSFER_MANIFEST || path.startsWith(`${PAGES_DIR}/`))) {
    return "";
  }
  const roots = paths
    .filter((path) => path.endsWith(`/${SITE_FILE}`) || path.endsWith(`/${TRANSFER_MANIFEST}`))
    .map((path) => path.slice(0, path.lastIndexOf(path.endsWith(TRANSFER_MANIFEST) ? TRANSFER_MANIFEST : SITE_FILE)))
    .sort((a, b) => a.length - b.length);
  return roots[0];
}

/**
 * The files of an export, by their paths in the site, from an archive's
 * paths: under its root, and only those an import reads (`isTransferPath()`).
 * Gives each site path's archive path, to read it by.
 */
export function transferPaths(archivePaths: readonly string[]): Map<string, string> {
  const root = transferRoot(archivePaths);
  const found = new Map<string, string>();
  if (root === undefined) return found;
  for (const path of archivePaths) {
    if (!path.startsWith(root) || path.endsWith("/")) continue;
    const inSite = path.slice(root.length);
    if (isTransferPath(inSite)) found.set(inSite, path);
  }
  return found;
}

/** The files of an export, by their paths in the site. */
export interface TransferFiles {
  paths: readonly string[];
  /** A text file's text, or `undefined` where the export has no such file. */
  read(path: string): string | undefined;
}

/** The site an export is brought into, as the admin panel or the command line has it. */
export interface ReceivingSite {
  content: SiteContent;
  /** Every file it has in `content/` and `public/media/`. */
  files: readonly string[];
  /** A file's text, to tell whether the export's is any different. */
  read(path: string): Promise<string | undefined>;
}

export interface SiteImportOptions {
  /**
   * Makes the site's content the export's: files the export doesn't have
   * are removed, apart from `NEVER_IMPORTED`. Otherwise the export's content
   * is added to the site's.
   */
  replace?: boolean;
  /** When adding: the conflicts (`SiteImportConflict.key`) to settle with the export's version rather than the site's. */
  take?: ReadonlySet<string>;
  /** When adding: also bring in the export's menus, merged by name. */
  menus?: boolean;
  /** When adding: also bring in Site Settings, the theme, custom CSS and code, and the admin panel's languages. */
  settings?: boolean;
  /** When adding: also bring in the header and footer. */
  layout?: boolean;
  /** When adding: also bring in the redirects the site doesn't have. */
  redirects?: boolean;
  /** The blocks the site has, by name. */
  blocks: readonly string[];
  /** Blocks being installed in the same publish, which count as the site's. */
  installing?: readonly string[];
  /** Brings in pages and the rest that use blocks the site doesn't have, without those blocks, rather than leaving them out. */
  withoutMissingBlocks?: boolean;
  /** The plugins the site has, by package name, so the notes list only the export's others. */
  plugins?: readonly string[];
  /** Media files the export and the site both have with the same bytes, which needn't be copied or asked about. */
  sameMedia?: ReadonlySet<string>;
  /** Media files the caller can't copy, such as ones over the upload limit, which are left out with a note. */
  uncopied?: ReadonlySet<string>;
}

/** Something the export and the site both have, differently, for the person to choose between. */
export interface SiteImportConflict {
  /** What `take` names it by. */
  key: string;
  kind: "page" | "item" | "collection" | "synced-block" | "media";
  /** What it's called: a page's title, an item's title, a collection's or synced block's name, a file's address. */
  name: string;
  /** Where it is: a page's or item's address, an item's collection. */
  detail?: string;
}

/** A block the export uses that the site doesn't have, which Goodfellow's registry can add. */
export interface InstallableBlock {
  name: string;
  /** What to install, such as `@goodfellow/shadcn-faq`. */
  source: string;
  title: string;
}

export type SiteImportNote =
  /** Blocks the site doesn't have, and what uses them. */
  | { kind: "missing-block"; name: string; items: string[]; installable: boolean }
  /** What's left out because it uses blocks the site doesn't have. */
  | { kind: "left-out"; items: string[] }
  /** What comes in without the blocks the site doesn't have. */
  | { kind: "without-blocks"; items: string[] }
  /** New pages and items at addresses the site's pages or items already have, left out. */
  | { kind: "taken"; items: string[] }
  /** Collections the site has with other fields, whose items are left out unless the export's collection is taken whole. */
  | { kind: "collection-differs"; collections: string[] }
  /** Media files left out, too large to copy. */
  | { kind: "uncopied"; files: string[] }
  /** Media the export's storage keeps, which isn't in it: content links to where it's kept. */
  | { kind: "stored-media"; count: number; merged: boolean }
  /** The export's other languages, added to the site so its pages in them load. */
  | { kind: "languages"; codes: string[] }
  /** The export's plugins, which aren't installed. */
  | { kind: "plugins"; names: string[] }
  /** Custom code comes in, which runs on every page. */
  | { kind: "code" }
  /** What stays as the site has it, whatever the export says. */
  | { kind: "kept"; things: ("address" | "limits" | "updates" | "storage")[] };

export interface SiteImport {
  /** Text files to write and files to remove. */
  changes: FileChange[];
  /** Media files to copy from the export, at the same path in the site. */
  media: string[];
  /** When adding: what the export and the site both have, differently. */
  conflicts: SiteImportConflict[];
  /** Missing blocks Goodfellow's registry can add. */
  installable: InstallableBlock[];
  summary: {
    title: string;
    /** Pages written. */
    pages: number;
    /** Collection items written. */
    items: number;
    /** Collections added, or taken whole. */
    collections: number;
    syncedBlocks: number;
    media: number;
    /** Files removed when replacing. */
    removed: number;
    menus: boolean;
    settings: boolean;
    layout: boolean;
    redirects: boolean;
  };
  notes: SiteImportNote[];
  manifest?: TransferManifest;
}

export type SiteImportProblem = "not-a-site" | "newer" | "invalid";

/** Why an export can't be brought in, for the admin panel to explain. */
export class SiteImportError extends Error {
  override name = "SiteImportError";
  constructor(
    readonly problem: SiteImportProblem,
    readonly detail?: string,
  ) {
    super(
      problem === "not-a-site"
        ? "This isn't an export of a Goodfellow site: it has no content/site.json or content/pages/."
        : problem === "newer"
          ? `This export was made with a newer release of Goodfellow${detail && /^\d/.test(detail) ? ` (${detail})` : ""}. Update this site first.`
          : `Some of the export's content files can't be read${detail ? `: ${detail}` : "."}`,
    );
  }
}

/** Every Puck data a site has: pages, templates, headers, footers and synced blocks. */
function puckDataOf(content: SiteContent): unknown[] {
  return [
    ...content.pages.map((page) => page.content.data),
    ...content.collections.map((collection) => collection.settings.template),
    content.header.data,
    content.footer.data,
    ...Object.values(content.languageLayouts ?? {}).flatMap((own) => [own.header?.data, own.footer?.data]),
    ...(content.syncedBlocks ?? []).flatMap((block) => [
      block.content.data,
      ...Object.values(block.languages ?? {}).map((own) => own.content.data),
    ]),
  ].filter((data) => data !== undefined);
}

/** Whether a value is a placed block: a `type` with `props`. */
function isBlock(value: unknown): value is { type: string; props: Record<string, unknown> } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string" &&
    Boolean((value as { props?: unknown }).props) &&
    typeof (value as { props?: unknown }).props === "object"
  );
}

/** The blocks Puck data uses, in slots and drop zones too. */
function blockTypes(value: unknown, into: Set<string>): Set<string> {
  if (Array.isArray(value)) for (const item of value) blockTypes(item, into);
  else if (value && typeof value === "object") {
    if (isBlock(value)) into.add(value.type);
    for (const item of Object.values(value)) blockTypes(item, into);
  }
  return into;
}

/** Puck data without the blocks named, wherever they are. */
function withoutBlocks<T>(value: T, names: ReadonlySet<string>): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isBlock(item) && names.has(item.type)))
      .map((item) => withoutBlocks(item, names)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutBlocks(item, names)])) as T;
  }
  return value;
}

/** A content file's text in canonical form, where it's JSON, to tell whether two say the same. */
function canonical(path: string, text: string): string {
  if (!path.endsWith(".json")) return text.replace(/\r\n/g, "\n");
  try {
    return serializeContent(JSON.parse(text));
  } catch {
    return text;
  }
}

/** The kind of content file a path is, for bringing an older one up to date. */
function kindOf(path: string): ContentKind | undefined {
  if (path === SITE_FILE) return "site";
  if (path === MENUS_FILE) return "menus";
  if (path === REDIRECTS_FILE) return "redirects";
  if (path === MEDIA_FILE) return "media";
  return undefined;
}

/** A JSON content file, brought up to date, or `undefined` where there's none. */
function parsed(path: string, text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  const value = JSON.parse(text) as Record<string, unknown>;
  const kind = kindOf(path);
  return kind ? migrateContent(kind, value) : value;
}

/** Whether every field of the export's collection is one the site's collection has as it is, so its items fit there. */
function itemsFit(from: Collection, into: Collection): boolean {
  if (from.settings.markdown?.body !== into.settings.markdown?.body) return false;
  const fields = new Map(into.settings.fields.map((field) => [field.name, field]));
  return from.settings.fields.every((field) => {
    const own = fields.get(field.name);
    return own !== undefined && fieldFits(field, own);
  });
}

function fieldFits(field: CollectionField, own: CollectionField): boolean {
  if (
    field.type !== own.type ||
    field.collection !== own.collection ||
    Boolean(field.multiple) !== Boolean(own.multiple)
  ) {
    return false;
  }
  const choices = new Set((own.options ?? []).map((option) => option.value));
  if (!(field.options ?? []).every((option) => choices.has(option.value))) return false;
  const rows = new Map((own.fields ?? []).map((row) => [row.name, row.type]));
  return (field.fields ?? []).every((row) => rows.get(row.name) === row.type);
}

const sameJson = (a: unknown, b: unknown) => serializeContent(a) === serializeContent(b);

/**
 * Works out the changes that bring an export of another Goodfellow site into
 * this one. The export is loaded as a site would be first, so older content
 * is brought up to date and anything newer than this release reads is
 * refused (`SiteImportError`).
 *
 * Adding (the default) brings in pages, collections and their items, synced
 * blocks and media, and, where chosen, menus, Site Settings, the header and
 * footer, and redirects. What the site already has, differently, is a
 * conflict, kept as the site has it unless `take` names it; a collection the
 * site has with other fields brings in its items only where they fit, or
 * whole, replacing the site's, when taken. Replacing makes the site's content
 * the export's and removes the rest.
 *
 * Either way, `NEVER_IMPORTED` and the Site address stay as the site has
 * them; pages and the rest using blocks the site doesn't have are left out,
 * or brought in without them (`withoutMissingBlocks`); and media the export's
 * storage plugin keeps is linked where it's kept, or listed in the site's
 * storage where that's the same.
 */
export async function planSiteImport(
  files: TransferFiles,
  site: ReceivingSite,
  options: SiteImportOptions,
): Promise<SiteImport> {
  const exported = new Set(files.paths.filter(isTransferPath));
  if (!exported.has(SITE_FILE) && ![...exported].some((path) => path.startsWith(`${PAGES_DIR}/`))) {
    throw new SiteImportError("not-a-site");
  }
  const manifest = parseTransferManifest(files.read(TRANSFER_MANIFEST));
  for (const [kind, version] of Object.entries(manifest?.content ?? {})) {
    const reads = CURRENT_VERSION[kind as ContentKind];
    if (reads !== undefined && typeof version === "number" && version > reads) {
      throw new SiteImportError("newer", manifest?.goodfellow);
    }
  }

  // Media the export's storage keeps isn't in it: content links to where it's kept, or the site's storage lists it where it's the same.
  let storage: MediaStorage | undefined;
  try {
    const text = files.read(MEDIA_STORAGE_FILE);
    const found = text === undefined ? undefined : mediaStorageFileSchema.safeParse(JSON.parse(text));
    if (found?.success && Object.keys(found.data.files).length > 0) storage = found.data;
  } catch {
    // Content keeps its addresses.
  }
  const own = site.content.mediaStorage;
  const sameStorage =
    storage !== undefined &&
    own !== undefined &&
    own.plugin === storage.plugin &&
    own.url.replace(/\/+$/, "") === storage.url.replace(/\/+$/, "");
  const never = new Set<string>(NEVER_IMPORTED);
  const read = (path: string): string | undefined => {
    if (!exported.has(path) || never.has(path)) return undefined;
    const text = files.read(path);
    return text !== undefined && storage && !sameStorage && path.startsWith(`${CONTENT_DIR}/`)
      ? withStoredAddresses(text, storage)
      : text;
  };

  const source: ContentSource = {
    read: async (path) => read(path),
    list: async (dir) => [...exported].filter((path) => path.startsWith(`${dir}/`) && !never.has(path)),
  };
  let from: SiteContent;
  try {
    from = await loadSiteContent(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const newer =
      error instanceof MigrationError ||
      (error instanceof ContentError && error.problems.some((problem) => /newer version/.test(problem.message)));
    throw new SiteImportError(newer ? "newer" : "invalid", message);
  }

  const into = site.content;
  const replace = options.replace === true;
  const take = options.take ?? new Set<string>();
  const sameMedia = options.sameMedia ?? new Set<string>();
  const uncopied = options.uncopied ?? new Set<string>();
  const siteFiles = new Set(site.files);
  const out = new Map<string, FileChange>();
  const conflicts: SiteImportConflict[] = [];
  const notes: SiteImportNote[] = [];
  const media: string[] = [];
  /** Files the site keeps whatever replacing would do, since what would replace them is left out. */
  const protect = new Set<string>();
  const summary: SiteImport["summary"] = {
    title: manifest?.title || from.settings.title || "",
    pages: 0,
    items: 0,
    collections: 0,
    syncedBlocks: 0,
    media: 0,
    removed: 0,
    menus: false,
    settings: false,
    layout: false,
    redirects: false,
  };

  /** Writes a text file where it differs from the site's, saying whether it did. */
  const write = async (path: string, text: string): Promise<boolean> => {
    const current = siteFiles.has(path) ? await site.read(path) : undefined;
    if (current !== undefined && canonical(path, current) === canonical(path, text)) return false;
    out.set(path, { path, content: text });
    return true;
  };
  const remove = (path: string) => {
    if (siteFiles.has(path)) out.set(path, { path, delete: true });
  };

  // Blocks the site doesn't have.
  const has = new Set([...options.blocks, ...(options.installing ?? []), SYNCED_BLOCK]);
  const missing = new Map<string, Set<string>>();
  const leftOut: string[] = [];
  const stripped: string[] = [];
  /**
   * A file holding Puck data as it comes in: as it is, without the blocks the
   * site doesn't have, or `undefined` where it's left out for them.
   */
  const withSiteBlocks = (path: string, key: "data" | "template", label: string): string | undefined => {
    const text = read(path);
    if (text === undefined) return undefined;
    const file = JSON.parse(text) as Record<string, unknown>;
    const lacking = [...blockTypes(file[key], new Set())].filter((name) => !has.has(name));
    if (lacking.length === 0) return text;
    for (const name of lacking) missing.set(name, (missing.get(name) ?? new Set()).add(label));
    if (!options.withoutMissingBlocks) {
      leftOut.push(label);
      return undefined;
    }
    stripped.push(label);
    return serializeContent({ ...file, [key]: withoutBlocks(file[key], new Set(lacking)) });
  };

  // Addresses the site's pages and items have, by the file that has them.
  const addresses = new Map(allPages(into).map((page) => [page.path, page.file]));
  const taken: string[] = [];
  const takenBy = (path: string | undefined, file: string) => {
    if (replace || path === undefined) return false;
    const owner = addresses.get(path);
    return owner !== undefined && owner !== file;
  };
  const pageTitle = (data: unknown, fallback: string) => {
    const title = (data as { root?: { props?: { title?: unknown } } })?.root?.props?.title;
    return typeof title === "string" && title ? title : fallback;
  };

  // Pages.
  for (const page of from.pages) {
    const title = pageTitle(page.content.data, page.path);
    const label = `${title} (${page.path})`;
    const text = withSiteBlocks(page.file, "data", label);
    if (text === undefined) {
      protect.add(page.file);
      continue;
    }
    const existing = into.pages.find((candidate) => candidate.file === page.file);
    if (!replace && existing) {
      if (!(await differs(page.file, text))) continue;
      const key = `page:${page.file}`;
      conflicts.push({ key, kind: "page", name: title, detail: page.path });
      if (!take.has(key)) continue;
    } else if (!existing && takenBy(page.path, page.file)) {
      taken.push(label);
      continue;
    }
    if (await write(page.file, text)) summary.pages += 1;
  }

  // Collections and their items.
  const differing: string[] = [];
  for (const collection of from.collections) {
    const name = collection.settings.name;
    const settings = withSiteBlocks(collection.file, "template", name);
    if (settings === undefined) {
      protect.add(collection.file);
      for (const path of site.files) if (path.startsWith(`${COLLECTIONS_DIR}/${collection.id}/`)) protect.add(path);
      for (const entry of collection.entries) protect.add(entry.file);
      continue;
    }
    const existing = into.collections.find((candidate) => candidate.id === collection.id);
    let whole = replace || existing === undefined;
    if (!whole && existing && !sameJson(collection.settings, existing.settings)) {
      const key = `collection:${collection.id}`;
      conflicts.push({ key, kind: "collection", name });
      if (take.has(key)) whole = true;
      else if (!itemsFit(collection, existing)) {
        differing.push(name);
        continue;
      }
    }
    if (whole) {
      if (await write(collection.file, settings)) {
        if (!replace) summary.collections += 1;
      }
      for (const entry of collection.entries) {
        const text = read(entry.file);
        if (text === undefined) continue;
        const label = itemLabel(collection, entry.content.fields, entry.slug);
        if (!existing && takenBy(entry.path, entry.file)) {
          taken.push(label);
          continue;
        }
        if (await write(entry.file, text)) summary.items += 1;
      }
      // Taken whole: the site's items the export doesn't have go, as do ones it keeps in another format.
      if (existing && !replace) {
        const kept = new Set(collection.entries.map((entry) => entry.file));
        for (const entry of existing.entries) if (!kept.has(entry.file)) remove(entry.file);
      }
      continue;
    }
    // The site's collection, with the export's items added.
    for (const entry of collection.entries) {
      const text = read(entry.file);
      if (text === undefined || !existing) continue;
      const label = itemLabel(collection, entry.content.fields, entry.slug);
      const mine = existing.entries.find((candidate) => candidate.slug === entry.slug);
      if (mine) {
        if (mine.file === entry.file && !(await differs(entry.file, text))) continue;
        const key = `item:${collection.id}/${entry.slug}`;
        conflicts.push({ key, kind: "item", name: titleOf(entry.content.fields, entry.slug), detail: name });
        if (!take.has(key)) continue;
        if (mine.file !== entry.file) remove(mine.file);
      } else if (takenBy(entry.path, entry.file)) {
        taken.push(label);
        continue;
      }
      if (await write(entry.file, text)) summary.items += 1;
    }
  }

  // Synced blocks.
  for (const block of from.syncedBlocks ?? []) {
    const label = block.content.title || block.name;
    const own = [block.file, ...Object.values(block.languages ?? {}).map((language) => language.file)];
    const texts = own.map((path) => [path, withSiteBlocks(path, "data", label)] as const);
    if (texts.some(([, text]) => text === undefined)) {
      for (const path of own) protect.add(path);
      continue;
    }
    const existing = into.syncedBlocks?.find((candidate) => candidate.name === block.name);
    const existingFiles = existing
      ? [existing.file, ...Object.values(existing.languages ?? {}).map((language) => language.file)]
      : [];
    if (!replace && existing) {
      let changed = existingFiles.some((path) => !own.includes(path));
      for (const [path, text] of texts) if (!changed && (await differs(path, text as string))) changed = true;
      if (!changed) continue;
      const key = `synced-block:${block.name}`;
      conflicts.push({ key, kind: "synced-block", name: label });
      if (!take.has(key)) continue;
      for (const path of existingFiles) if (!own.includes(path)) remove(path);
    }
    let wrote = false;
    for (const [path, text] of texts) if (await write(path, text as string)) wrote = true;
    if (wrote) summary.syncedBlocks += 1;
  }

  // The header and footer.
  if (replace || options.layout) {
    for (const path of [...exported].filter((file) => file.startsWith(`${CONTENT_DIR}/layout/`)).sort()) {
      const text = withSiteBlocks(path, "data", path.slice(`${CONTENT_DIR}/layout/`.length).replace(/\.json$/, ""));
      if (text === undefined) {
        protect.add(path);
        continue;
      }
      if (await write(path, text)) summary.layout = true;
    }
  }

  // Site Settings, the theme, custom CSS and code, and the admin panel's languages.
  const settingsFiles = [...exported].filter((path) =>
    ["content/styles/", "content/code/", "content/admin-text/"].some((folder) => path.startsWith(folder)),
  );
  const siteSettings = parsed(SITE_FILE, siteFiles.has(SITE_FILE) ? await site.read(SITE_FILE) : undefined) ?? {
    version: CURRENT_VERSION.site,
  };
  const theirs = parsed(SITE_FILE, read(SITE_FILE));
  if (theirs && (replace || options.settings)) {
    const next: Record<string, unknown> = { ...theirs };
    // The Site address is the site's own: sign-in gives tokens to it.
    if (siteSettings.url === undefined) delete next.url;
    else next.url = siteSettings.url;
    if (!replace) {
      next.languages = mergedLanguages(theirs.languages, siteSettings.languages);
      next.translations = { ...(siteSettings.translations as object), ...(theirs.translations as object) };
      for (const key of ["languages", "translations"]) {
        const value = next[key];
        if (value === undefined || (typeof value === "object" && value && Object.keys(value).length === 0)) {
          delete next[key];
        }
      }
    }
    if (await write(SITE_FILE, serializeContent(next))) summary.settings = true;
    for (const path of settingsFiles) {
      const text = read(path);
      if (text !== undefined && (await write(path, text))) summary.settings = true;
    }
  } else if (theirs) {
    // The export's other languages come along, so its pages in them load.
    const known = new Set(
      ((siteSettings.languages as { code: string }[] | undefined) ?? []).map((language) => language.code),
    );
    const added = ((theirs.languages as { code: string }[] | undefined) ?? []).filter(
      (language) => !known.has(language.code),
    );
    if (added.length > 0) {
      await write(
        SITE_FILE,
        serializeContent({ ...siteSettings, languages: mergedLanguages(siteSettings.languages, added) }),
      );
      notes.push({ kind: "languages", codes: added.map((language) => language.code) });
    }
  }

  // Menus, merged by name, each language's too.
  const theirMenus = parsed(MENUS_FILE, read(MENUS_FILE));
  if (theirMenus && (replace || options.menus)) {
    let next = theirMenus;
    if (!replace) {
      const ownMenus = parsed(MENUS_FILE, siteFiles.has(MENUS_FILE) ? await site.read(MENUS_FILE) : undefined) ?? {
        version: CURRENT_VERSION.menus,
        menus: {},
      };
      const languages: Record<string, unknown> = { ...(ownMenus.languages as object) };
      for (const [code, menus] of Object.entries((theirMenus.languages as Record<string, object>) ?? {})) {
        languages[code] = { ...(languages[code] as object), ...menus };
      }
      next = {
        ...ownMenus,
        menus: { ...(ownMenus.menus as object), ...(theirMenus.menus as object) },
        ...(Object.keys(languages).length > 0 && { languages }),
      };
    }
    if (await write(MENUS_FILE, serializeContent(next))) summary.menus = true;
  }

  // Redirects: the export's, or those the site doesn't have.
  const theirRedirects = parsed(REDIRECTS_FILE, read(REDIRECTS_FILE));
  if (theirRedirects && (replace || options.redirects)) {
    let next = theirRedirects;
    if (!replace) {
      const ownRedirects = parsed(
        REDIRECTS_FILE,
        siteFiles.has(REDIRECTS_FILE) ? await site.read(REDIRECTS_FILE) : undefined,
      ) ?? { version: CURRENT_VERSION.redirects, redirects: [] };
      const list = (ownRedirects.redirects as { from: string }[]) ?? [];
      const from = new Set(list.map((redirect) => redirect.from));
      next = {
        ...theirRedirects,
        ...ownRedirects,
        redirects: [
          ...list,
          ...((theirRedirects.redirects as { from: string }[]) ?? []).filter((redirect) => !from.has(redirect.from)),
        ],
      };
    }
    if (await write(REDIRECTS_FILE, serializeContent(next))) summary.redirects = true;
  }

  // Media, and what the media library says about it.
  const brought: string[] = [];
  const notCopied: string[] = [];
  for (const path of [...exported].filter((file) => file.startsWith(`${MEDIA_DIR}/`)).sort()) {
    if (uncopied.has(path)) {
      notCopied.push(`/media/${path.slice(MEDIA_DIR.length + 1)}`);
      protect.add(path);
      continue;
    }
    if (siteFiles.has(path) && sameMedia.has(path)) continue;
    if (!replace && siteFiles.has(path)) {
      const key = `media:${path}`;
      conflicts.push({ key, kind: "media", name: `/media/${path.slice(MEDIA_DIR.length + 1)}` });
      if (!take.has(key)) continue;
    }
    media.push(path);
    brought.push(`/media/${path.slice(MEDIA_DIR.length + 1)}`);
  }
  summary.media = media.length;
  if (replace) {
    const text = read(MEDIA_FILE);
    if (text !== undefined) await write(MEDIA_FILE, text);
  } else if (brought.length > 0) {
    const details = mediaDetailsOf(into);
    const theirDetails = mediaDetailsOf(from);
    const next = {
      credits: { ...details.credits },
      descriptions: { ...details.descriptions },
      focus: { ...details.focus },
      tags: { ...details.tags },
    };
    let changed = false;
    for (const url of brought) {
      for (const part of ["credits", "descriptions", "focus", "tags"] as const) {
        const record = next[part] as Record<string, unknown>;
        const theirsHere = (theirDetails[part] as Record<string, unknown> | undefined)?.[url];
        if (url in record || theirsHere !== undefined) changed = true;
        delete record[url];
        if (theirsHere !== undefined) record[url] = theirsHere;
      }
    }
    if (changed) {
      const change = mediaFileChange(next);
      if ("delete" in change) remove(MEDIA_FILE);
      else if ("content" in change) await write(MEDIA_FILE, change.content);
    }
  }
  if (storage) {
    if (sameStorage && own) {
      const added = Object.entries(storage.files).filter(([address]) => !Object.hasOwn(own.files, address));
      if (added.length > 0) {
        const current = parsed(MEDIA_STORAGE_FILE, await site.read(MEDIA_STORAGE_FILE)) ?? {};
        await write(
          MEDIA_STORAGE_FILE,
          serializeContent({ ...current, files: { ...own.files, ...Object.fromEntries(added) } }),
        );
      }
    }
    notes.push({ kind: "stored-media", count: Object.keys(storage.files).length, merged: sameStorage });
  }

  // Anything else the export has in its content folder.
  const known = (path: string) =>
    path === SITE_FILE ||
    path === MENUS_FILE ||
    path === REDIRECTS_FILE ||
    path === MEDIA_FILE ||
    never.has(path) ||
    path.startsWith(`${PAGES_DIR}/`) ||
    path.startsWith(`${COLLECTIONS_DIR}/`) ||
    path.startsWith(`${SYNCED_BLOCKS_DIR}/`) ||
    path.startsWith(`${CONTENT_DIR}/layout/`) ||
    settingsFiles.includes(path);
  for (const path of [...exported].filter((file) => file.startsWith(`${CONTENT_DIR}/`) && !known(file))) {
    if (!replace && siteFiles.has(path)) continue;
    const text = read(path);
    if (text !== undefined) await write(path, text);
  }

  // Replacing: what the export doesn't have goes.
  if (replace) {
    for (const path of site.files) {
      if (!TRANSFER_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) continue;
      if (never.has(path) || protect.has(path) || out.has(path) || exported.has(path)) continue;
      remove(path);
      summary.removed += 1;
    }
  }

  // What the notes say.
  let record: ReturnType<typeof parseInstalledRecord> | undefined;
  try {
    record = parseInstalledRecord(files.read(INSTALLED_RECORD_FILE));
  } catch {
    record = undefined;
  }
  const installable: InstallableBlock[] = [];
  for (const [name, items] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    const installed = record?.blocks[name];
    const fromRegistry = installed?.source.startsWith(`${GOODFELLOW_REGISTRY}/`) === true;
    if (fromRegistry && installed) installable.push({ name, source: installed.source, title: installed.title });
    notes.push({ kind: "missing-block", name, items: [...items], installable: fromRegistry });
  }
  if (leftOut.length > 0) notes.push({ kind: "left-out", items: leftOut });
  if (stripped.length > 0) notes.push({ kind: "without-blocks", items: stripped });
  if (taken.length > 0) notes.push({ kind: "taken", items: taken });
  if (differing.length > 0) notes.push({ kind: "collection-differs", collections: differing });
  if (notCopied.length > 0) notes.push({ kind: "uncopied", files: notCopied });
  try {
    const text = files.read(INSTALLED_PLUGINS_FILE);
    const plugins = text === undefined ? [] : Object.keys((JSON.parse(text) as { plugins?: object }).plugins ?? {});
    const ours = new Set(options.plugins ?? []);
    const others = plugins.filter((name) => !ours.has(name)).sort();
    if (others.length > 0) notes.push({ kind: "plugins", names: others });
  } catch {
    // A record that can't be read names no plugins.
  }
  if ([...out.values()].some((change) => "content" in change && change.path.startsWith("content/code/"))) {
    notes.push({ kind: "code" });
  }
  const kept: ("address" | "limits" | "updates" | "storage")[] = [];
  if (typeof theirs?.url === "string" && theirs.url !== siteSettings.url) kept.push("address");
  if (exported.has(PERMISSIONS_FILE)) kept.push("limits");
  if (exported.has(UPDATES_FILE)) kept.push("updates");
  if (exported.has(MEDIA_STORAGE_FILE) && !sameStorage) kept.push("storage");
  if (kept.length > 0) notes.push({ kind: "kept", things: kept });

  return {
    changes: [...out.values()].sort((a, b) => a.path.localeCompare(b.path)),
    media,
    conflicts,
    installable,
    summary,
    notes,
    ...(manifest && { manifest }),
  };

  async function differs(path: string, text: string): Promise<boolean> {
    const current = siteFiles.has(path) ? await site.read(path) : undefined;
    return current === undefined || canonical(path, current) !== canonical(path, text);
  }
}

/** The export's languages first, then the site's others, each code once. */
function mergedLanguages(first: unknown, second: unknown): { code: string }[] | undefined {
  const list = [
    ...((first as { code: string }[] | undefined) ?? []),
    ...((second as { code: string }[] | undefined) ?? []),
  ];
  const seen = new Set<string>();
  const merged = list.filter((language) => {
    const code = language.code.toLowerCase();
    if (seen.has(code)) return false;
    seen.add(code);
    return true;
  });
  return merged.length > 0 ? merged : undefined;
}

function titleOf(fields: Record<string, unknown>, slug: string): string {
  const title = fields[TITLE_FIELD];
  return typeof title === "string" && title ? title : slug;
}

function itemLabel(collection: Collection, fields: Record<string, unknown>, slug: string): string {
  return `${titleOf(fields, slug)} (${collection.settings.name})`;
}
