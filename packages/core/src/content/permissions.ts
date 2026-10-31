/**
 * What each editor may change (`content/permissions.json`): some pages, by
 * address; some collections; the media library; the header and footer; the
 * menus; and the languages they work in. People the file doesn't list may
 * change everything their role allows, so a site without the file works as
 * before. It also names who reviews changes made outside those limits, every
 * owner where it names nobody.
 *
 * Only owners change the file (`isSettingsPath()` covers it). On a static
 * site, editors sign in to the git host themselves, so the admin panel's
 * check stops mistakes, not someone acting on purpose; full-stack sites'
 * servers check every write.
 */
import { z } from "zod";
import type { Collection, Entry } from "./collections.js";
import { entryLanguage, mainLanguage, pathLanguage } from "./languages.js";
import {
  type ContentSource,
  type Page,
  parseContentFile,
  parseEntryFile,
  readTextFiles,
  type SiteContent,
} from "./load.js";
import {
  COLLECTION_SETTINGS_FILE,
  COLLECTIONS_DIR,
  FOOTER_FILE,
  HEADER_FILE,
  MEDIA_DIR,
  MEDIA_FILE,
  MEDIA_STORAGE_FILE,
  MENUS_FILE,
  PAGES_DIR,
  PERMISSIONS_FILE,
  pageFileToPath,
  SITE_FILE,
} from "./paths.js";
import { collectionFileSchema, menusFileSchema, pageFileSchema, siteSettingsSchema } from "./schemas.js";
import { serializeContent } from "./serialize.js";
import type { FileChange } from "./store.js";

