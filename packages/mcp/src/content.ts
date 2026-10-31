/**
 * Reading a site's content a file at a time. Tools read only the files they
 * need, never the whole site, so a call stays within what a free hosting plan
 * allows however big the site is (the hosted connector's Worker gets 50
 * requests and 10 ms of processing per call).
 */
import {
  COLLECTION_SETTINGS_FILE,
  COLLECTIONS_DIR,
  type CollectionFile,
  type ContentSource,
  collectionFileSchema,
  type EntryFile,
  entryPathIn,
  FOOTER_FILE,
  HEADER_FILE,
  hasLanguages,
  isAddressSegment,
  type LayoutFile,
  layoutFileSchema,
  MEDIA_DIR,
  MEDIA_FILE,
  MENUS_FILE,
  type Menus,
  mainLanguage,
  mediaFileSchema,
  menusFileSchema,
  normalizePagePath,
  PAGES_DIR,
  type PageFile,
  type PhotoCredit,
  pageFileSchema,
  pageFileToPath,
  pagePathToFile,
  parseContentFile,
  parseEntryFile,
  readTextFiles,
  SITE_FILE,
  type SiteSettings,
  SYNCED_BLOCKS_DIR,
  type SyncedBlockFile,
  siteSettingsSchema,
  syncedBlockFile,
  syncedBlockFileSchema,
} from "@goodfellow-cms/core";

/** Thrown with a message Claude can pass on to the editor as it is. */
export class ToolError extends Error {
  override name = "ToolError";
}

function parsed<T>(result: { ok: true; value: T } | { ok: false; problem: { file: string; message: string } }): T {
  if (!result.ok) {
    throw new ToolError(
      `${result.problem.file} ${result.problem.message} Fix it in the admin panel, or ask the site's developer.`,
    );
  }
  return result.value;
}

export async function readSettings(source: ContentSource): Promise<SiteSettings> {
  const text = await source.read(SITE_FILE);
  return text === undefined
    ? siteSettingsSchema.parse({ version: 1 })
    : parsed(parseContentFile("site", siteSettingsSchema, SITE_FILE, text));
}

/** The site's menus, and the ones of its other languages that have menus of their own. */
export async function readMenus(
  source: ContentSource,
): Promise<{ menus: Menus; languageMenus: Record<string, Menus> }> {
  const text = await source.read(MENUS_FILE);
  if (text === undefined) return { menus: {}, languageMenus: {} };
  const file = parsed(parseContentFile("menus", menusFileSchema, MENUS_FILE, text));
  return { menus: file.menus, languageMenus: file.languages ?? {} };
}

export async function readLayout(source: ContentSource, part: "header" | "footer"): Promise<LayoutFile> {
  const file = part === "header" ? HEADER_FILE : FOOTER_FILE;
  const text = await source.read(file);
  return text === undefined
    ? { version: 1, data: { root: {}, content: [] } }
    : parsed(parseContentFile("layout", layoutFileSchema, file, text));
}

/** The site's synced blocks: each one's name, title, and the other languages with versions of their own. */
export async function listSyncedBlocks(
  source: ContentSource,
): Promise<Array<{ name: string; title: string; languages: string[] }>> {
  const files = (await source.list(SYNCED_BLOCKS_DIR)).filter((file) => file.endsWith(".json"));
  const names = new Map<string, string[]>();
  for (const file of files) {
    const [name = "", code] = file.slice(SYNCED_BLOCKS_DIR.length + 1, -".json".length).split(".");
    if (!isAddressSegment(name)) continue;
    names.set(name, [...(names.get(name) ?? []), ...(code ? [code] : [])]);
  }
  const listed = await Promise.all(
    [...names].map(async ([name, languages]) => {
      const block = await readSyncedBlock(source, name);
      return block && { name, title: block.title, languages: languages.sort() };
    }),
  );
  return listed.filter((block) => block !== undefined).sort((a, b) => a.name.localeCompare(b.name));
}

