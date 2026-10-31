/**
 * Media kept outside the repository (`content/media-storage.json`), by a
 * plugin that stores media, such as S3 storage: which files it keeps, and the
 * address they're public at. Content still refers to them as `/media/…`, so
 * pages don't change when a site's media moves; builds show them from the
 * storage's address (`withStoredMedia()`, which `shownContent()` applies),
 * and the checks count them as the site's media.
 */
import { z } from "zod";
import { CURRENT_VERSION } from "../migrations/index.js";
import type { SiteContent } from "./load.js";
import { MEDIA_STORAGE_FILE } from "./paths.js";
import { serializeContent } from "./serialize.js";
import type { FileChange } from "./store.js";

/** Where media can be public: `https://` addresses, and `http://` only on this computer, for tests. */
export function isStorageUrl(url: string): boolean {
  if (/[?#\s]/.test(url)) return false;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/.*)?$/.test(url)) return true;
  return /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?(\/.*)?$/i.test(url);
}

/**
 * Whether a media address can be kept in storage: `/media/` and a name of
 * letters, digits, `.`, `_`, `~`, `%` and `-`, in folders if need be, as
 * every upload's name is. Others stay in the repository, since builds find
 * addresses in content by these characters.
 */
export function isStorableAddress(address: string): boolean {
  return /^\/media\/[\w.~%-]+(\/[\w.~%-]+)*$/.test(address) && !address.split("/").some((part) => /^\.+$/.test(part));
}

export const storedFileSchema = z.object({
  /** Its size in bytes. */
  size: z.number().int().nonnegative(),
  /** An image's size in pixels, where it's known, for renderers that set images' sizes. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const mediaStorageFileSchema = z.object({
  version: z.literal(1),
  /** The plugin that keeps the files, by its package's name, such as `goodfellow-plugin-s3`. */
  plugin: z.string().min(1),
  /** The address the files are public at: a file `/media/a.jpg` is at this address's `a.jpg`. */
  url: z.string().refine(isStorageUrl, "must be an https:// address with no ? or #"),
  /** Each file it keeps, by the address content uses, such as `/media/sermon.mp4`. */
  files: z.record(z.string().refine(isStorableAddress, "must be a /media/ address"), storedFileSchema).default({}),
});

export type StoredFile = z.output<typeof storedFileSchema>;
export type MediaStorageFile = z.output<typeof mediaStorageFileSchema>;
/** The media a plugin keeps, as the site has it loaded. */
export type MediaStorage = Omit<MediaStorageFile, "version">;

/** Where a stored file is public, or `undefined` for an address the storage doesn't keep. */
export function storedMediaUrl(storage: MediaStorage | undefined, address: string): string | undefined {
  if (!storage || !Object.hasOwn(storage.files, address)) return undefined;
  return `${storage.url.replace(/\/+$/, "")}/${address.slice("/media/".length)}`;
}

/** The addresses of the files a storage keeps. */
export function storedAddresses(storage: MediaStorage | undefined): string[] {
  return storage ? Object.keys(storage.files) : [];
}

/** Stored images' sizes, by their public address, as renderers' `media` sizes have them. */
export function storedMediaSizes(storage: MediaStorage | undefined): Record<string, { width: number; height: number }> {
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const [address, file] of Object.entries(storage?.files ?? {})) {
    const url = storedMediaUrl(storage, address);
    if (url && file.width && file.height) sizes[url] = { width: file.width, height: file.height };
  }
  return sizes;
}

/**
 * A media address in text, on its own: not the end of another address such
 * as `https://example.org/media/a.jpg` or `//media/a.jpg`. It's found in
 * whole values, HTML's attributes, Markdown's links and CSS's `url()`s alike.
 */
const ADDRESS = /(?<![\w.~%/:-])\/media\/[\w.~%/-]+/g;

/** Text with every address the storage keeps replaced by its public address. */
export function withStoredAddresses(text: string, storage: MediaStorage): string {
  if (!text.includes("/media/")) return text;
  return text.replace(ADDRESS, (found) => {
    // A sentence can end just after an address: "see /media/a.pdf."
    const address = found.replace(/\.+$/, "");
    let url = storedMediaUrl(storage, address);
    if (!url) {
      try {
        url = storedMediaUrl(storage, decodeURI(address));
      } catch {
        // Not an address it keeps.
      }
    }
    return url ? `${url}${found.slice(address.length)}` : found;
  });
}

function mapStrings<T>(value: T, map: (text: string) => string): T {
  if (typeof value === "string") return map(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)])) as T;
  }
  return value;
}

