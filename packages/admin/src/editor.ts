/**
 * The site's side of the admin panel: Puck, the site's config and every block,
 * run in frames sandboxed away from the admin panel's own page. Builds and the
 * Next.js starter give it the site's config in a page of its own.
 */
export { type EditorFrameOptions, mountEditorFrame } from "./frame/app.js";
