import type { ImageSize } from "./image-size.js";

/**
 * The widths builds make smaller copies of the media library's photos at, so
 * phones and narrow columns download no more than they show. Only widths
 * smaller than a photo's own are made; the photo itself is the largest.
 */
export const IMAGE_WIDTHS: readonly number[] = [480, 800, 1200, 1600];

/**
 * Where builds write the smaller copies, beside `media/`, as WebP, which is a
 * third or so smaller than the same photo as a JPEG: `/media/a/photo.jpg` at
 * 800 is `/media-sizes/800/a/photo.jpg.webp`, keeping the photo's own name so
 * `photo.jpg` and `photo.png` don't share one. The photo itself, in `src`,
 * stays as it was uploaded.
 */
export const MEDIA_SIZES_DIR = "media-sizes";

/** The media library's files builds make smaller copies of: photos a browser can show, but not GIFs, which may move. */
const RESIZED = /^\/media\/.+\.(jpe?g|png|webp)$/i;

/** The widths a build makes of the image at `src`, of `size`, from `widths`: none for SVGs, GIFs and other sites' images. */
export function imageWidths(
  src: string,
  size: ImageSize | undefined,
  widths: readonly number[] = IMAGE_WIDTHS,
): number[] {
  if (!size || !RESIZED.test(src)) return [];
  return widths.filter((width) => width < size.width);
}

/** The address of the copy of the media library's image at `src` that's `width` wide. */
export function imageVariantPath(src: string, width: number): string {
  return `/${MEDIA_SIZES_DIR}/${width}/${src.slice("/media/".length)}.webp`;
}

/**
 * The `srcset` for the media library's image at `src`, of `size`: each copy a
 * build makes, then the image itself, or `undefined` where there's no copy.
 * Addresses are as `src` is, without the site's base path.
 */
export function imageSrcSet(
  src: string,
  size: ImageSize | undefined,
  widths: readonly number[] = IMAGE_WIDTHS,
): string | undefined {
  const made = imageWidths(src, size, widths);
  if (!size || made.length === 0) return undefined;
  return [...made.map((width) => `${imageVariantPath(src, width)} ${width}w`), `${src} ${size.width}w`].join(", ");
}
