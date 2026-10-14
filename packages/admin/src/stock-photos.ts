import {
  downloadStockPhoto,
  MAX_STOCK_PHOTOS,
  pickStockPhoto,
  StockPhotoError,
  searchStockPhotos,
  stockPhotoCredit,
} from "@goodfellow-cms/ai";
import { type FileChange, MEDIA_DIR, type PhotoCredit } from "@goodfellow-cms/core";
import { slugify } from "./changes.js";
import { fileName, mediaUrl, uploadName } from "./media.js";
import { prepareUpload } from "./upload.js";

/** The file types Openverse's downloads can come as that the media library takes. */
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface FoundPhoto {
  query: string;
  url: string;
  bytes: Uint8Array;
  credit: PhotoCredit;
}

export interface FoundPhotos {
  photos: FoundPhoto[];
  /** How many searches found no photo that could be used. */
  missing: number;
  /** Why the searches stopped early, if they did, such as Openverse having had too many requests. */
  problem?: StockPhotoError;
}

/**
 * Finds a photo for each of the AI's searches on Openverse, downloads it and
 * gets it ready to add to the media library under a name that isn't taken.
 * Searches past `MAX_STOCK_PHOTOS` find nothing.
 */
export async function findStockPhotos(
  queries: readonly string[],
  options: { taken: Iterable<string>; fetch?: typeof fetch; signal?: AbortSignal },
): Promise<FoundPhotos> {
  const taken = [...options.taken];
  const photos: FoundPhoto[] = [];
  let problem: StockPhotoError | undefined;
  for (const query of queries.slice(0, MAX_STOCK_PHOTOS)) {
    try {
      const photo = pickStockPhoto(await searchStockPhotos(query, options));
      if (!photo) continue;
      const blob = await downloadStockPhoto(photo, options);
      const extension = EXTENSIONS[blob.type.split(";")[0]?.trim().toLowerCase() ?? ""];
      if (!extension) continue;
      const name = uploadName(`${slugify(query).slice(0, 40) || "photo"}.${extension}`, taken);
      const prepared = await prepareUpload(new File([blob], name, { type: blob.type }));
      taken.push(name);
      photos.push({
        query,
        url: mediaUrl(`${MEDIA_DIR}/${name}`),
        bytes: prepared.bytes,
        credit: stockPhotoCredit(photo),
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof StockPhotoError) {
        problem = error;
        break;
      }
      // A photo that can't be read is passed over, as if none had been found.
    }
  }
  return { photos, missing: queries.length - photos.length, problem };
}

/** The media files for photos found, ready to publish with their credits (see `mediaFileChange()`). */
export function stockPhotoChanges(photos: readonly FoundPhoto[]): FileChange[] {
  return photos.map((photo) => ({ path: `${MEDIA_DIR}/${fileName(photo.url)}`, bytes: photo.bytes }));
}
