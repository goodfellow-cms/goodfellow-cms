/**
 * Building the file changes that saves are made of, so every change is written
 * in canonical form however it's made: the admin panel, the Claude connector
 * and anything else that edits a site use these.
 */
import type { ComponentConfig, Data } from "@puckeditor/core";
import { CURRENT_VERSION } from "../migrations/index.js";
import { updateSettingsFile } from "../updates.js";
import { storedCode } from "./code.js";
import { type Collection, cleanEntryValues, type Entry, isEmptyValue } from "./collections.js";
import { cleanTags, type MediaDetails } from "./credits.js";
import { changeItemLinks } from "./item-links.js";
import { entryPathIn } from "./languages.js";
import { relinkSite } from "./links.js";
import type { Page, SiteCode, SiteContent, SyncedBlock } from "./load.js";
import { serializeMarkdownEntry } from "./markdown.js";
import {
  BODY_CODE_FILE,
  CUSTOM_CSS_FILE,
  collectionSettingsFile,
  entryAddress,
  entryFile,
  FOOTER_FILE,
  HEAD_CODE_FILE,
  HEADER_FILE,
  isAddressSegment,
  isReservedPagePath,
  languageLayoutFile,
  MEDIA_FILE,
  MENUS_FILE,
  normalizePagePath,
  pagePathToFile,
  REDIRECTS_FILE,
  SITE_FILE,
  SLUG_PLACEHOLDER,
  syncedBlockFile,
  UPDATES_FILE,
} from "./paths.js";
import { type Redirect, redirectFrom } from "./redirects.js";
import { type FileDetails, fileDetailsOf } from "./schedule.js";
import {
  type CollectionField,
  type CollectionFile,
  type Menus,
  type SiteSettings,
  TITLE_FIELD,
  type UpdateSettings,
} from "./schemas.js";
import { serializeContent } from "./serialize.js";
import type { FileChange } from "./store.js";

/** `"Mass & Confession Times"` → `"mass-confession-times"`. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The title shown for a page in lists: its own title, or its address. */
export function pageTitle(page: Page): string {
  const title = page.content.data.root.props?.title;
  return typeof title === "string" && title.trim() ? title.trim() : page.path;
}

export type AddressProblem = "invalid" | "reserved" | "taken";

/**
 * Checks an address typed for a page. Returns the normalized path, or why it
 * can't be used. `current` is the page's existing address, if it has one.
 */