/** A synced block's file, or a language's own version of it, or `undefined` where there's none. */
export async function readSyncedBlock(
  source: ContentSource,
  name: string,
  language?: string,
): Promise<SyncedBlockFile | undefined> {
  if (!isAddressSegment(name)) return undefined;
  const file = syncedBlockFile(name, language);
  const text = await source.read(file);
  return text === undefined ? undefined : parsed(parseContentFile("synced-block", syncedBlockFileSchema, file, text));
}

/** A page's address written the site's one way, or a `ToolError` saying why it can't be one. */
export function pageAddress(input: string): string {
  try {
    return normalizePagePath(input.trim().startsWith("/") ? input.trim() : `/${input.trim()}`);
  } catch {
    throw new ToolError(
      `"${input}" can't be a page's address. Addresses are like /about or /news/open-day: lowercase letters, numbers and hyphens.`,
    );
  }
}

/** The site's pages' addresses and files, from the list of files alone. */
export async function listPages(source: ContentSource): Promise<Array<{ address: string; file: string }>> {
  const files = await source.list(PAGES_DIR);
  return files
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      try {
        return [{ address: pageFileToPath(file), file }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.address.localeCompare(b.address));
}

export async function readPage(
  source: ContentSource,
  address: string,
): Promise<{ file: string; content: PageFile } | undefined> {
  const file = pagePathToFile(address);
  const text = await source.read(file);
  return text === undefined
    ? undefined
    : { file, content: parsed(parseContentFile("page", pageFileSchema, file, text)) };
}

export interface CollectionFiles {
  id: string;
  file: string;
  entries: Array<{ slug: string; file: string }>;
}

/** The site's collections and their entries' files, from the list of files alone. */
export async function listCollections(source: ContentSource): Promise<CollectionFiles[]> {
  const folders = new Map<string, CollectionFiles>();
  for (const file of await source.list(COLLECTIONS_DIR)) {
    const [id, name, ...rest] = file.slice(COLLECTIONS_DIR.length + 1).split("/");
    if (!id || !name || rest.length > 0 || !isAddressSegment(id)) continue;
    const folder = folders.get(id) ?? { id, file: `${COLLECTIONS_DIR}/${id}/${COLLECTION_SETTINGS_FILE}`, entries: [] };
    folders.set(id, folder);
    if (name === COLLECTION_SETTINGS_FILE) continue;
    const match = /^(.+)\.(json|md)$/.exec(name);
    if (match?.[1] && isAddressSegment(match[1])) folder.entries.push({ slug: match[1], file });
  }
  return [...folders.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export interface LoadedCollection extends CollectionFiles {
  settings: CollectionFile;
}

/** A collection's settings and its entries' files. */
export async function readCollection(source: ContentSource, id: string): Promise<LoadedCollection> {
  const collection = (await listCollections(source)).find((candidate) => candidate.id === id);
  const text = collection && (await source.read(collection.file));
  if (!collection || text === undefined) {
    throw new ToolError(`The site has no collection "${id}". list_collections lists the ones it has.`);
  }
  return {
    ...collection,
    settings: parsed(parseContentFile("collection", collectionFileSchema, collection.file, text)),
  };
}

export async function readEntry(
  source: ContentSource,
  collection: LoadedCollection,
  slug: string,
): Promise<{ file: string; content: EntryFile } | undefined> {
  const found = collection.entries.find((entry) => entry.slug === slug);
  const text = found && (await source.read(found.file));
  if (!found || text === undefined) return undefined;
  return { file: found.file, content: parsed(parseEntryFile(collection.settings, found.file, text)) };
}

/**
 * Each item's language, by its name. Only a site with other languages has
 * items in them, so only then are the items' files read, all in one go where
 * the source can.
 */
export async function entryLanguages(
  source: ContentSource,
  collection: LoadedCollection,
  site: SiteSettings,
): Promise<Map<string, string>> {
  const main = mainLanguage(site);
  if (!hasLanguages(site)) return new Map(collection.entries.map((entry) => [entry.slug, main]));
  const texts = await readTextFiles(
    source,
    collection.entries.map((entry) => entry.file),
  );
  return new Map(
    collection.entries.map((entry) => {
      const text = texts.get(entry.file);
      const file = text === undefined ? undefined : parseEntryFile(collection.settings, entry.file, text);
      return [entry.slug, (file?.ok && file.value.inLanguage) || main];
    }),
  );
}

/** Each item's address, by its name, in its language, where its collection gives items pages. */
export async function entryAddresses(
  source: ContentSource,
  collection: LoadedCollection,
  site: SiteSettings,
): Promise<Map<string, string>> {
  if (collection.settings.path === undefined) return new Map();
  const languages = await entryLanguages(source, collection, site);
  return new Map(
    collection.entries.flatMap((entry) => {
      const path = entryPathIn(site, collection.settings, entry.slug, languages.get(entry.slug) ?? mainLanguage(site));
      return path === undefined ? [] : [[entry.slug, path] as const];
    }),
  );
}

/**
 * Every address the site's pages and entries have, so a new page or entry
 * never takes one. Entries' addresses come from their collections' settings,
 * and in a site with other languages, their own languages.
 */
export async function takenAddresses(source: ContentSource): Promise<Set<string>> {
  const addresses = new Set((await listPages(source)).map((page) => page.address));
  const site = await readSettings(source);
  for (const collection of await listCollections(source)) {
    const text = await source.read(collection.file);
    if (text === undefined) continue;
    const settings = parseContentFile("collection", collectionFileSchema, collection.file, text);
    if (!settings.ok || settings.value.path === undefined) continue;
    for (const address of (await entryAddresses(source, { ...collection, settings: settings.value }, site)).values()) {
      addresses.add(address);
    }
  }
  return addresses;
}

/** The site's media files, by the address content uses for them, such as `/media/photo.jpg`. */
/** One media file, as `list_media` describes it. */
export interface MediaListing {
  address: string;
  /** Its size in bytes, where the source can say without reading it. */
  bytes?: number;
  /** Its credit, which pages using it show, as its license requires. */
  credit?: PhotoCredit;
}

/** The site's media files, with their sizes and credits. */
export async function listMedia(source: ContentSource): Promise<MediaListing[]> {
  const [files, sizes, creditsText] = await Promise.all([
    source.list(MEDIA_DIR),
    source.fileSizes?.(MEDIA_DIR),
    source.read(MEDIA_FILE),
  ]);
  const credits =
    creditsText === undefined
      ? {}
      : parsed(parseContentFile("media", mediaFileSchema, MEDIA_FILE, creditsText)).credits;
  return files.sort().map((file) => {
    const address = `/${file.slice("public/".length)}`;
    const bytes = sizes?.get(file);
    const credit = credits[address];
    return { address, ...(bytes !== undefined && { bytes }), ...(credit && { credit }) };
  });
}

/** Image types a browser shows on their own, which `screenshot` can take a picture of. */
const IMAGE_ADDRESS = /^\/media\/[^?#]+\.(?:jpe?g|png|gif|webp|avif|svg|ico)$/i;

/** Whether an address is a media file's, rather than a page's. */
export function isMediaAddress(address: string): boolean {
  return address.trim().startsWith("/media/");
}

/** An image's address in the media library, or a `ToolError` saying why it can't be shown. */
export async function mediaImage(source: ContentSource, input: string): Promise<string> {
  const address = input.trim();
  if (!IMAGE_ADDRESS.test(address) || address.split("/").some((part) => part === ".." || part === ".")) {
    throw new ToolError(
      `${address} isn't an image Claude can look at. Screenshots show pages, and images in the media library such as /media/photo.jpg; other files, such as PDFs and videos, are opened in the admin panel.`,
    );
  }
  if (!(await source.list(MEDIA_DIR)).includes(`public${address}`)) {
    throw new ToolError(`There's no file at ${address}. list_media lists the media library.`);
  }
  return address;
}

/** Every content file, as text: what the preview page needs to show a draft as the site would. */
export async function contentFiles(source: ContentSource): Promise<Record<string, string>> {
  return Object.fromEntries(await readTextFiles(source, await source.list("content")));
}
