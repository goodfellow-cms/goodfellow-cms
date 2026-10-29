/**
 * Set while `next build` renders a static export whose images Next.js doesn't
 * optimize, so pages list the smaller copies of the media library's photos
 * (`imageWidths`) that `goodfellow-next finish` writes.
 */
export const IMAGE_SIZES_ENV = "GOODFELLOW_IMAGE_SIZES";

/** The file in `.next/` that tells `goodfellow-next finish` the pages list them. */
export const IMAGE_SIZES_MARK = "goodfellow-image-sizes";
