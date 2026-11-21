import { trimChars } from "./trim.js";

/** Normalizes a base path to start and end with `/`: `"repo"` → `"/repo/"`. */
export function normalizeBase(base: string | undefined): string {
  const trimmed = trimChars((base ?? "/").trim(), "/");
  return trimmed ? `/${trimmed}/` : "/";
}

/**
 * Prefixes every root-relative URL in rendered HTML with the base path, so a
 * site served from a subfolder (such as GitHub Pages' `/repo/`) keeps working.
 * Covers links and images in blocks, rich text, and CSS `url()`s in style attributes.
 * Protocol-relative (`//host`) and absolute URLs are left alone.
 */
export function applyBasePath(html: string, base: string): string {
  const prefix = normalizeBase(base).slice(0, -1);
  if (!prefix) return html;

  return html
    .replace(/(\s(?:href|src|poster|action|data-gf-base)=")\/(?!\/)/g, `$1${prefix}/`)
    .replace(/(\s(?:image)?srcset=")([^"]*)"/gi, (_, start: string, value: string) => {
      const rewritten = value
        .split(",")
        .map((candidate) => candidate.replace(/^(\s*)\/(?!\/)/, `$1${prefix}/`))
        .join(",");
      return `${start}${rewritten}"`;
    })
    .replace(/(\sstyle="[^"]*)/g, (style: string) =>
      style.replace(/url\((&quot;|&#x27;|'|)\/(?!\/)/g, `url($1${prefix}/`),
    );
}

/**
 * Prefixes one root-relative address with the base path: `/about` → `/repo/about`.
 * Absolute, protocol-relative (`//host`), relative and fragment addresses are left alone.
 */
export function withBase(url: string, base: string | undefined): string {
  const prefix = normalizeBase(base).slice(0, -1);
  return prefix && url.startsWith("/") && !url.startsWith("//") ? `${prefix}${url}` : url;
}

/**
 * Whether text holds a control character (U+0000 to U+001F, and U+007F), such
 * as a tab, a line break, or a backspace, which CSS and the URL parser read
 * differently.
 */
export function hasControlCharacter(text: string): boolean {
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * An address as CSS's `url("…")`, which CSS reads back as the same address, or
 * `undefined` for one holding a control character. Escapes in a JavaScript or
 * JSON string mean something else to CSS (`\r` is the letter r there, and `\b`
 * and `\f` start hexadecimal numbers), and the URL parser drops tabs and line
 * breaks that CSS keeps, so an address with one is left out rather than
 * written as something a reader of the setting wouldn't see.
 */
export function cssUrl(address: string): string | undefined {
  if (hasControlCharacter(address)) return undefined;
  return `url("${address.replace(/["\\]/g, (char) => `\\${char}`)}")`;
}