export function checkPageAddress(
  input: string,
  pages: Page[],
  current?: string,
): { ok: true; path: string } | { ok: false; problem: AddressProblem } {
  let path: string;
  try {
    path = normalizePagePath(input.trim().startsWith("/") ? input.trim() : `/${input.trim()}`);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (isReservedPagePath(path)) return { ok: false, problem: "reserved" };
  if (path !== current && pages.some((page) => page.path === path)) return { ok: false, problem: "taken" };
  return { ok: true, path };
}

/** Puck data as stored: Puck adds an empty `zones` object, which only adds noise to the file. */
export function storedData(data: Data): Data {
  if (!data.zones || Object.keys(data.zones).length > 0) return data;
  const { zones: _empty, ...rest } = data;
  return rest;
}

/**
 * Writes a page's file. `details` are when it's on the site and what it
 * translates: pass the page's own (`page.content`) to keep them, since
 * leaving them out shows the page straight away, as a page of its own.
 */
export function pageFileChange(path: string, data: Data, details: FileDetails | undefined): FileChange {
  // A page's language is its address, so its file doesn't say it.
  const { inLanguage: _language, ...kept } = fileDetailsOf(details ?? {});
  return {
    path: pagePathToFile(path),
    content: serializeContent({ version: CURRENT_VERSION.page, ...kept, data: storedData(data) }),
  };
}

export function layoutFileChange(file: string, data: Data): FileChange {
  return { path: file, content: serializeContent({ version: CURRENT_VERSION.layout, data: storedData(data) }) };
}

/** A new, empty page with just a title. */
export function newPageData(title: string): Data {
  return { root: { props: { title } }, content: [] };
}

/** A copy of a page's blocks and settings, as a new page with its own title. */
export function duplicatePageData(data: Data, title: string): Data {
  return { ...data, root: { ...data.root, props: { ...data.root.props, title } } };
}

/** Writes the menus: the main language's, and every other language's, which pass through unless they're given. */
export function menusFileChange({
  menus,
  languageMenus,
}: {
  menus: Menus;
  languageMenus?: Record<string, Menus>;
}): FileChange {
  const languages = Object.fromEntries(
    Object.entries(languageMenus ?? {}).filter(([, own]) => Object.keys(own).length > 0),
  );
  return {
    path: MENUS_FILE,
    content: serializeContent({
      version: CURRENT_VERSION.menus,
      menus,
      ...(Object.keys(languages).length > 0 && { languages }),
    }),
  };
}

/** The site's redirects as `content/redirects.json` holds them: the list, and what the page at an old address says. */
export interface SiteRedirects {
  redirects: Redirect[];
  message?: string;
}

/** Writes the site's redirects, deleting the file once there are none and no message of its own. */
export function redirectsFileChange({ redirects, message }: SiteRedirects): FileChange {
  const ownMessage = message?.trim();
  return redirects.length > 0 || ownMessage
    ? {
        path: REDIRECTS_FILE,
        content: serializeContent({
          version: CURRENT_VERSION.redirects,
          redirects,
          ...(ownMessage && { message: ownMessage }),
        }),
      }
    : { path: REDIRECTS_FILE, delete: true };
}

/**
 * `content/media.json` with these credits, descriptions, focal points and
 * tags, or its removal once no file has any. Files left with no tags lose
 * their entry.
 */
export function mediaFileChange(details: MediaDetails): FileChange {
  const credits = details.credits ?? {};
  const some = <T>(record: Record<string, T> | undefined) =>
    record && Object.keys(record).length > 0 ? record : undefined;
  const descriptions = some(details.descriptions);
  const focus = some(details.focus);
  const tags = some(
    Object.fromEntries(
      Object.entries(details.tags ?? {}).flatMap(([url, own]) => {
        const kept = cleanTags(own);
        return kept.length > 0 ? [[url, kept]] : [];
      }),
    ),
  );
  return Object.keys(credits).length > 0 || descriptions || focus || tags
    ? {
        path: MEDIA_FILE,
        content: serializeContent({
          version: CURRENT_VERSION.media,
          credits,
          ...(descriptions && { descriptions }),
          ...(focus && { focus }),
          ...(tags && { tags }),
        }),
      }
    : { path: MEDIA_FILE, delete: true };
}

/**
 * The change that drops what `content/media.json` says about files being
 * deleted or replaced, if it says anything. A replaced file keeps its tags
 * (`keepTags`), which say what it's for rather than what it shows.
 */
export function withoutMediaDetails(
  details: MediaDetails,
  urls: readonly string[],
  { keepTags = false }: { keepTags?: boolean } = {},
): FileChange | undefined {
  const has = (record: Record<string, unknown> | undefined) => record && urls.some((url) => url in record);
  if (!has(details.credits) && !has(details.descriptions) && !has(details.focus) && (keepTags || !has(details.tags))) {
    return undefined;
  }
  const without = <T>(record: Record<string, T> | undefined) =>
    record && Object.fromEntries(Object.entries(record).filter(([url]) => !urls.includes(url)));
  return mediaFileChange({
    credits: without(details.credits),
    descriptions: without(details.descriptions),
    focus: without(details.focus),
    tags: keepTags ? details.tags : without(details.tags),
  });
}

/**
 * The redirects once a page moves from `from` to `to`, with one from its old
 * address: redirects to the old address go to the new one, so visitors don't
 * go through two, and one from the new address goes, since the page has it now.
 */
export function movedPageRedirects(redirects: readonly Redirect[], from: string, to: string): Redirect[] {
  const at = (redirect: Redirect, path: string) => {
    const own = redirectFrom(redirect.from);
    return own.ok && own.path === path;
  };
  const kept = redirects
    .filter((redirect) => !at(redirect, to) && !at(redirect, from))
    // However the redirect writes the old address: /old/, /old?x or /old#top, keeping what's after it.
    .map((redirect) => {
      const target = redirect.to.startsWith("/") ? /^([^?#]*)(.*)$/.exec(redirect.to) : null;
      const path = target && redirectFrom(target[1] ?? "");
      return path?.ok && path.path === from ? { ...redirect, to: `${to}${target?.[2] ?? ""}` } : redirect;
    });
  return [...kept, { from, to }];
}

/**
 * The changes that write the files `relinkSite()` changed, from the site as it
 * left it, leaving out `skip`: files the caller writes itself, such as the
 * page being moved.
 */
export function relinkedChanges(
  relinked: { content: SiteContent; files: readonly string[] },
  skip: readonly string[] = [],
): FileChange[] {
  const { content } = relinked;
  return relinked.files
    .filter((file) => !skip.includes(file))
    .flatMap((file): FileChange[] => {
      if (file === HEADER_FILE || file === FOOTER_FILE) {
        const layout = file === HEADER_FILE ? content.header : content.footer;
        return [{ path: file, content: serializeContent({ ...layout, version: CURRENT_VERSION.layout }) }];
      }
      for (const [language, layouts] of Object.entries(content.languageLayouts ?? {})) {
        for (const part of ["header", "footer"] as const) {
          const layout = layouts[part];
          if (layout && file === languageLayoutFile(part, language)) {
            return [{ path: file, content: serializeContent({ ...layout, version: CURRENT_VERSION.layout }) }];
          }
        }
      }
      if (file === MENUS_FILE) return [menusFileChange(content)];
      for (const block of content.syncedBlocks ?? []) {
        if (file === block.file) return [syncedBlockFileChange(block.name, block.content.title, block.content.data)];
        for (const [language, own] of Object.entries(block.languages ?? {})) {
          if (file === own.file) {
            return [syncedBlockFileChange(block.name, own.content.title, own.content.data, language)];
          }
        }
      }
      if (file === REDIRECTS_FILE) {
        return [redirectsFileChange({ redirects: content.redirects ?? [], message: content.redirectMessage })];
      }
      if (file === SITE_FILE) return [siteSettingsFileChange(content.settings)];
      const page = content.pages.find((candidate) => candidate.file === file);
      if (page) return [{ path: file, content: serializeContent({ ...page.content, version: CURRENT_VERSION.page }) }];
      for (const collection of content.collections) {
        if (collection.file === file) return [collectionFileChange(collection.id, collection.settings)];
        const entry = collection.entries.find((candidate) => candidate.file === file);
        if (entry) return [entryFileChange(collection, entry.slug, entry.content.fields, entry.content)];
      }
      return [];
    });
}

/**
 * Moves a page to a new address in one save, with every link to it on the
 * site pointing to the new one (`blocks` say which props hold links), and,
 * with `redirect`, sending visitors on from its old address unless it's the
 * home page.
 */
export function movePageChanges(
  content: SiteContent,
  page: Page,
  to: string,
  { blocks, redirect = false }: { blocks?: Record<string, ComponentConfig>; redirect?: boolean } = {},
): FileChange[] {
  const relinked = relinkSite(content, [{ from: page.path, to }], blocks);
  const moved = relinked.content.pages.find((candidate) => candidate.file === page.file) ?? page;
  const changes: FileChange[] = [
    { path: page.file, delete: true },
    { path: pagePathToFile(to), content: serializeContent({ ...moved.content, version: CURRENT_VERSION.page }) },
  ];
  const skip = [page.file];
  if (redirect && page.path !== "/") {
    skip.push(REDIRECTS_FILE);
    changes.push(
      redirectsFileChange({
        redirects: movedPageRedirects(relinked.content.redirects ?? [], page.path, to),
        message: content.redirectMessage,
      }),
    );
  }
  return [...changes, ...relinkedChanges(relinked, skip)];
}

export function siteSettingsFileChange(settings: SiteSettings): FileChange {
  // Only the settings a page in another language is shown with have it.
  const { mainLanguage: _shown, ...stored } = settings;
  return { path: SITE_FILE, content: serializeContent({ ...stored, version: CURRENT_VERSION.site }) };
}

/** Whether fixes install each night, and the releases updates skip. */
export function updateSettingsFileChange(settings: Pick<UpdateSettings, "automatic" | "skip">): FileChange {
  return { path: UPDATES_FILE, content: updateSettingsFile(settings) };
}

/** Custom CSS as stored: ending in one newline, or empty. */
export function storedCss(css: string): string {
  return css.trim() ? `${css.trimEnd()}\n` : "";
}

export function customCssFileChange(css: string): FileChange {
  const stored = storedCss(css);
  return stored ? { path: CUSTOM_CSS_FILE, content: stored } : { path: CUSTOM_CSS_FILE, delete: true };
}

/** Writes the site's own code for the head and the end of the body, deleting a file once its code is gone. */
export function codeFileChanges(code: SiteCode, current: SiteCode = { head: "", body: "" }): FileChange[] {
  const changes: FileChange[] = [];
  for (const [path, next, before] of [
    [HEAD_CODE_FILE, code.head, current.head],
    [BODY_CODE_FILE, code.body, current.body],
  ] as const) {
    const stored = storedCode(next);
    if (stored === storedCode(before)) continue;
    changes.push(stored ? { path, content: stored } : { path, delete: true });
  }
  return changes;
}

/**
 * Refuses names that aren't one part of an address, as loading the site
 * would, so no caller (a plugin, Claude) can write a file such as
 * `_collection.json` or one in another folder through an item's name.
 */
function assertNames(...names: string[]): void {
  for (const name of names) {
    if (!isAddressSegment(name)) throw new Error(`"${name}" isn't a name a collection or item can have.`);
  }
}

/** Writes a collection's settings file. */
export function collectionFileChange(id: string, settings: CollectionFile): FileChange {
  assertNames(id);
  return {
    path: collectionSettingsFile(id),
    content: serializeContent({
      ...settings,
      version: CURRENT_VERSION.collection,
      template: storedData(settings.template as Data),
    }),
  };
}

/** An entry's values as stored: fields left empty are left out of the file. */
export function storedEntryFields(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => !isEmptyValue(value)));
}

/** A collection as entries' files need it: its folder, and whether entries are Markdown. */
type EntryCollection = Pick<Collection, "id" | "settings">;

/**
 * Writes an entry's file: JSON, or in a collection of Markdown files, Markdown
 * whose body is the body field's value (Markdown already). `details` are when
 * it's on the site, its language and what it translates: pass the entry's own
 * (`entry.content`) to keep them, since leaving them out shows the entry
 * straight away, in the main language.
 */
export function entryFileChange(
  collection: EntryCollection,
  slug: string,
  values: Record<string, unknown>,
  details: FileDetails | undefined,
): FileChange {
  assertNames(collection.id, slug);
  const { settings } = collection;
  const fields = cleanEntryValues(settings.fields, values);
  const times = fileDetailsOf(details ?? {});
  return settings.markdown
    ? { path: entryFile(collection.id, slug, "markdown"), content: serializeMarkdownEntry(settings, fields, times) }
    : {
        path: entryFile(collection.id, slug),
        content: serializeContent({ version: CURRENT_VERSION.entry, ...times, fields }),
      };
}

/** A new collection's settings: a title and some text, shown by a template that lists every field. */
export function newCollectionSettings({
  name,
  entryName,
  path,
  withEntryFields,
  kind = "blank",
  blocks = [],
}: {
  name: string;
  entryName: string;
  /** The address pattern, such as `/videos/{slug}`, or `undefined` if entries have no pages. */
  path?: string;
  /** Whether the site has the Entry field block, for the starting template. */
  withEntryFields: boolean;
  /** What it starts as: a title and text, or events, with their dates and times, place and summary. */
  kind?: "blank" | "events";
  /** The site's blocks, for the starting template. */
  blocks?: string[];
}): CollectionFile {
  if (kind === "events") return eventsCollectionSettings({ name, entryName, path, withEntryFields, blocks });
  const fields: CollectionField[] = [
    { name: TITLE_FIELD, label: "Title", type: "text", required: true },
    { name: "text", label: "Text", type: "richtext" },
  ];
  const content = withEntryFields
    ? [
        {
          type: "EntryField",
          props: {
            id: "title",
            field: TITLE_FIELD,
            style: "title",
            className: "mx-auto max-w-3xl px-4 pt-12 pb-4",
          },
        },
        {
          type: "EntryField",
          props: { id: "text", field: "text", style: "text", className: "mx-auto max-w-3xl px-4 pb-12" },
        },
      ]
    : [];
  return {
    version: 1,
    name,
    entryName,
    ...(path !== undefined && { path }),
    fields,
    template: { root: { props: { title: `{${TITLE_FIELD}}` } }, content },
  };
}

/** A collection of events: when each happens, where, a summary, a picture and details, in calendars. */
function eventsCollectionSettings({
  name,
  entryName,
  path,
  withEntryFields,
  blocks,
}: {
  name: string;
  entryName: string;
  path?: string;
  withEntryFields: boolean;
  blocks: string[];
}): CollectionFile {
  const fields: CollectionField[] = [
    { name: TITLE_FIELD, label: "Title", type: "text", required: true },
    { name: "when", label: "Date and time", type: "event", required: true },
    { name: "place", label: "Place", type: "text", hint: "Such as the hall, or an address." },
    {
      name: "summary",
      label: "Summary",
      type: "textarea",
      hint: "One or two sentences, shown in calendars and lists.",
    },
    { name: "image", label: "Picture", type: "image" },
    { name: "text", label: "Details", type: "richtext" },
  ];
  const field = (id: string, name: string, style: string, className: string) => ({
    type: "EntryField",
    props: { id, field: name, style, className },
  });
  const content = withEntryFields
    ? [
        field("when", "when", "small", "mx-auto max-w-3xl px-4 pt-12"),
        field("title", TITLE_FIELD, "title", "mx-auto max-w-3xl px-4 pt-2 pb-2"),
        field("place", "place", "small", "mx-auto max-w-3xl px-4"),
        ...(blocks.includes("AddToCalendar")
          ? [
              {
                type: "AddToCalendar",
                props: {
                  id: "add",
                  addLabel: "Add to calendar",
                  otherCalendarsLabel: "Apple Calendar and others",
                  className: "mx-auto max-w-3xl px-4 pt-4",
                },
              },
            ]
          : []),
        field("image", "image", "text", "mx-auto max-w-3xl px-4 pt-8"),
        field("text", "text", "text", "mx-auto max-w-3xl px-4 py-8"),
      ]
    : [];
  return {
    version: 1,
    name,
    entryName,
    ...(path !== undefined && { path }),
    fields,
    sort: { field: "when", order: "asc" },
    calendar: { when: "when", place: "place", summary: "summary" },
    template: { root: { props: { title: `{${TITLE_FIELD}}`, description: "{summary}" } }, content },
  };
}

/** The address pattern for entries whose addresses start with `prefix`: `/videos` → `/videos/{slug}`. */
export function addressPatternFor(prefix: string): string {
  const trimmed = prefix.trim().replace(/\/+$/, "");
  return `${trimmed.startsWith("/") ? "" : "/"}${trimmed}/${SLUG_PLACEHOLDER}`;
}

/** A name for a collection's folder, a field or an entry that isn't taken yet: `talk`, then `talk-2`, `talk-3`… */
export function uniqueName(base: string, taken: Iterable<string>, fallback = "item"): string {
  const used = new Set(taken);
  const start = base || fallback;
  if (!used.has(start)) return start;
  for (let n = 2; ; n++) if (!used.has(`${start}-${n}`)) return `${start}-${n}`;
}

export type EntryNameProblem = "invalid" | "reserved" | "taken";

/**
 * Checks the name an entry's file and address use. `addresses` are the
 * addresses already in use on the site; `current` is the entry's own name.
 * Names are the collection's, whatever an entry's language, and an entry in
 * another language (`language`, with the site's `settings`) has its address
 * under that language's.
 */
export function checkEntrySlug(
  input: string,
  collection: Collection,
  addresses: string[],
  current?: Entry,
  language?: { settings: SiteSettings; code: string },
): { ok: true; slug: string; path?: string } | { ok: false; problem: EntryNameProblem } {
  const slug = input.trim();
  if (!isAddressSegment(slug)) return { ok: false, problem: "invalid" };
  if (slug !== current?.slug && collection.entries.some((entry) => entry.slug === slug)) {
    return { ok: false, problem: "taken" };
  }
  const path = language
    ? entryPathIn(language.settings, collection.settings, slug, language.code)
    : collection.settings.path === undefined
      ? undefined
      : entryAddress(collection.settings.path, slug);
  if (path === undefined) return { ok: true, slug };
  if (isReservedPagePath(path)) return { ok: false, problem: "reserved" };
  if (path !== current?.path && addresses.includes(path)) return { ok: false, problem: "taken" };
  return { ok: true, slug, path };
}

/** Renames an entry, which changes its address, with every link to its page pointing to the new one. */
export function moveEntryChanges(
  content: SiteContent,
  collection: EntryCollection,
  entry: Entry,
  slug: string,
  path: string | undefined,
  blocks?: Record<string, ComponentConfig>,
): FileChange[] {
  const relinkedPages =
    entry.path && path ? relinkSite(content, [{ from: entry.path, to: path }], blocks) : { content, files: [] };
  // Items that link to it name it by its name, so they're renamed with it.
  const named = changeItemLinks(relinkedPages.content, collection.id, (name) => (name === entry.slug ? slug : name));
  const relinked = { content: named.content, files: [...new Set([...relinkedPages.files, ...named.files])] };
  const after = relinked.content.collections.find((candidate) => candidate.id === collection.id);
  const moved = after?.entries.find((candidate) => candidate.file === entry.file) ?? entry;
  // Its translations name it by its name, so they're renamed with it.
  const translations = (after?.entries ?? []).filter(
    (candidate) => candidate.file !== entry.file && candidate.content.translationOf === entry.slug,
  );
  return [
    { path: entry.file, delete: true },
    entryFileChange(collection, slug, moved.content.fields, moved.content),
    ...translations.map((translation) =>
      entryFileChange(collection, translation.slug, translation.content.fields, {
        ...translation.content,
        translationOf: slug,
      }),
    ),
    ...relinkedChanges(relinked, [entry.file, ...translations.map((translation) => translation.file)]),
  ];
}

/**
 * What else changes when an item is deleted: links to it from other items
 * are taken out, in the same publish, so none is left pointing nowhere.
 */
export function itemLinkRemovalChanges(content: SiteContent, collection: Collection, entry: Entry): FileChange[] {
  const unlinked = changeItemLinks(content, collection.id, (name) => (name === entry.slug ? undefined : name));
  return relinkedChanges(unlinked, [entry.file]);
}

/** A synced block's file, in a language of its own or the main one, in canonical form. */
export function syncedBlockFileChange(name: string, title: string, data: Data, language?: string): FileChange {
  assertNames(name);
  return {
    path: syncedBlockFile(name, language),
    content: serializeContent({
      version: CURRENT_VERSION["synced-block"],
      title: title.trim(),
      data: storedData(data),
    }),
  };
}

/** Deletes a synced block, with its own in every language. Callers check first that nothing places it (`syncedBlockUses()`). */
export function deleteSyncedBlockChanges(block: SyncedBlock): FileChange[] {
  return [block.file, ...Object.values(block.languages ?? {}).map((own) => own.file)].map((path) => ({
    path,
    delete: true,
  }));
}

/** Deletes a collection and all its entries. */
export function deleteCollectionChanges(collection: Collection): FileChange[] {
  return [collection.file, ...collection.entries.map((entry) => entry.file)].map((path) => ({ path, delete: true }));
}
