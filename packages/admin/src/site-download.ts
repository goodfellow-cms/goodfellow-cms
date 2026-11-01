/**
 * A copy of the site to keep: its content, its media library and the records
 * of the blocks and plugins it installed, as one zip file, read at the
 * revision the admin panel loaded. fflate is loaded only when a copy is made.
 * No React or DOM, so it's tested in Node.
 */
import { CONTENT_DIR, INSTALLED_PLUGINS_FILE, INSTALLED_RECORD_FILE, MEDIA_DIR } from "@goodfellow-cms/core";

/** The folders a copy holds whole. */
export const DOWNLOAD_FOLDERS = [CONTENT_DIR, MEDIA_DIR] as const;

/** Single files a copy holds where the site has them: which blocks and plugins it installed, to add them again. */
export const DOWNLOAD_RECORDS = [INSTALLED_RECORD_FILE, INSTALLED_PLUGINS_FILE] as const;

/** How many files are read at once. */
const READ_AT_ONCE = 6;

/** Files that are already compressed are stored as they are, which is as small and much quicker. */
const COMPRESSED = /\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|m4v|mp3|m4a|ogg|oga|wav|pdf|woff2?|zip|gz)$/i;

/** Every file a copy holds, sorted, from the folders and records the site has. */
export async function downloadPaths(list: (dir: string) => Promise<string[]>): Promise<string[]> {
  const folders = await Promise.all(DOWNLOAD_FOLDERS.map((dir) => list(dir)));
  const records = await Promise.all(
    DOWNLOAD_RECORDS.map(async (path) => {
      const dir = path.slice(0, path.lastIndexOf("/"));
      return (await list(dir)).includes(path) ? [path] : [];
    }),
  );
  return [...new Set([...folders.flat(), ...records.flat()])].sort();
}

/**
 * The copy's file name: the site's title in plain letters, then the day,
 * `st-anne-parish-2026-11-01.zip`, or `site-…` for a title with none.
 */
export function downloadName(title: string | undefined, date: Date): string {
  const slug =
    (title ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
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

/** How far a copy has got. */
export interface DownloadProgress {
  done: number;
  total: number;
}

/**
 * Zips the files, read with `read`, in the order given, a few at a time, and
 * returns the zip in pieces, for a `Blob`. A file that's gone since it was
 * listed is left out. Throws what reading throws.
 */
export async function siteArchive(
  paths: readonly string[],
  read: (path: string) => Promise<Uint8Array | undefined>,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<Uint8Array[]> {
  const { Zip, ZipDeflate, ZipPassThrough } = await import("fflate");
  const chunks: Uint8Array[] = [];
  let finish: () => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) return fail(error);
    chunks.push(chunk);
    if (final) finish();
  });
  let done = 0;
  onProgress?.({ done, total: paths.length });
  try {
    for (let start = 0; start < paths.length; start += READ_AT_ONCE) {
      const batch = paths.slice(start, start + READ_AT_ONCE);
      const files = await Promise.all(batch.map((path) => read(path)));
      batch.forEach((path, index) => {
        const bytes = files[index];
        if (bytes) {
          const entry = COMPRESSED.test(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
          zip.add(entry);
          entry.push(bytes, true);
        }
        done += 1;
      });
      onProgress?.({ done, total: paths.length });
    }
  } catch (error) {
    zip.terminate();
    throw error;
  }
  zip.end();
  await finished;
  return chunks;
}
