// Collections whose items come from somewhere other than `content/collections/`, such as a database or another
// system's API: the collection's settings, template, and list pages stay in its `_collection.json`, designed in the
// admin panel as for any collection, and its source gives the items. Loading the site reads them in as entries
// (`withSourcedCollections()`), so pages, feeds, calendars, and the content API see ordinary items.

import { CURRENT_VERSION } from "../migrations/index.js";
import type { SiteProblem } from "./checks.js";
import { type Collection, cleanEntryValues, type Entry, sortCollectionEntries } from "./collections.js";
import type { ContentProblem } from "./errors.js";
import { entryLanguage, entryPathIn, isOtherLanguage, languagePattern, siteLanguages } from "./languages.js";
import { allPages, type ContentSource, loadSiteContent, parseEntryFile, type SiteContent } from "./load.js";
import { isAddressSegment, isReservedPagePath, matchesAddressPattern, SLUG_PLACEHOLDER } from "./paths.js";
import type { CollectionFile, EntryFile } from "./schemas.js";

/**
 * One item as a source gives it: what an item's file would hold, without its
 * `version`. Its values are checked against the collection's fields, as a
 * file's are, so a source never needs to know the site's other settings.
 */
export interface SourcedItem extends Omit<EntryFile, "version"> {
  /** Its name in the collection, which is also the last part of its address: lowercase letters, numbers, and hyphens. */
  slug: string;
}

/** What changed in a source since a moment it gave before (`CollectionSource.changed()`). */
export interface SourceChanges {
  /** The items added, changed, or removed since then, by slug. */
  slugs: string[];
  /** What to ask from next time, such as the time now or a change feed's cursor, which the source reads back itself. */
  next: string;
}

/**
 * Where a collection's items come from. Sources are written for a site, or
 * come from plugins, such as one reading a table of the site's database.
 */
export interface CollectionSource {
  /** Every item, in any order: the collection's sort order is applied after. */
  items(): Promise<SourcedItem[]>;
  /**
   * What has changed since `since` (or since the source began, for `""`), so a
   * site that keeps pages once they've rendered renders those again. Sources
   * that can't say leave it out, and their pages show changes once they're
   * rendered again for some other reason, such as a publish or their age.
   */
  changed?(since: string): Promise<SourceChanges>;
  /**
   * Lets go of what the source holds, such as a database pool, once a
   * development server has made another in its place (`keptCollectionSources()`)
   * because its module or options changed. Sources that hold nothing leave it out.
   */
  close?(): void | Promise<void>;
}

/** Plain JSON, as the config's options for a source are. They're public, since the config loads in the browser too. */
export type SourceOptions = Record<string, unknown>;

/** A source's module's default export: makes the collection's source from the options its config gives. */
export type CollectionSourceModule = (options: SourceOptions) => CollectionSource;

/**
 * A collection's source in the site's config (`collections`). The module is
 * named, never imported, since the config loads in the browser too, where
 * the source's code and its secrets must never go; the site's server imports
 * it where it renders pages.
 */
export interface CollectionSourceConfig {
  /** The module whose default export makes the source (`defineCollectionSource()`), such as `"./lib/jobs.ts"` or a plugin's `"goodfellow-plugin-airtable/source"`. */
  source: string;
  /** What the module is given, such as which table to read. Plain JSON, public since the config loads in the browser too; never secrets. */
  options?: SourceOptions;
}

/** Declares a source's module's default export, with its options' type. */
export function defineCollectionSource<O extends SourceOptions>(
  make: (options: O) => CollectionSource,
): CollectionSourceModule {
  return make as CollectionSourceModule;
}

/** The sources a site's server reads collections from, by collection id. */
export type CollectionSources = Record<string, CollectionSource>;

/** What a site's code gives for a source's module: its default export, or the module itself as `import * as` gives it. */
export type SourceModuleImport = CollectionSourceModule | { default: CollectionSourceModule };

/**
 * Why a site's sources can't be made, such as a collection whose source the server wasn't given, or read, such as a
 * source whose `items()` gave something other than a list.
 */
export class CollectionSourceError extends Error {
  override name = "CollectionSourceError";
}

