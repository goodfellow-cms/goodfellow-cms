// No imports, since the admin panel's page, which runs in the browser, reads it too.

/**
 * Where a full-stack site's editor frames are, in its `public/` folder:
 * under `app/admin/editor/`, whose header rules they share, as one static
 * page. Next.js serves `public/` by each file's own name, so the page is
 * named in full.
 */
export const EDITOR_FRAMES_PATH = "admin/editor/frames/";

/** The frames' page, under `EDITOR_FRAMES_PATH`. */
export const EDITOR_FRAMES_PAGE = `${EDITOR_FRAMES_PATH}index.html`;
