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
