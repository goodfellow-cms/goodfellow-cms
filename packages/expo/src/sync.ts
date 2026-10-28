/**
 * Keeping an app's copy of a site up to date from its content API, with no
 * React Native, so it's tested in Node: the manifest says what each file's
 * hash is, so only what changed is downloaded, and what's kept is shown
 * offline. Content newer than the app reads is left until the app updates.
 */
import { CURRENT_VERSION, mediaKind } from "@goodfellow-cms/core";
import type {
  ApiCollectionsFile,
  ApiLayoutFile,
  ApiManifest,
  ApiPageFile,
  ApiSiteFile,
} from "@goodfellow-cms/core/content-api";

/** Where the app keeps its copy: text files by name, and downloaded media. */
export interface ContentStorage {
  read(name: string): Promise<string | undefined>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** Every file kept, text and media, by name. */
  list(): Promise<string[]>;
  /** Downloads a file from the web into `name`, such as a picture, and gives the address the app shows it from. */
  download?(url: string, name: string): Promise<string>;
  /** The address a downloaded file is shown from, if it's kept. */
  fileUri?(name: string): Promise<string | undefined>;
}

/** Keeps everything in memory, for tests and for apps that don't keep content between launches. */
export function memoryStorage(): ContentStorage & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (name) => files.get(name),
    write: async (name, text) => {
      files.set(name, text);
    },
    remove: async (name) => {
      files.delete(name);
    },
    list: async () => [...files.keys()],
  };
}

/** A page the manifest lists. */
export type ManifestPage = ApiManifest["pages"][number];

export interface SyncOptions {
  /** The Site address, where the site is published, such as `https://parish.example/` or `https://name.github.io/site/`. */
  site: string;
  storage: ContentStorage;
  fetch?: typeof fetch;
  /**
   * Which pages to download ahead, so they show offline. Every page by
   * default; larger sites can keep fewer, and the rest load when they're opened.
   */
  keep?: (page: ManifestPage) => boolean;
  /** Whether to download the pictures kept pages and the site's files show, so they show offline too. On by default. */
  media?: boolean;
}

export interface SyncResult {
  /** The manifest the app's copy now follows, if it has one. */
  manifest?: ApiManifest;
  /** The files downloaded. */
  changed: string[];
  /** The files removed, since the site no longer has them or they changed. */
  removed: string[];
  /** Why the copy wasn't brought up to date, if it wasn't. */
  problem?: "offline" | "newer-content" | "no-api";
}

/** Where the app keeps the manifest it follows. */
export const MANIFEST_FILE = "manifest.json";

/** Where downloaded media is kept, by its address on the site: `media/` then the address after `/media/`. */
export const MEDIA_FOLDER = "media/";

/** The content API's address on the site: `/api/` under its address. */
export function apiAddress(site: string, file = MANIFEST_FILE): string {
  return new URL(`api/${file}`, site.endsWith("/") ? site : `${site}/`).href;
}

/** A site address as the app opens it: a root-relative one (`/about`) at the site, with its base path. */
export function siteAddress(site: string, manifest: Pick<ApiManifest, "base"> | undefined, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const root = new URL(site.endsWith("/") ? site : `${site}/`);
  const base = manifest?.base ?? "/";
  // The Site address already includes the base path, such as https://name.github.io/site/.
  const origin = root.pathname.endsWith(base) ? root.href.slice(0, root.href.length - base.length) : root.origin;
  return `${origin}${base}${href.slice(1)}`;
}

/** Whether the app reads every kind of content file the site's build did, so it can show what it downloads. */
export function readsContent(manifest: Pick<ApiManifest, "version" | "content">): boolean {
  if (manifest.version !== 1) return false;
  return Object.entries(manifest.content).every(
    ([kind, version]) => version <= (CURRENT_VERSION[kind as keyof typeof CURRENT_VERSION] ?? 0),
  );
}