/**
 * The site with every address of a file its storage keeps replaced by the
 * file's public address: in pages, headers and footers, collections'
 * templates and items, menus, Site Settings, redirects, custom CSS and code,
 * and the credits' addresses, so pages credit stored photos too. A site
 * without stored media is returned as it is.
 */
export function withStoredMedia(content: SiteContent): SiteContent {
  const storage = content.mediaStorage;
  if (!storage || Object.keys(storage.files).length === 0) return content;
  const map = (text: string) => withStoredAddresses(text, storage);
  return {
    ...content,
    settings: mapStrings(content.settings, map),
    menus: mapStrings(content.menus, map),
    ...(content.languageMenus && { languageMenus: mapStrings(content.languageMenus, map) }),
    header: mapStrings(content.header, map),
    footer: mapStrings(content.footer, map),
    ...(content.languageLayouts && { languageLayouts: mapStrings(content.languageLayouts, map) }),
    pages: content.pages.map((page) => ({
      ...page,
      content: { ...page.content, data: mapStrings(page.content.data, map) },
    })),
    collections: content.collections.map((collection) => ({
      ...collection,
      settings: { ...collection.settings, template: mapStrings(collection.settings.template, map) },
      entries: collection.entries.map((entry) => ({
        ...entry,
        content: { ...entry.content, fields: mapStrings(entry.content.fields, map) },
      })),
    })),
    customCss: map(content.customCss),
    ...(content.code && { code: { head: map(content.code.head), body: map(content.code.body) } }),
    ...(content.redirects && {
      redirects: content.redirects.map((redirect) => ({ ...redirect, to: map(redirect.to) })),
    }),
    ...(content.credits && {
      credits: Object.fromEntries(Object.entries(content.credits).map(([url, credit]) => [map(url), credit])),
    }),
    ...(content.descriptions && {
      descriptions: Object.fromEntries(
        Object.entries(content.descriptions).map(([url, description]) => [map(url), description]),
      ),
    }),
  };
}

/** `content/media-storage.json` as `storage` has it, or its removal once there's none. */
export function mediaStorageFileChange(storage: MediaStorage | undefined): FileChange {
  if (!storage) return { path: MEDIA_STORAGE_FILE, delete: true };
  const files = Object.fromEntries(Object.entries(storage.files).sort(([a], [b]) => a.localeCompare(b)));
  return {
    path: MEDIA_STORAGE_FILE,
    content: serializeContent({ version: CURRENT_VERSION.storage, plugin: storage.plugin, url: storage.url, files }),
  };
}

/** The storage with files added (or replaced) and removed. */
export function withStoredFiles(
  storage: MediaStorage,
  added: Record<string, StoredFile>,
  removed: readonly string[] = [],
): MediaStorage {
  const files = { ...storage.files, ...added };
  for (const address of removed) delete files[address];
  return { ...storage, files };
}

/**
 * Whether a change to `content/media-storage.json` keeps which plugin keeps the
 * files and where they're public, changing only which files it keeps, as
 * uploading and removing files do: what someone who isn't an owner may change,
 * since the address decides where every `/media/` address on the site points.
 * `before` is the file's text as it was, if there was one.
 */
export function keepsStorageSettings(before: string | undefined, change: FileChange): boolean {
  if (before === undefined || !("content" in change)) return false;
  const read = (text: string) => {
    try {
      const parsed = mediaStorageFileSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  };
  const was = read(before);
  const now = read(change.content);
  return was !== undefined && now !== undefined && was.plugin === now.plugin && was.url === now.url;
}
