/**
 * Redirects (`content/redirects.json`): old addresses that send visitors on to
 * a page of the site or another website. Static hosts can't answer with a
 * redirect, so builds write a page at each old address that sends visitors on
 * at once, which search engines treat as a permanent redirect.
 */
import { z } from "zod";
import { withBase } from "../base-path.js";
import { absoluteUrl } from "../head.js";
import type { BuildFile } from "./calendars.js";
import type { SiteContent } from "./load.js";
import { isReservedPagePath } from "./paths.js";

export const redirectSchema = z.object({
  /** The old address, such as `/about-us`, on this site. */
  from: z.string(),
  /** Where visitors go: an address on this site, such as `/about`, or another website's, starting `https://`. */
  to: z.string(),
});

export const redirectsFileSchema = z.object({
  version: z.literal(1),
  redirects: z.array(redirectSchema).default([]),
});

export type Redirect = z.output<typeof redirectSchema>;
export type RedirectsFile = z.output<typeof redirectsFileSchema>;

/** Why a redirect can't be used, which the admin panel explains. */
export type RedirectProblem =
  | "no-from"
  | "bad-from"
  | "query"
  | "home"
  | "reserved"
  | "no-to"
  | "bad-to"
  | "loop"
  | "duplicate";

/** Addresses Goodfellow writes files at itself, besides the admin panel's. */
const RESERVED_PREFIXES = ["/media", "/calendars", "/pagefind", "/_next"];

/** Characters a part of an old address can't have, since builds write a folder named after it. */
const UNSAFE_SEGMENT = /[\s\\/?#<>"|*:%\p{Cc}]/u;

type FromResult = { ok: true; path: string } | { ok: false; problem: "no-from" | "bad-from" | "query" | "home" };

/**
 * An old address as redirects store it: `/about-us`, without a trailing slash,
 * with any `%` codes spelled out. A full address, such as one copied from the
 * old site, gives its path.
 */
export function redirectFrom(input: string): FromResult {
  let text = input.trim();
  if (!text) return { ok: false, problem: "no-from" };
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = `${url.pathname}${url.search}`;
    } catch {
      return { ok: false, problem: "bad-from" };
    }
  }
  // Visitors' browsers never send what's after #, and static hosts can't tell addresses apart by what's after ?.
  if (text.includes("?")) return { ok: false, problem: "query" };
  if (!text.startsWith("/") || text.startsWith("//") || text.includes("#")) return { ok: false, problem: "bad-from" };
  const segments = text.split("/").slice(1);
  if (segments.at(-1) === "") segments.pop();
  if (segments.length === 0) return { ok: false, problem: "home" };
  const decoded: string[] = [];
  for (const segment of segments) {
    let part: string;
    try {
      part = decodeURIComponent(segment);
    } catch {
      return { ok: false, problem: "bad-from" };
    }
    if (!part || part === "." || part === ".." || UNSAFE_SEGMENT.test(part)) return { ok: false, problem: "bad-from" };
    decoded.push(part);
  }
  return { ok: true, path: `/${decoded.join("/")}` };
}

/** Where a redirect sends visitors, if it's an address on this site (`/about`) or another website's (`https://`). */
export function redirectTarget(input: string): string | undefined {
  const text = input.trim();
  if (text.startsWith("/") && !text.startsWith("//") && !/[\s\\]/.test(text)) return text;
  if (!/^https?:\/\//i.test(text)) return undefined;
  try {
    return new URL(text).href;
  } catch {
    return undefined;
  }
}

/** Whether Goodfellow uses an address itself, so a redirect can't take it. */
export function isReservedRedirect(path: string): boolean {
  return (
    isReservedPagePath(path) || RESERVED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

/** The old address a target on this site comes down to, without what's after `?` or `#`. */
function targetPath(to: string): string | undefined {
  if (!to.startsWith("/")) return undefined;
  const result = redirectFrom(to.split(/[?#]/)[0] ?? "");
  return result.ok ? result.path : undefined;
}

/** What's wrong with each redirect, by position, or `undefined` for one that's fine. */
export function redirectProblems(redirects: readonly Redirect[]): Array<RedirectProblem | undefined> {
  const seen = new Set<string>();
  return redirects.map((redirect) => {
    const from = redirectFrom(redirect.from);
    if (!from.ok) return from.problem;
    if (isReservedRedirect(from.path)) return "reserved";
    if (seen.has(from.path)) return "duplicate";
    seen.add(from.path);
    if (!redirect.to.trim()) return "no-to";
    const to = redirectTarget(redirect.to);
    if (!to) return "bad-to";
    if (targetPath(to) === from.path) return "loop";
    return undefined;
  });
}

/** Redirects as the admin panel writes them: old addresses spelled one way, and targets trimmed. */
export function storedRedirects(redirects: readonly Redirect[]): Redirect[] {
  return redirects.map(({ from, to }) => {
    const path = redirectFrom(from);
    return { from: path.ok ? path.path : from.trim(), to: redirectTarget(to) ?? to.trim() };
  });
}

/** The file a build writes for an old address: `/about-us` → `about-us/index.html`, `/news.html` → `news.html`. */
export function redirectOutputFile(from: string): string {
  const path = from.slice(1);
  return /\.html?$/i.test(path) ? path : `${path}/index.html`;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A page that sends visitors on at once, and tells search engines where the page is now. */
export function redirectPage(content: Pick<SiteContent, "settings">, to: string, base?: string): string {
  const { settings } = content;
  const href = withBase(to, base);
  const canonical = to.startsWith("/") ? settings.url && absoluteUrl(settings.url, to) : to;
  const link = escapeAttribute(href);
  return [
    "<!doctype html>",
    `<html lang="${escapeAttribute(settings.language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeAttribute(settings.title)}</title>`,
    '<meta name="robots" content="noindex">',
    ...(canonical ? [`<link rel="canonical" href="${escapeAttribute(canonical)}">`] : []),
    `<meta http-equiv="refresh" content="0; url=${link}">`,
    "</head>",
    `<body><a href="${link}">${link}</a></body>`,
    "</html>",
    "",
  ].join("\n");
}

/** The redirect for an address, if one sends visitors on from it. Pages always win over redirects. */
export function findRedirect(content: Pick<SiteContent, "redirects">, path: string): Redirect | undefined {
  const from = redirectFrom(path);
  if (!from.ok) return undefined;
  const redirects = content.redirects ?? [];
  const problems = redirectProblems(redirects);
  return redirects.find((redirect, index) => {
    const own = redirectFrom(redirect.from);
    return problems[index] === undefined && own.ok && own.path === from.path;
  });
}

/**
 * The pages a build writes for the site's redirects, leaving out any whose old
 * address a page has (`taken`), since pages always win. `base` is the site's
 * base path, which builds add to addresses on the site.
 */
export function redirectFiles(
  content: Pick<SiteContent, "settings" | "redirects">,
  options: { taken?: Iterable<string>; base?: string } = {},
): BuildFile[] {
  const taken = new Set(options.taken ?? []);
  const redirects = content.redirects ?? [];
  const problems = redirectProblems(redirects);
  return redirects.flatMap((redirect, index) => {
    const from = redirectFrom(redirect.from);
    const to = redirectTarget(redirect.to);
    if (problems[index] !== undefined || !from.ok || !to || taken.has(from.path)) return [];
    return [{ path: `/${redirectOutputFile(from.path)}`, content: redirectPage(content, to, options.base) }];
  });
}