/**
 * Checks that the site's server was given a module for each collection the
 * config's `collections` names, and none for a collection it doesn't, which
 * would otherwise be read without anyone choosing it. Throws a
 * `CollectionSourceError` saying which. Runs no source's code, so a server
 * can check as it starts and make the sources only once it reads the site.
 */
export function checkSourceModules(
  collections: Record<string, CollectionSourceConfig> | undefined,
  modules: Record<string, SourceModuleImport>,
): void {
  for (const id of Object.keys(modules)) {
    if (!collections || !Object.hasOwn(collections, id)) {
      throw new CollectionSourceError(
        `A source was given for the collection "${id}", but the site's config doesn't name one. Add it to the config's collections.`,
      );
    }
  }
  for (const [id, config] of Object.entries(collections ?? {})) sourceMakerFor(id, config, modules);
}

/**
 * What makes the collection `id`'s source, from the module the site's server gave for it, its own property only (a
 * collection may be called `constructor`), or a `CollectionSourceError` saying it wasn't given.
 */
function sourceMakerFor(
  id: string,
  config: CollectionSourceConfig,
  modules: Record<string, SourceModuleImport>,
): CollectionSourceModule {
  const module = Object.hasOwn(modules, id) ? modules[id] : undefined;
  const make = typeof module === "function" ? module : module?.default;
  if (typeof make !== "function") {
    throw new CollectionSourceError(
      `The collection "${id}" reads its items from ${config.source}, which the site's server wasn't given. Import it and pass it as the "${id}" source.`,
    );
  }
  return make;
}

/** The collection `id`'s source, made from its module with the config's options (`sourceMakerFor()`). */
function madeSource(
  id: string,
  config: CollectionSourceConfig,
  modules: Record<string, SourceModuleImport>,
): CollectionSource {
  return sourceMakerFor(id, config, modules)(config.options ?? {});
}

/**
 * The sources the config's `collections` name, made from the modules the
 * site's server imported (by collection id) with the config's options.
 * Throws a `CollectionSourceError` where `checkSourceModules()` does.
 */
export function collectionSources(
  collections: Record<string, CollectionSourceConfig> | undefined,
  modules: Record<string, SourceModuleImport>,
): CollectionSources {
  checkSourceModules(collections, modules);
  const sources: CollectionSources = {};
  for (const [id, config] of Object.entries(collections ?? {})) sources[id] = madeSource(id, config, modules);
  return sources;
}

const kept = new WeakMap<object, Map<string, { options: string; source: CollectionSource }>>();

/** Sources closed once another was made in their place, which are never given out again. */
const closed = new WeakSet<CollectionSource>();

/**
 * The source `keptCollectionSources()` gives each collection now, by its site and id, to close once it's made
 * again: only the same site's, since two sites in one process (a test's, say) each keep their own.
 */
const current = new Map<string, CollectionSource>();

/** Closes a source made again in its place (`CollectionSource.close()`), saying so where it can't. */
function closeReplaced(id: string, source: CollectionSource): void {
  closed.add(source);
  Promise.resolve()
    .then(() => source.close?.())
    .catch((error: unknown) => {
      console.warn(`source:${id} couldn't be closed: ${error instanceof Error ? error.message : String(error)}`);
    });
}

/**
 * `collectionSources()` for development servers, which load the site again on
 * every request: each source is made once for the same module and options, so
 * a source that opens a database pool as it's made opens one, not one each
 * request. A changed module (a new module object) or new options make it again,
 * keeping only the latest for each collection, and close the one before
 * (`CollectionSource.close()`), so its pool doesn't stay open. Kept by
 * `site`, such as its folder, and collection id, so another site's sources in
 * the same process are never closed.
 */
export function keptCollectionSources(
  collections: Record<string, CollectionSourceConfig> | undefined,
  modules: Record<string, SourceModuleImport>,
  site = "",
): CollectionSources {
  checkSourceModules(collections, modules);
  const sources: CollectionSources = {};
  for (const [id, config] of Object.entries(collections ?? {})) {
    // Checked above: the module given for the collection, its own property.
    const module = modules[id] as SourceModuleImport;
    const options = JSON.stringify(config.options ?? {});
    let made = kept.get(module);
    if (!made) {
      made = new Map();
      kept.set(module, made);
    }
    let latest = made.get(id);
    // Made again for new options, and where the one kept was closed, as when the module changed and changed back.
    if (latest?.options !== options || closed.has(latest.source)) {
      latest = { options, source: madeSource(id, config, modules) };
      made.set(id, latest);
    }
    const key = `${site}\0${id}`;
    const before = current.get(key);
    if (before && before !== latest.source) closeReplaced(id, before);
    current.set(key, latest.source);
    sources[id] = latest.source;
  }
  return sources;
}

