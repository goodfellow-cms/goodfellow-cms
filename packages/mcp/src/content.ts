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
  entryAddress,
  FOOTER_FILE,
  HEADER_FILE,
  isAddressSegment,
  type LayoutFile,
  layoutFileSchema,
  MEDIA_DIR,
  MENUS_FILE,
  type Menus,
  menusFileSchema,
  normalizePagePath,
  PAGES_DIR,
  type PageFile,
  pageFileSchema,
  pageFileToPath,
  pagePathToFile,
  parseContentFile,
  parseEntryFile,
  readTextFiles,
  SITE_FILE,
  type SiteSettings,
  siteSettingsSchema,
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

export async function readMenus(source: ContentSource): Promise<Menus> {
  const text = await source.read(MENUS_FILE);
  return text === undefined ? {} : parsed(parseContentFile("menus", menusFileSchema, MENUS_FILE, text)).menus;
}

export async function readLayout(source: ContentSource, part: "header" | "footer"): Promise<LayoutFile> {
  const file = part === "header" ? HEADER_FILE : FOOTER_FILE;
  const text = await source.read(file);
  return text === undefined
    ? { version: 1, data: { root: {}, content: [] } }
    : parsed(parseContentFile("layout", layoutFileSchema, file, text));
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
 * Every address the site's pages and entries have, so a new page or entry
 * never takes one. Entries' addresses come from their collections' settings.
 */
export async function takenAddresses(source: ContentSource): Promise<Set<string>> {
  const addresses = new Set((await listPages(source)).map((page) => page.address));
  for (const collection of await listCollections(source)) {
    const text = await source.read(collection.file);
    if (text === undefined) continue;
    const settings = parseContentFile("collection", collectionFileSchema, collection.file, text);
    if (!settings.ok || settings.value.path === undefined) continue;
    for (const entry of collection.entries) addresses.add(entryAddress(settings.value.path, entry.slug));
  }
  return addresses;
}

/** The site's media files, by the address content uses for them, such as `/media/photo.jpg`. */
export async function listMedia(source: ContentSource): Promise<string[]> {
  return (await source.list(MEDIA_DIR)).map((file) => `/${file.slice("public/".length)}`).sort();
}

/** Every content file, as text: what the preview page needs to show a draft as the site would. */
export async function contentFiles(source: ContentSource): Promise<Record<string, string>> {
  return Object.fromEntries(await readTextFiles(source, await source.list("content")));
}
