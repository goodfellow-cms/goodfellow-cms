/**
 * Where `next dev` serves the editor's frames, from the local backend beside
 * it (`/__goodfellow/api`, which Next.js passes on), with `version.json`
 * there counting rebuilds.
 */
export const DEV_EDITOR_PREFIX = "/__goodfellow/api/editor/";

/**
 * The Content Security Policy of the page the editor's frames load, which
 * runs the site's config, Puck and every block, sandboxed without
 * `allow-same-origin`: it runs only the site's own scripts (and the inline
 * ones whose hashes are given), and can fetch nothing, though it can still
 * show pictures, styles, fonts and players. A sandboxed page can always leave
 * for another address, so this limits what blocks' code can send, but can't
 * stop it: it's the sandbox that keeps editors' sign-in out of their reach.
 * `'self'` is the page's own address, even in the sandbox's opaque origin.
 */
export function editorPolicy(options: { scriptHashes?: readonly string[]; blobScripts?: boolean } = {}): string {
  const scripts = [
    "'self'",
    ...(options.scriptHashes ?? []).map((hash) => `'${hash}'`),
    ...(options.blobScripts ? ["blob:"] : []),
  ];
  return [
    "default-src 'none'",
    `script-src ${scripts.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    "frame-src https:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

/**
 * The first thing the editor's frames run: it removes WebRTC, which a
 * Content Security Policy can't stop reaching other computers.
 */
export const EDITOR_PRELUDE =
  "(()=>{for(const name of Object.getOwnPropertyNames(globalThis))if(/^(webkit|moz)?RTC/.test(name))try{delete globalThis[name]}catch{}})();";

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The page the editor's frames load, as `goodfellow build`, `goodfellow dev`
 * and `next dev` serve it: its Content Security Policy first, then the
 * bundle's stylesheets and its one classic script. The frames are sandboxed
 * with `allow-scripts` alone, and a page with the sandbox's `null` origin
 * can't load module scripts without the server letting every website's
 * sandboxed pages read them, which no server here does.
 */
export function editorPage(options: { scripts: readonly string[]; stylesheets: readonly string[] }): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    // First, so it applies to everything after it.
    `    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(editorPolicy())}" />`,
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="robots" content="noindex" />',
    ...options.stylesheets.map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}" />`),
    "  </head>",
    "  <body>",
    ...options.scripts.map((src) => `    <script src="${escapeAttribute(src)}"></script>`),
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}