/**
 * The site as `files` hold it, with its collections' sources read in
 * (`withSourcedCollections()`): those collections' item files are neither read
 * nor checked, since their sources' items replace them. Builds and the
 * development servers load the site this way, given the sources they made.
 */
export async function loadSourcedContent(
  files: ContentSource,
  sources: CollectionSources | Promise<CollectionSources>,
): Promise<SiteContent> {
  const resolved = await sources;
  return withSourcedCollections(await loadSiteContent(files, { sourced: Object.keys(resolved) }), resolved);
}

/**
 * One collection's source, made from its module with the config's options, or
 * `undefined` for a collection the config names no source for. Throws a
 * `CollectionSourceError` where its module is missing. A server that answers
 * for one collection at a time makes only that one, so a source that can't be
 * made never stops another's items.
 */
export function collectionSource(
  collections: Record<string, CollectionSourceConfig> | undefined,
  modules: Record<string, SourceModuleImport>,
  id: string,
): CollectionSource | undefined {
  const config = collections && Object.hasOwn(collections, id) ? collections[id] : undefined;
  return config ? madeSource(id, config, modules) : undefined;
}

/** Where a sourced item is in problems and links, since it has no file: `source:<collection>/<slug>`. */
export function sourcedItemFile(collection: string, slug: string): string {
  return `source:${collection}/${slug}`;
}

/** Whether an entry came from a source rather than a file (`sourcedItemFile()`). */
export function isSourcedItem(entry: Pick<Entry, "file">): boolean {
  return entry.file.startsWith("source:");
}

/**
 * One of a source's items checked as an item's file would be, with only the
 * values of the collection's own fields, so a row's other columns, such as
 * notes or applicants' addresses, never reach pages, the content API or the
 * admin panel. Gives the problem instead where a file couldn't hold it.
 */
function checkedItem(
  id: string,
  settings: CollectionFile,
  item: SourcedItem,
): { ok: true; slug: string; file: string; value: EntryFile } | { ok: false; problem: ContentProblem } {
  const slug = typeof item?.slug === "string" ? item.slug : "";
  const file = sourcedItemFile(id, slug || "?");
  if (!isAddressSegment(slug)) {
    return {
      ok: false,
      problem: { file, message: "has a name that can't be used: lowercase letters, numbers, and hyphens only." },
    };
  }
  const { slug: _, ...rest } = item;
  let text: string;
  try {
    // As this release writes items, which is what a source gives: never migrated as though it were older.
    text = JSON.stringify({ ...rest, version: CURRENT_VERSION.entry });
  } catch {
    // Such as a BigInt, or a value that holds itself, which a file couldn't either.
    return { ok: false, problem: { file, message: "has a value that can't be written as JSON." } };
  }
  // Checked as an item's JSON file would be, so a Markdown collection's body is a field like any other here.
  const parsed = parseEntryFile({ ...settings, markdown: undefined }, file, text);
  if (!parsed.ok) return parsed;
  // Only the collection's own fields, and in a group's rows only the group's, as a file is saved
  // (`cleanEntryValues()`), so a row's other columns never reach pages or the admin panel.
  const names = new Set(settings.fields.map((field) => field.name));
  const fields = cleanEntryValues(
    settings.fields,
    Object.fromEntries(Object.entries(parsed.value.fields).filter(([name]) => names.has(name))),
  );
  return { ok: true, slug, file, value: { ...parsed.value, fields } };
}

/**
 * A source's items as the admin panel may see them (`collections/<id>/items`):
 * those a file could hold, each with only the collection's own fields, and
 * each name once. The site's other checks, of languages and addresses, are
 * made where the admin panel loads them (`withSourcedCollections()`).
 */
export function sourcedItemsFor(id: string, settings: CollectionFile, items: readonly SourcedItem[]): SourcedItem[] {
  const shown: SourcedItem[] = [];
  const slugs = new Set<string>();
  for (const item of items) {
    const checked = checkedItem(id, settings, item);
    if (!checked.ok || slugs.has(checked.slug)) continue;
    slugs.add(checked.slug);
    const { version: _, ...value } = checked.value;
    shown.push({ slug: checked.slug, ...value });
  }
  return shown;
}

