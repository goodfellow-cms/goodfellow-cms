/**
 * Set while `next build` renders a static export whose images Next.js doesn't
 * optimize, so pages list the smaller copies of the media library's photos
 * (`imageWidths`) that `goodfellow-next finish` writes.
 */
export const IMAGE_SIZES_ENV = "GOODFELLOW_IMAGE_SIZES";

/** The file in `.next/` that tells `goodfellow-next finish` the pages list them. */
export const IMAGE_SIZES_MARK = "goodfellow-image-sizes";

/**
 * Where `withGoodfellow()` records the folder `next build` writes into (the
 * config's `distDir`, `.next` unless it says otherwise), relative to the site,
 * for `goodfellow-next finish`, which runs after it in a process of its own.
 */
export const DIST_DIR_RECORD = "node_modules/.goodfellow/next-dist-dir";

/**
 * Where `withGoodfellow()` puts how the site is served (`SiteServing`) on the
 * function it returns, so `goodfellow-next finish` can read it from
 * `next.config.ts` without building, as it runs before builds that write no
 * `.next/`, such as vinext's. A registered symbol, so every copy of the
 * package reads the same one.
 */
export const SITE_SERVING = Symbol.for("goodfellow.siteServing");

/** How Next.js serves the site: its `basePath`, such as `/my-site` or `""`, and whether addresses end with `/`. */
export interface SiteServing {
  basePath: string;
  trailingSlash: boolean;
}