/** Every file of the manifest's that the app keeps: each language's files, and the pages it keeps ahead. */
function wantedFiles(manifest: ApiManifest, keep: (page: ManifestPage) => boolean): Map<string, string> {
  const files = new Map<string, string>();
  for (const language of Object.values(manifest.languages)) {
    for (const file of [language.site, language.collections, language.header, language.footer]) {
      files.set(file.file, file.hash);
    }
  }
  for (const page of manifest.pages) if (keep(page)) files.set(page.file, page.hash);
  return files;
}

/** Every file's hash, as a manifest lists them. */
function hashes(manifest: ApiManifest | undefined): Map<string, string> {
  const files = new Map<string, string>();
  if (!manifest) return files;
  for (const language of Object.values(manifest.languages)) {
    for (const file of [language.site, language.collections, language.header, language.footer]) {
      files.set(file.file, file.hash);
    }
  }
  for (const page of manifest.pages) files.set(page.file, page.hash);
  return files;
}

/**
 * The pictures a file shows: every `/media/…` address of an image in it.
 * Videos, sound and other files are left to the site, which plays them as
 * they're needed, since keeping them would fill the phone.
 */
export function mediaAddresses(text: string): string[] {
  return [...new Set([...text.matchAll(/"(\/media\/[^"\\?#]+)/g)].map((match) => match[1] ?? ""))].filter(
    (address) => address && mediaKind(address) === "image",
  );
}

/** Where a media address is kept. */
export function mediaFile(address: string): string {
  return `${MEDIA_FOLDER}${address.slice("/media/".length)}`;
}

async function readManifest(storage: ContentStorage): Promise<ApiManifest | undefined> {
  const text = await storage.read(MANIFEST_FILE);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ApiManifest;
  } catch {
    return undefined;
  }
}

/** Runs tasks a few at a time, so a phone isn't asked for hundreds of downloads at once. */
async function inTurn<T>(items: readonly T[], run: (item: T) => Promise<void>, at = 4): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(at, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++] as T;
        await run(item);
      }
    }),
  );
}

/**
 * Brings the app's copy of the site up to date: reads the manifest, downloads
 * the files whose hash changed, removes the ones the site no longer has, and
 * downloads the pictures they show. Offline, or when the site's content is
 * newer than the app reads, it keeps the copy it has.
 */
export async function syncSite(options: SyncOptions): Promise<SyncResult> {
  const { site, storage } = options;
  const get = options.fetch ?? fetch;
  const keep = options.keep ?? (() => true);
  const kept = await readManifest(storage);
  let manifest: ApiManifest;
  try {
    const response = await get(apiAddress(site), { cache: "no-store" });
    if (!response.ok) {
      return { ...(kept && { manifest: kept }), changed: [], removed: [], problem: "no-api" };
    }
    manifest = (await response.json()) as ApiManifest;
  } catch {
    return { ...(kept && { manifest: kept }), changed: [], removed: [], problem: "offline" };
  }
  if (!readsContent(manifest)) {
    return { ...(kept && { manifest: kept }), changed: [], removed: [], problem: "newer-content" };
  }

  const before = hashes(kept);
  const after = hashes(manifest);
  const stored = new Set(await storage.list());
  const wanted = wantedFiles(manifest, keep);
  const changed: string[] = [];
  const removed: string[] = [];

  // Files the site no longer has, or whose content changed, aren't kept as they were.
  for (const name of stored) {
    if (name === MANIFEST_FILE || name.startsWith(MEDIA_FOLDER)) continue;
    if (after.get(name) !== before.get(name)) {
      await storage.remove(name);
      removed.push(name);
      stored.delete(name);
    }
  }

  const texts = new Map<string, string>();
  try {
    await inTurn([...wanted.keys()], async (name) => {
      if (stored.has(name)) return;
      const response = await get(apiAddress(site, name));
      if (!response.ok) throw new Error(`${name}: ${response.status}`);
      const text = await response.text();
      await storage.write(name, text);
      texts.set(name, text);
      changed.push(name);
    });
  } catch {
    // Part of the copy is new and part isn't yet: the old manifest stays, so the rest comes next time.
    return { ...(kept && { manifest: kept }), changed, removed, problem: "offline" };
  }

  if (options.media !== false && storage.download) {
    const shown = new Set<string>();
    for (const name of wanted.keys()) {
      const text = texts.get(name) ?? (await storage.read(name)) ?? "";
      for (const address of mediaAddresses(text)) shown.add(mediaFile(address));
    }
    const download = storage.download.bind(storage);
    await inTurn(
      [...shown].filter((file) => !stored.has(file)),
      async (file) => {
        try {
          await download(siteAddress(site, manifest, `/media/${file.slice(MEDIA_FOLDER.length)}`), file);
          changed.push(file);
        } catch {
          // A picture that can't be downloaded shows from the site while the app is online.
        }
      },
    );
    for (const file of stored) {
      if (file.startsWith(MEDIA_FOLDER) && !shown.has(file)) {
        await storage.remove(file);
        removed.push(file);
      }
    }
  }

  await storage.write(MANIFEST_FILE, JSON.stringify(manifest));
  return { manifest, changed, removed };
}