/** A source's items, as `collection`'s entries, leaving out (into `problems`) any a file couldn't hold. */
function sourcedEntries(
  content: SiteContent,
  collection: Collection,
  items: readonly SourcedItem[],
  taken: Map<string, string>,
  problems: ContentProblem[],
): Entry[] {
  const entries: Entry[] = [];
  // The names of items shown, so a later item with the same name is left out, but never for one that was refused.
  const slugs = new Set<string>();
  for (const item of items) {
    const checked = checkedItem(collection.id, collection.settings, item);
    if (!checked.ok) {
      problems.push(checked.problem);
      continue;
    }
    const { slug, file, value } = checked;
    if (slugs.has(slug)) {
      problems.push({ file, message: `is given twice by the collection's source. Only the first is shown.` });
      continue;
    }
    const language = entryLanguage(content.settings, { content: value });
    if (language !== content.settings.language && !isOtherLanguage(content.settings, language)) {
      problems.push({ file, message: `is in ${language}, which isn't one of the site's languages.` });
      continue;
    }
    const path = entryPathIn(content.settings, collection.settings, slug, language);
    if (path && isReservedPagePath(path)) {
      problems.push({ file, message: `can't be used: ${path} is reserved for the admin panel.` });
      continue;
    }
    // Pages, and other collections' items, keep their addresses.
    const existing = path && taken.get(path);
    if (existing) {
      problems.push({ file, message: `has the same address (${path}) as ${existing}, which keeps it.` });
      continue;
    }
    if (path) taken.set(path, file);
    slugs.add(slug);
    entries.push({ collection: collection.id, slug, file, ...(path && { path }), content: value });
  }
  return sortCollectionEntries(collection.settings, entries);
}

/**
 * The items each source last gave, while it's kept (as `keptCollectionSources()` keeps them for a server's life), for
 * `withSourcedCollections()` to show while it can't be read.
 */
const lastRead = new WeakMap<CollectionSource, SourcedItem[]>();

/**
 * Each source's items read on its own, at once: `read` gives the items of
 * those that could be read, without asking their sources again, and `failed`
 * names the others, with what each threw in `errors`, so one source that's
 * down leaves the others' items shown (`withSourcedCollections()` of `read`).
 */
export async function readSources(
  sources: CollectionSources,
): Promise<{ read: CollectionSources; failed: string[]; errors: unknown[] }> {
  const asking = Object.entries(sources);
  // Each in a promise of its own, so a source that throws before it returns one fails only itself.
  const answers = await Promise.allSettled(asking.map(([, source]) => Promise.resolve().then(() => source.items())));
  const read: CollectionSources = {};
  const failed: string[] = [];
  const errors: unknown[] = [];
  asking.forEach(([id], index) => {
    const answer = answers[index] as PromiseSettledResult<SourcedItem[]>;
    // A source that gave something other than a list, such as one that forgot to return its items, failed, saying so.
    if (answer.status === "fulfilled" && !Array.isArray(answer.value)) {
      failed.push(id);
      errors.push(new CollectionSourceError(`The source of the collection "${id}" didn't give a list of items.`));
    } else if (answer.status === "fulfilled") {
      const items = answer.value;
      lastRead.set(sources[id] as CollectionSource, items);
      read[id] = { items: async () => items };
    } else {
      failed.push(id);
      errors.push(answer.reason);
    }
  });
  return { read, failed, errors };
}

/**
 * The site as `files` hold it, with the items of each source that can be read
 * now, for checks that would rather go on without a source than stop, such as
 * the hourly check for scheduled changes (`goodfellow due`): sourced
 * collections' item files are never read, a source that can't be read leaves
 * its collection without items, and `failed` names those, with what each threw
 * in `errors`. Builds and pages use `loadSourcedContent()`, which stops instead.
 */
export async function loadReadableSources(
  files: ContentSource,
  sources: CollectionSources,
): Promise<{ content: SiteContent; failed: string[]; errors: unknown[] }> {
  const content = await loadSiteContent(files, { sourced: Object.keys(sources) });
  const { read, failed, errors } = await readSources(sources);
  return { content: await withSourcedCollections(content, read), failed, errors };
}

