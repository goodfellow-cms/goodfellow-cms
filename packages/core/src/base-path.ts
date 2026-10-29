import { trimChars } from "./trim.js";

/** Normalizes a base path to start and end with `/`: `"repo"` → `"/repo/"`. */
export function normalizeBase(base: string | undefined): string {
  const trimmed = trimChars((base ?? "/").trim(), "/");
  return trimmed ? `/${trimmed}/` : "/";
}

/**
 * Prefixes every root-relative URL in rendered HTML with the base path, so a
 * site served from a subfolder (such as GitHub Pages' `/repo/`) keeps working.
 * Covers links and images in blocks, rich text and CSS `url()`s in style attributes.
 * Protocol-relative (`//host`) and absolute URLs are left alone.
 */
export function applyBasePath(html: string, base: string): string {
  const prefix = normalizeBase(base).slice(0, -1);
  if (!prefix) return html;

  return html
    .replace(/(\s(?:href|src|poster|action)=")\/(?!\/)/g, `$1${prefix}/`)
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
