/**
 * Links to the site's own pages as their canonical addresses end, with no
 * imports but the site's reserved paths, since `SiteLink` uses it in visitors'
 * browsers.
 */
import { RESERVED_PAGE_PATHS } from "./paths.js";

/**
 * A page's path as its full address ends it: with a `/` (`/about/`) unless
 * `trailingSlash` is `false`. The home page, files (a last part with a dot,
 * such as `/media/bulletin.pdf`) and paths already ending in one stay as they
 * are, and a `?…` or `#…` stays after it.
 */
export function pageAddressPath(path: string, trailingSlash = true): string {
  const end = path.search(/[?#]/);
  const bare = end === -1 ? path : path.slice(0, end);
  const rest = end === -1 ? "" : path.slice(end);
  if (!trailingSlash) return `${bare === "/" ? bare : bare.replace(/\/+$/, "")}${rest}`;
  const last = bare.slice(bare.lastIndexOf("/") + 1);
  return bare.endsWith("/") || last.includes(".") ? path : `${bare}/${rest}`;
}

/** Addresses on the site that aren't pages or media, which links aren't checked or moved. */
const NOT_PAGES = ["/calendars/", "/pagefind/", "/__goodfellow/"];

/** Where a link goes on the site, or `undefined` for a link elsewhere, or to a file only the build knows about. */
export function linkTarget(link: string): { kind: "page" | "media"; path: string } | undefined {
  const raw = link.trim().split("#")[0]?.split("?")[0] ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//") || /\s/.test(raw)) return undefined;
  let path: string;
  try {
    path = decodeURI(raw);
  } catch {
    path = raw;
  }
  if (path.startsWith("/media/")) return path.length > "/media/".length ? { kind: "media", path } : undefined;
  if (NOT_PAGES.some((prefix) => path.startsWith(prefix))) return undefined;
  if (RESERVED_PAGE_PATHS.some((reserved) => path === reserved || path.startsWith(`${reserved}/`))) return undefined;
  // Other files, such as /favicon.ico or a feed, are the site's code's: only the build knows they're there.
  if (/\.[a-z0-9]+$/i.test(path.split("/").at(-1) ?? "")) return undefined;
  const trimmed = path.replace(/\/+$/, "");
  return { kind: "page", path: trimmed || "/" };
}

/**
 * A link as it points at a page's canonical address: a link to one of the
 * site's own pages (`linkTarget()`) ends with `/`, or without one where
 * `trailingSlash` is `false` (`pageAddressPath()`), keeping its `?…` and `#…`,
 * so following it needs no redirect. Files, other sites' addresses and
 * anything else stay as they are.
 */
export function pageLink(link: string, trailingSlash = true): string {
  return linkTarget(link)?.kind === "page" ? pageAddressPath(link, trailingSlash) : link;
}

/**
 * HTML, such as rich text, with its links to the site's own pages as
 * `pageLink()` writes them. Only `<a>` elements' `href`s change, so code
 * shown as text, whose `<` is escaped, stays as it was written.
 */
export function pageLinksInHtml(html: string, trailingSlash = true): string {
  if (!html.includes("<a")) return html;
  return html.replace(/<a\b[^>]*>/gi, (tag) =>
    tag.replace(/(\shref\s*=\s*)(?:"([^"]*)"|'([^']*)')/i, (match, start: string, double?: string, single?: string) => {
      const value = double ?? single ?? "";
      const next = pageLink(value, trailingSlash);
      if (next === value) return match;
      const quote = double === undefined ? "'" : '"';
      return `${start}${quote}${next}${quote}`;
    }),
  );
}
