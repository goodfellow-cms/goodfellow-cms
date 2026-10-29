import type { ImageResizer } from "@goodfellow-cms/core/node";

/**
 * Makes the media library's smaller copies with sharp, in each photo's own
 * format, turned as its details say and without them, or `undefined` where
 * sharp can't load on this computer, which leaves the copies as the photos are.
 */
export async function sharpResizer(): Promise<ImageResizer | undefined> {
  try {
    const { default: sharp } = await import("sharp");
    return async (image, width) => new Uint8Array(await sharp(image).rotate().resize({ width }).toBuffer());
  } catch {
    return undefined;
  }
}
