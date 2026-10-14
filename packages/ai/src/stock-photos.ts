/**
 * Openly licensed photos from Openverse (https://openverse.org), which gathers
 * Creative Commons and public domain images from Wikimedia Commons, Flickr and
 * other collections. Searched straight from the editor's browser, with no key.
 *
 * The AI marks an image field it has no photo for with a search, such as
 * `stock-photo: church choir singing`; the admin panel finds a photo for each,
 * adds it to the media library with its credit, and puts its address there.
 */
import type { PhotoCredit } from "@goodfellow-cms/core";

/** How the AI marks an image field it wants a photo found for: the prefix, then a few words saying what to find. */
export const STOCK_PHOTO_PREFIX = "stock-photo:";

export const OPENVERSE_API = "https://api.openverse.org/v1";

/**
 * Licenses that allow commercial use and changes, such as cropping: CC BY,
 * CC BY-SA, CC0 and the Public Domain Mark. Openverse's own codes.
 */
export const STOCK_PHOTO_LICENSES = ["by", "by-sa", "cc0", "pdm"] as const;

/** How many photos one request can add, so a request stays within Openverse's limits for searches without a key. */
export const MAX_STOCK_PHOTOS = 6;

/** Photos narrower than this are passed over where a larger one was found, since blocks show photos wide. */
const MIN_WIDTH = 800;

export interface StockPhoto {
  id: string;
  title: string;
  creator: string;
  creatorUrl?: string;
  /** The photo's own page where it came from. */
  landingUrl?: string;
  /** Openverse's license code, such as `by`. */
  license: string;
  licenseVersion: string;
  licenseUrl?: string;
  /** Where it came from, such as `flickr`. */
  source: string;
  width?: number;
  height?: number;
  /** The photo at full size, through Openverse, which browsers can download from any site. */
  downloadUrl: string;
}

export type StockPhotoProblem = "busy" | "unreachable";

/** Openverse couldn't be asked, or was asked too often. */
export class StockPhotoError extends Error {
  override name = "StockPhotoError";

  constructor(
    readonly problem: StockPhotoProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface StockPhotoOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function webAddress(value: unknown): string | undefined {
  const address = text(value);
  return /^https?:\/\//i.test(address) ? address : undefined;
}

function size(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

async function ask(url: string, options: StockPhotoOptions): Promise<Response> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, { signal: options.signal });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new StockPhotoError("unreachable", `Couldn't reach Openverse: ${(error as Error).message}`);
  }
  if (response.status === 429) throw new StockPhotoError("busy", "Openverse has had too many requests from here.");
  if (!response.ok) throw new StockPhotoError("unreachable", `Openverse answered ${response.status}.`);
  return response;
}

/** Photos for a search, best first, whose licenses allow commercial use and changes. */
export async function searchStockPhotos(query: string, options: StockPhotoOptions = {}): Promise<StockPhoto[]> {
  const params = new URLSearchParams({
    q: query,
    license: STOCK_PHOTO_LICENSES.join(","),
    category: "photograph",
    mature: "false",
    page_size: "10",
  });
  const response = await ask(`${OPENVERSE_API}/images/?${params}`, options);
  const body = (await response.json()) as { results?: unknown };
  const results = Array.isArray(body.results) ? body.results : [];
  return results.flatMap((result): StockPhoto[] => {
    const item = result as Record<string, unknown>;
    const id = text(item.id);
    const license = text(item.license).toLowerCase();
    // Only the licenses asked for, whatever Openverse sends.
    if (!/^[\w-]+$/.test(id) || !(STOCK_PHOTO_LICENSES as readonly string[]).includes(license)) return [];
    return [
      {
        id,
        title: text(item.title),
        creator: text(item.creator),
        creatorUrl: webAddress(item.creator_url),
        landingUrl: webAddress(item.foreign_landing_url),
        license,
        licenseVersion: text(item.license_version),
        licenseUrl: webAddress(item.license_url),
        source: text(item.source) || text(item.provider),
        width: size(item.width),
        height: size(item.height),
        downloadUrl: `${OPENVERSE_API}/images/${encodeURIComponent(id)}/thumb/?full_size=true&compressed=false`,
      },
    ];
  });
}

/** The photo to use from a search's results: the first that's wide enough, or else the first. */
export function pickStockPhoto(photos: readonly StockPhoto[]): StockPhoto | undefined {
  return photos.find((photo) => (photo.width ?? MIN_WIDTH) >= MIN_WIDTH) ?? photos[0];
}

/** Downloads a photo, at full size, through Openverse. */
export async function downloadStockPhoto(photo: StockPhoto, options: StockPhotoOptions = {}): Promise<Blob> {
  const response = await ask(photo.downloadUrl, options);
  return response.blob();
}

const LICENSE_NAMES: Record<string, string> = {
  by: "CC BY",
  "by-sa": "CC BY-SA",
  cc0: "CC0",
  pdm: "Public Domain Mark",
};

/** Collections' names as they call themselves, for Openverse's sources that aren't one word. */
const SOURCE_NAMES: Record<string, string> = {
  flickr: "Flickr",
  wikimedia: "Wikimedia Commons",
  rawpixel: "rawpixel",
  nappy: "nappy",
  stocksnap: "StockSnap",
  smithsonian: "Smithsonian",
  met: "The Metropolitan Museum of Art",
  nasa: "NASA",
};

function sourceName(source: string): string {
  if (SOURCE_NAMES[source]) return SOURCE_NAMES[source];
  if (source.startsWith("smithsonian_")) return "Smithsonian";
  return source.replace(/[_-]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/** A photo's credit, as the site shows it: its title, who made it, where it came from and its license. */
export function stockPhotoCredit(photo: StockPhoto): PhotoCredit {
  const license = [LICENSE_NAMES[photo.license] ?? photo.license.toUpperCase(), photo.licenseVersion]
    .filter(Boolean)
    .join(" ");
  return {
    title: photo.title,
    creator: photo.creator,
    ...(photo.creatorUrl && { creatorUrl: photo.creatorUrl }),
    source: sourceName(photo.source),
    ...(photo.landingUrl && { sourceUrl: photo.landingUrl }),
    license,
    ...(photo.licenseUrl && { licenseUrl: photo.licenseUrl }),
  };
}

/** The search in a value the AI marked, such as `church choir` for `stock-photo: church choir`, or `undefined`. */
export function stockPhotoQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed.toLowerCase().startsWith(STOCK_PHOTO_PREFIX)) return undefined;
  return trimmed.slice(STOCK_PHOTO_PREFIX.length).trim().replace(/\s+/g, " ").slice(0, 100) || undefined;
}

/** Every search the AI asked for anywhere in an answer, once each, in the order they come. */
export function stockPhotoQueries(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    const query = stockPhotoQuery(item);
    if (query) found.add(query);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return [...found];
}

/**
 * Puts the photos found in place of the AI's searches: `photos` maps each
 * search to the photo's address. A search with no photo leaves the field empty.
 */
export function withStockPhotos<T>(value: T, photos: ReadonlyMap<string, string>): T {
  const replace = (item: unknown): unknown => {
    const query = stockPhotoQuery(item);
    if (query !== undefined) return photos.get(query) ?? "";
    if (typeof item === "string" && item.trim().toLowerCase().startsWith(STOCK_PHOTO_PREFIX)) return "";
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, replace(entry)]));
    }
    return item;
  };
  return replace(value) as T;
}