/**
 * Sources that give the items `content` already shows for the collections
 * `ids` name, as `withSourcedCollections()` gave them, to read in again
 * (checked again, as for another copy of the site) without asking the system
 * they come from.
 */
export function itemsAsSources(content: SiteContent, ids: Iterable<string>): CollectionSources {
  const sources: CollectionSources = {};
  for (const id of ids) {
    const collection = content.collections.find((one) => one.id === id && one.sourced);
    if (!collection) continue;
    const items = collection.entries.map(({ slug, content: { version: _, ...rest } }) => ({ slug, ...rest }));
    sources[id] = { items: async () => items };
  }
  return sources;
}

/**
 * The site with each collection that has a source given its source's items in
 * place of any files in its folder, checked as files are. A source's item that
 * a file couldn't hold, or that takes an address the site already has, is left
 * out and reported to `onProblem`, since one bad row in another system mustn't
 * stop the whole site. A source for a collection the site has no settings for
 * is left alone, as a folder of items without a `_collection.json` is.
 *
 * Each source is read on its own (`readSources()`). One that can't be read
 * just now shows the items it gave last time it could, in this process, with
 * a problem saying so, so a server that has shown its items keeps showing
 * them while the other system is down. One never read yet fails the whole
 * site, after every other source has been asked, since a site without its
 * items would show their pages as missing and its lists empty, which a build
 * would publish and a server could keep until the next publish.
 *
 * Use it on the site as loaded, before `shownContent()`, so sourced items'
 * schedules apply as files' do.
 */
export async function withSourcedCollections(
  content: SiteContent,
  sources: CollectionSources,
  onProblem: (problem: ContentProblem) => void = (problem) => console.warn(`${problem.file} ${problem.message}`),
): Promise<SiteContent> {
  const sourced = new Set(
    Object.keys(sources).filter((id) => sources[id] && content.collections.some((one) => one.id === id)),
  );
  if (sourced.size === 0) return content;
  // Every address the site has without the sourced collections, which their items can't take.
  const kept = { ...content, collections: content.collections.filter((one) => !sourced.has(one.id)) };
  const taken = new Map(allPages(kept).map((page) => [page.path, page.file]));
  // Every source is asked at once, so a page waits for the slowest rather than all of them in turn. Their items are
  // then checked in the site's order of collections, which decides which of two takes an address both give.
  const asked = await readSources(Object.fromEntries([...sourced].map((id) => [id, sources[id] as CollectionSource])));
  const problems: ContentProblem[] = [];
  const read = new Map<string, SourcedItem[]>();
  for (const id of sourced) {
    const items = Object.hasOwn(asked.read, id) ? await (asked.read[id] as CollectionSource).items() : undefined;
    if (items) {
      read.set(id, items);
      continue;
    }
    const last = lastRead.get(sources[id] as CollectionSource);
    if (!last) throw asked.errors[asked.failed.indexOf(id)];
    problems.push({
      file: `source:${id}`,
      message: "couldn't be read from its source just now, so the items it gave last time are shown.",
    });
    read.set(id, last);
  }
  const collections: Collection[] = [];
  for (const collection of content.collections) {
    const items = read.get(collection.id);
    if (!items) {
      collections.push(collection);
      continue;
    }
    const entries = sourcedEntries(content, collection, items, taken, problems);
    collections.push({ ...collection, entries, sourced: true });
  }
  for (const problem of problems) onProblem(problem);
  return { ...content, collections };
}

/** Whether a source's `changed()` gave what it should: its items' names, and what to pass next time. */
function isSourceChanges(value: unknown): value is SourceChanges {
  if (!value || typeof value !== "object") return false;
  const { slugs, next } = value as { slugs?: unknown; next?: unknown };
  return typeof next === "string" && Array.isArray(slugs) && slugs.every((slug) => typeof slug === "string");
}

/**
 * What has changed in the site's sources since `since` (each source's `next`
 * from the time before, by collection id; missing means from the start): the
 * collections whose items changed, the pages of their items, those removed
 * too, and what to pass next time, for the sources there are now. Sources
 * without `changed()` are left out. One whose `changed()` fails is named in
 * `failed`, keeping what it was given to ask from next time, and never stops
 * another's.
 */