/** A page address limits can name: `/` for every page, or a section such as `/news`, with what's under it. */
function isPageSection(address: string): boolean {
  return address === "/" || /^(\/[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(address);
}

export const editorLimitsSchema = z.object({
  /** Pages by address, each with what's under it: `/news` covers `/news/2026`. `/` is every page. */
  pages: z.array(z.string().refine(isPageSection, "must be a page's address, such as /news")).optional(),
  /** Collections, by their folder's name, such as `news`: their items, not their settings. */
  collections: z.array(z.string().min(1)).optional(),
  /** The media library: uploads, their credits and media kept by a plugin. */
  media: z.boolean().optional(),
  /** The header and footer, and synced blocks, which pages share as they do the header. */
  layout: z.boolean().optional(),
  /** The menus. */
  menus: z.boolean().optional(),
  /** Only pages, items, headers, footers and menus in these languages, by code. Missing means every language. */
  languages: z.array(z.string().min(1)).optional(),
});

export const permissionsFileSchema = z.object({
  version: z.literal(1),
  /** Each limited editor's limits, by their sign-in name on the git host, or a full-stack site's own. */
  people: z.record(z.string().min(1), editorLimitsSchema).default({}),
  /** Who reviews changes made outside someone's limits. Missing means every owner. */
  reviewers: z.array(z.string().min(1)).optional(),
});

export type EditorLimits = z.output<typeof editorLimitsSchema>;
export type PermissionsFile = z.output<typeof permissionsFileSchema>;
/** The permissions as the site has them loaded. */
export type Permissions = Omit<PermissionsFile, "version">;

/** Sign-in names compare without case, as GitHub's, GitLab's and Bitbucket's do. */
function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Someone's limits, or `undefined` where they have none and may change everything their role allows. */
export function limitsFor(permissions: Permissions | undefined, login: string | undefined): EditorLimits | undefined {
  if (!permissions || !login) return undefined;
  const found = Object.entries(permissions.people).find(([person]) => sameLogin(person, login));
  return found?.[1];
}

/** Whether a page's address is in a section limits name. */
function inSection(sections: readonly string[] | undefined, address: string): boolean {
  return (sections ?? []).some(
    (section) => section === "/" || address === section || address.startsWith(`${section}/`),
  );
}

function inLanguages(limits: EditorLimits, language: string): boolean {
  return !limits.languages || limits.languages.includes(language);
}

/**
 * Whether someone may change a page: its address, or the address of the main
 * language's page it translates, is in one of their sections, in one of their languages.
 */
export function mayChangePage(
  content: Pick<SiteContent, "settings">,
  limits: EditorLimits | undefined,
  page: { path: string; content?: { translationOf?: string | undefined } },
): boolean {
  if (!limits) return true;
  if (!inLanguages(limits, pathLanguage(content.settings, page.path))) return false;
  const source = page.content?.translationOf;
  return inSection(limits.pages, page.path) || (source !== undefined && inSection(limits.pages, source));
}

/** Whether someone may change a collection's items at all. */
export function mayChangeCollection(limits: EditorLimits | undefined, collection: string): boolean {
  return !limits || (limits.collections ?? []).includes(collection);
}

/** Whether someone may change one item: its collection is theirs, in one of their languages. */
export function mayChangeEntry(
  content: Pick<SiteContent, "settings">,
  limits: EditorLimits | undefined,
  entry: Pick<Entry, "collection" | "content">,
): boolean {
  if (!limits) return true;
  return mayChangeCollection(limits, entry.collection) && inLanguages(limits, entryLanguage(content.settings, entry));
}

/** Whether someone may change the media library. */
export function mayChangeMedia(limits: EditorLimits | undefined): boolean {
  return !limits || limits.media === true;
}

/** Whether someone may change the header and footer, or a language's own (the main language's where none is given). */
export function mayChangeLayout(
  content: Pick<SiteContent, "settings">,
  limits: EditorLimits | undefined,
  language?: string,
): boolean {
  if (!limits) return true;
  return limits.layout === true && inLanguages(limits, language ?? mainLanguage(content.settings));
}

/** Whether someone may change the menus, or a language's own (the main language's where none is given). */
export function mayChangeMenus(
  content: Pick<SiteContent, "settings">,
  limits: EditorLimits | undefined,
  language?: string,
): boolean {
  if (!limits) return true;
  return limits.menus === true && inLanguages(limits, language ?? mainLanguage(content.settings));
}

/** What checking changes against someone's limits reads of the site: the whole site, or `limitsContent()`'s part of it. */
export type LimitsContent = Pick<SiteContent, "settings" | "pages" | "collections" | "menus" | "languageMenus">;

/** What a change outside someone's limits touches, for saying so in words. */
export type LimitProblem =
  | { path: string; kind: "page"; address: string }
  | { path: string; kind: "entry"; collection: string; slug: string }
  | { path: string; kind: "media" }
  | { path: string; kind: "layout" }
  | { path: string; kind: "menus" }
  | { path: string; kind: "other" };

function changedText(change: FileChange): string | undefined {
  return "content" in change ? change.content : undefined;
}

function parsedJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The header's, footer's or a synced block's file's language, or `undefined`
 * for a file that isn't one. Synced blocks are site-wide like the header and
 * footer, so the same limit covers them.
 */
function layoutFileLanguage(content: Pick<SiteContent, "settings">, path: string): string | undefined {
  if (path === HEADER_FILE || path === FOOTER_FILE) return mainLanguage(content.settings);
  const layout = /^content\/layout\/(?:header|footer)\.([a-z]{2,3}(?:-[A-Za-z0-9]+)*)\.json$/.exec(path);
  if (layout) return layout[1];
  const synced = /^content\/synced-blocks\/[a-z0-9-]+(?:\.([a-z]{2,3}(?:-[A-Za-z0-9]+)*))?\.json$/.exec(path);
  return synced ? (synced[1] ?? mainLanguage(content.settings)) : undefined;
}

/** The languages whose menus a new `content/menus.json` changes, or `undefined` where it can't be read. */
function changedMenuLanguages(content: LimitsContent, text: string | undefined): string[] | undefined {
  const parsed = menusFileSchema.safeParse(parsedJson(text));
  if (!parsed.success) return undefined;
  const file = parsed.data;
  const same = (a: unknown, b: unknown) => serializeContent(a ?? {}) === serializeContent(b ?? {});
  const changed: string[] = [];
  if (!same(file.menus, content.menus)) changed.push(mainLanguage(content.settings));
  const languages = file.languages ?? {};
  const before = content.languageMenus ?? {};
  for (const code of new Set([...Object.keys(languages), ...Object.keys(before)])) {
    if (!same(languages[code], before[code])) changed.push(code);
  }
  return changed;
}

/** An item's file, as the collection it's in and its name, or `undefined` for any other file. */
function entryOf(path: string): { collection: string; slug: string } | undefined {
  if (!path.startsWith(`${COLLECTIONS_DIR}/`)) return undefined;
  const [collection, name, ...rest] = path.slice(COLLECTIONS_DIR.length + 1).split("/");
  if (!collection || !name || rest.length > 0 || name === COLLECTION_SETTINGS_FILE) return undefined;
  const slug = /^(.+)\.(?:json|md)$/.exec(name)?.[1];
  return slug ? { collection, slug } : undefined;
}

/** An item as a change leaves it, for its language, or as it was. */
function changedEntry(
  collection: Collection | undefined,
  path: string,
  change: FileChange,
): Pick<Entry, "content"> | undefined {
  const text = changedText(change);
  if (!collection || text === undefined) return undefined;
  const parsed = parseEntryFile(collection.settings, path, text);
  return parsed.ok ? { content: parsed.value } : undefined;
}

/**
 * The changes outside someone's limits, one problem for each file. Each file
 * is checked as it was and as the change leaves it, so moving a page out of
 * someone's section, or translating it into a language that isn't theirs, is
 * outside too. Files that are none of the things limits name, such as Site
 * Settings, redirects or the permissions themselves, are always outside: a
 * move that also points links on pages outside someone's sections at the new
 * address is outside as a whole, rather than half done.
 */
export function outsideLimits(
  content: LimitsContent,
  limits: EditorLimits | undefined,
  changes: readonly FileChange[],
): LimitProblem[] {
  if (!limits) return [];
  const problems: LimitProblem[] = [];
  for (const change of changes) {
    const { path } = change;
    if (path.startsWith(`${PAGES_DIR}/`) && path.endsWith(".json")) {
      let address: string;
      try {
        address = pageFileToPath(path);
      } catch {
        problems.push({ path, kind: "other" });
        continue;
      }
      const before = content.pages.find((page) => page.file === path);
      const after = parsedJson(changedText(change));
      const allowed =
        (!before || mayChangePage(content, limits, before)) &&
        ("delete" in change ||
          mayChangePage(content, limits, {
            path: address,
            content: { translationOf: typeof after?.translationOf === "string" ? after.translationOf : undefined },
          }));
      if (!allowed) problems.push({ path, kind: "page", address });
      continue;
    }
    const item = entryOf(path);
    if (item) {
      const collection = content.collections.find((found) => found.id === item.collection);
      const before = collection?.entries.find((entry) => entry.file === path);
      const after = changedEntry(collection, path, change);
      const allowed =
        mayChangeCollection(limits, item.collection) &&
        (!before || mayChangeEntry(content, limits, before)) &&
        (!after || mayChangeEntry(content, limits, { collection: item.collection, content: after.content }));
      if (!allowed) problems.push({ path, kind: "entry", ...item });
      continue;
    }
    if (path.startsWith(`${MEDIA_DIR}/`) || path === MEDIA_FILE || path === MEDIA_STORAGE_FILE) {
      if (!mayChangeMedia(limits)) problems.push({ path, kind: "media" });
      continue;
    }
    const layoutLanguage = layoutFileLanguage(content, path);
    if (layoutLanguage !== undefined) {
      if (!mayChangeLayout(content, limits, layoutLanguage)) problems.push({ path, kind: "layout" });
      continue;
    }
    if (path === MENUS_FILE) {
      const languages = "delete" in change ? undefined : changedMenuLanguages(content, changedText(change));
      const allowed = languages?.every((language) => mayChangeMenus(content, limits, language)) === true;
      if (!allowed) problems.push({ path, kind: "menus" });
      continue;
    }
    problems.push({ path, kind: "other" });
  }
  return problems;
}

/** The site's permissions, read from its one file, or `undefined` where it has none. A file that can't be read limits nobody, as loading the site refuses it. */
export async function readPermissions(source: ContentSource): Promise<Permissions | undefined> {
  const text = await source.read(PERMISSIONS_FILE);
  if (text === undefined) return undefined;
  const parsed = parseContentFile("permissions", permissionsFileSchema, PERMISSIONS_FILE, text);
  if (!parsed.ok) return undefined;
  const { people, reviewers } = parsed.value;
  return { people, ...(reviewers && { reviewers }) };
}

/**
 * The part of the site `outsideLimits()` reads for `changes`: its settings,
 * the pages and items they change as they are now, those items' collections'
 * settings and the menus, read in one go where the source can, so checking a
 * few changes never reads the whole site.
 */
export async function limitsContent(source: ContentSource, changes: readonly FileChange[]): Promise<LimitsContent> {
  const items = new Map<string, Set<string>>();
  for (const { path } of changes) {
    const item = entryOf(path);
    if (item) items.set(item.collection, (items.get(item.collection) ?? new Set()).add(path));
  }
  const settingsFiles = [...items.keys()].map((id) => `${COLLECTIONS_DIR}/${id}/${COLLECTION_SETTINGS_FILE}`);
  const pageFiles = changes
    .map((change) => change.path)
    .filter((path) => path.startsWith(`${PAGES_DIR}/`) && path.endsWith(".json"));
  const texts = await readTextFiles(source, [
    SITE_FILE,
    ...(changes.some((change) => change.path === MENUS_FILE) ? [MENUS_FILE] : []),
    ...pageFiles,
    ...settingsFiles,
    ...[...items.values()].flatMap((paths) => [...paths]),
  ]);
  const read = <T>(result: { ok: true; value: T } | { ok: false }): T | undefined =>
    result.ok ? result.value : undefined;
  const siteText = texts.get(SITE_FILE);
  const settings =
    (siteText !== undefined && read(parseContentFile("site", siteSettingsSchema, SITE_FILE, siteText))) ||
    siteSettingsSchema.parse({ version: 1 });
  const pages = pageFiles.flatMap((file): Page[] => {
    const text = texts.get(file);
    const content = text === undefined ? undefined : read(parseContentFile("page", pageFileSchema, file, text));
    return content ? [{ path: pageFileToPath(file), file, content }] : [];
  });
  const collections = [...items].flatMap(([id, paths]): Collection[] => {
    const file = `${COLLECTIONS_DIR}/${id}/${COLLECTION_SETTINGS_FILE}`;
    const text = texts.get(file);
    const collection =
      text === undefined ? undefined : read(parseContentFile("collection", collectionFileSchema, file, text));
    if (!collection) return [];
    const entries = [...paths].flatMap((path): Entry[] => {
      const entry = texts.get(path);
      const content = entry === undefined ? undefined : read(parseEntryFile(collection, path, entry));
      const slug = entryOf(path)?.slug;
      return content && slug ? [{ collection: id, slug, file: path, content }] : [];
    });
    return [{ id, file, settings: collection, entries }];
  });
  const menusText = texts.get(MENUS_FILE);
  const menus =
    menusText === undefined ? undefined : read(parseContentFile("menus", menusFileSchema, MENUS_FILE, menusText));
  return {
    settings,
    pages,
    collections,
    menus: menus?.menus ?? {},
    ...(menus?.languages && { languageMenus: menus.languages }),
  };
}

/** Who reviews changes made outside someone's limits: those the file names, else every owner. */
export function reviewersFor(permissions: Permissions | undefined, owners: readonly string[]): string[] {
  return permissions?.reviewers?.length ? [...permissions.reviewers] : [...owners];
}

/** `content/permissions.json`, as the admin panel's Editors screen writes it. */
export function permissionsFileChange(permissions: Permissions): FileChange {
  const people = Object.fromEntries(
    Object.entries(permissions.people)
      .filter(([, limits]) => limits !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    path: PERMISSIONS_FILE,
    content: serializeContent({
      version: 1,
      people,
      ...(permissions.reviewers?.length && { reviewers: permissions.reviewers }),
    }),
  };
}
