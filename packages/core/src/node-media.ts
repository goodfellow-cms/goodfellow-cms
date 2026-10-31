import { copyFile, mkdir, open, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { IMAGE_WIDTHS, type ImageSize, imageSize, imageVariantPath, imageWidths, MEDIA_DIR } from "./index.js";

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;

/** Enough of a file to find its size, unless a JPEG has a large block of details before its frame. */
const HEADER_BYTES = 64 * 1024;

const cache = new Map<string, { modified: number; size: ImageSize | undefined }>();

async function readHeader(file: string, length: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function sizeOf(file: string): Promise<ImageSize | undefined> {
  const { mtimeMs, size: bytes } = await stat(file);
  const cached = cache.get(file);
  if (cached?.modified === mtimeMs) return cached.size;
  let size = imageSize(await readHeader(file, HEADER_BYTES));
  if (!size && bytes > HEADER_BYTES) size = imageSize(await readHeader(file, bytes));
  cache.set(file, { modified: mtimeMs, size });
  return size;
}

/**
 * The sizes of the images in a site's `public/media/`, by address
 * (`/media/photo.jpg`). Files are only read again once they've changed.
 */
export async function readMediaSizes(root: string): Promise<Record<string, ImageSize>> {
  const dir = join(root, MEDIA_DIR);
  let files: string[];
  try {
    files = (await readdir(dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return {};
  }
  const sizes: Record<string, ImageSize> = {};
  await Promise.all(
    files.map(async (file) => {
      const size = await sizeOf(file).catch(() => undefined);
      if (size) sizes[`/${relative(join(root, "public"), file).split(sep).join("/")}`] = size;
    }),
  );
  return sizes;
}

/** Makes a copy of an image `width` wide, in the image's own format, such as with sharp. */
export type ImageResizer = (image: Uint8Array, width: number) => Promise<Uint8Array>;

export interface ImageSizesResult {
  /** How many smaller copies were written. */
  written: number;
  /** The media library's images that couldn't be made smaller, whose copies are the image as it is. */
  failed: string[];
}

/**
 * Writes the smaller copies of the media library's photos that pages list in
 * their `srcset` (see `imageSrcSet()`) into a built site, at each of `widths`
 * smaller than the photo, as WebP: `dist/media-sizes/800/photo.jpg.webp`. A
 * photo that can't be made smaller, or every one without a `resize`, is
 * copied as it is, so every address pages list is there (browsers read an
 * image by what it is, not its name). Copies already there are kept.
 */
export async function writeImageSizes(
  root: string,
  outDir: string,
  { resize, widths = IMAGE_WIDTHS }: { resize?: ImageResizer; widths?: readonly number[] } = {},
): Promise<ImageSizesResult> {
  const sizes = await readMediaSizes(root);
  const failed: string[] = [];
  let written = 0;
  const jobs = Object.entries(sizes).flatMap(([address, size]) =>
    imageWidths(address, size, widths).length > 0 ? [{ address, size }] : [],
  );
  // A few at a time, since each holds a photo in memory.
  const queue = [...jobs];
  async function work(): Promise<void> {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const source = join(root, "public", job.address.slice(1));
      const targets = imageWidths(job.address, job.size, widths).map((width) => ({
        width,
        file: join(outDir, imageVariantPath(job.address, width).slice(1)),
      }));
      const missing = [];
      for (const target of targets) {
        if (!(await stat(target.file).catch(() => undefined))) missing.push(target);
      }
      if (missing.length === 0) continue;
      const image = resize && (await readFile(source));
      let resized = true;
      for (const target of missing) {
        await mkdir(dirname(target.file), { recursive: true });
        const bytes = image && resize ? await resize(image, target.width).catch(() => undefined) : undefined;
        if (bytes) await writeFile(target.file, bytes);
        else {
          resized = false;
          await copyFile(source, target.file);
        }
        written += 1;
      }
      if (!resized) failed.push(job.address);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, work));
  return { written, failed: failed.sort() };
}