export async function sourceChanges(
  content: SiteContent,
  sources: CollectionSources,
  since: Record<string, string> = {},
): Promise<{ collections: string[]; paths: string[]; next: Record<string, string>; failed: string[] }> {
  const collections: string[] = [];
  const paths = new Set<string>();
  // Only the sources there are now, so a removed one's is let go.
  const next: Record<string, string> = {};
  const failed: string[] = [];
  const asking = Object.entries(sources).flatMap(([id, source]) => (source.changed ? [[id, source] as const] : []));
  // Every source is asked at once, so a scheduled route waits for the slowest rather than all of them in turn, each in
  // a promise of its own, so one that throws before it returns one fails only itself.
  const answers = await Promise.allSettled(
    asking.map(([id, source]) =>
      Promise.resolve().then(() => source.changed?.(Object.hasOwn(since, id) ? (since[id] as string) : "")),
    ),
  );
  const asked: [string, SourceChanges][] = [];
  asking.forEach(([id], index) => {
    const answer = answers[index];
    // Only an answer of the shape a source gives counts; anything else is that source's failure.
    if (answer?.status === "fulfilled" && isSourceChanges(answer.value)) asked.push([id, answer.value]);
    else {
      failed.push(id);
      if (Object.hasOwn(since, id)) next[id] = since[id] as string;
    }
  });
  for (const [id, changes] of asked) {
    next[id] = changes.next;
    if (changes.slugs.length === 0) continue;
    // A collection the site has no settings for has no pages, nor anything to show its items.
    const collection = content.collections.find((one) => one.id === id);
    if (!collection) continue;
    collections.push(id);
    const changed = new Set(changes.slugs);
    for (const entry of collection.entries) {
      if (changed.has(entry.slug) && entry.path) paths.add(entry.path);
    }
    // What an item's address was isn't known, whether it's gone, such as a filled job opening, or moved to another
    // language, so each changed name's address in each of the site's languages, since a page kept once it rendered
    // would otherwise stay.
    for (const slug of changed) {
      if (!isAddressSegment(slug)) continue;
      for (const language of siteLanguages(content.settings)) {
        const path = entryPathIn(content.settings, collection.settings, slug, language.code);
        if (path) paths.add(path);
      }
    }
  }
  return { collections, paths: [...paths].sort(), next, failed };
}

/**
 * Whether a collection's address pattern is only its item's name (`/{slug}`),
 * which every address of one part matches: the admin panel doesn't refuse new
 * pages there for its items' sake (`useMayBeItem()`), since that would refuse
 * almost every page, and where an item has a page's address, the page wins
 * and the item is left out, saying so (`withSourcedCollections()`).
 */
export function takesAnyAddress(settings: Pick<CollectionFile, "path">): boolean {
  const parts = (settings.path ?? "").split("/").filter((part) => part !== "");
  return parts.length > 0 && parts.every((part) => part === SLUG_PLACEHOLDER);
}

/**
 * Whether a link's address could be a page of a collection whose items can't be
 * read here, such as a static site's, whose build reads them, or one whose
 * source is down: its pages aren't known, so a link to one can't be checked.
 */
export function mayBeUnreadPage(
  content: Pick<SiteContent, "settings"> & { collections: readonly Pick<Collection, "id" | "settings">[] },
  unread: ReadonlySet<string>,
  target: string,
): boolean {
  return content.collections.some(
    (collection) =>
      unread.has(collection.id) &&
      siteLanguages(content.settings).some((language) => {
        const pattern = languagePattern(content.settings, collection.settings, language.code);
        return pattern !== undefined && matchesAddressPattern(pattern, target);
      }),
  );
}

/**
 * The problems without links that might go to unread collections' items: to
 * their pages (`mayBeUnreadPage()`), and from item fields that name one of
 * them, since which items they have isn't known.
 */
export function withoutUnreadLinks(
  problems: SiteProblem[],
  content: SiteContent,
  unread: ReadonlySet<string>,
): SiteProblem[] {
  if (unread.size === 0) return problems;
  return problems.filter((problem) => {
    if (problem.kind === "missing-page") return !mayBeUnreadPage(content, unread, problem.target);
    if (problem.kind === "missing-item") return !unread.has(problem.collection);
    return true;
  });
}