/** The files of the app's copy, read as their types. */
export interface SiteFiles {
  site: ApiSiteFile;
  collections: ApiCollectionsFile;
  header: ApiLayoutFile;
  footer: ApiLayoutFile;
}

async function readJson<T>(storage: ContentStorage, name: string): Promise<T | undefined> {
  const text = await storage.read(name);
  return text ? (JSON.parse(text) as T) : undefined;
}

/** A language's site, collections, header and footer from the app's copy, if it has them. */
export async function readSiteFiles(
  storage: ContentStorage,
  manifest: ApiManifest,
  language = manifest.mainLanguage,
): Promise<SiteFiles | undefined> {
  const files = manifest.languages[language] ?? manifest.languages[manifest.mainLanguage];
  if (!files) return undefined;
  const [site, collections, header, footer] = await Promise.all([
    readJson<ApiSiteFile>(storage, files.site.file),
    readJson<ApiCollectionsFile>(storage, files.collections.file),
    readJson<ApiLayoutFile>(storage, files.header.file),
    readJson<ApiLayoutFile>(storage, files.footer.file),
  ]);
  return site && collections && header && footer ? { site, collections, header, footer } : undefined;
}

/** The manifest's page for an address, ignoring a trailing slash; "Page not found" (`/404`) for one it doesn't have. */
export function findPage(manifest: ApiManifest, path: string): ManifestPage | undefined {
  const wanted = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return manifest.pages.find((page) => page.path === wanted) ?? manifest.pages.find((page) => page.path === "/404");
}

/**
 * A page from the app's copy, or downloaded and kept when it's opened if the
 * app doesn't keep it ahead. `undefined` when it's neither kept nor reachable.
 */
export async function loadPage(
  options: Pick<SyncOptions, "site" | "storage" | "fetch">,
  manifest: ApiManifest,
  path: string,
): Promise<ApiPageFile | undefined> {
  const page = findPage(manifest, path);
  if (!page) return undefined;
  const kept = await readJson<ApiPageFile>(options.storage, page.file);
  if (kept) return kept;
  try {
    const response = await (options.fetch ?? fetch)(apiAddress(options.site, page.file));
    if (!response.ok) return undefined;
    const text = await response.text();
    await options.storage.write(page.file, text);
    return JSON.parse(text) as ApiPageFile;
  } catch {
    return undefined;
  }
}

/** The address the app shows a site's media from: its downloaded copy, or the site's own. */
export async function mediaUri(
  options: Pick<SyncOptions, "site" | "storage">,
  manifest: Pick<ApiManifest, "base"> | undefined,
  address: string,
): Promise<string> {
  if (address.startsWith("/media/") && options.storage.fileUri) {
    const kept = await options.storage.fileUri(mediaFile(address.split(/[?#]/)[0] ?? address));
    if (kept) return kept;
  }
  return siteAddress(options.site, manifest, address);
}
