/**
 * Redirects (`content/redirects.json`): old addresses that send visitors on to
 * a page of the site or another website. Static hosts can't answer with a
 * redirect, so builds write a page at each old address that sends visitors on
 * at once, which search engines treat as a permanent redirect.
 */
import { z } from "zod";
import { withBase } from "../base-path.js";
import { absoluteUrl } from "../head.js";
import { DEFAULT_THEME_COLORS, darkThemeColor, escapeStyleText } from "../theme.js";
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
  /** What the page at an old address says while it sends visitors on, with `{page}` for the link. */
  message: z.string().optional(),
});

/** What the page at an old address says while it sends visitors on, unless the site says otherwise. */
export const REDIRECT_MESSAGE = "This page has moved to {page}.";

/** The placeholder in a redirect's message that becomes the link to where visitors are going. */
export const REDIRECT_LINK_PLACEHOLDER = "{page}";

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

/**
 * Addresses Goodfellow writes files at itself, besides the admin panel's: a
 * redirect page there would take the place of, or clash with, what's built.
 */
const RESERVED_PREFIXES = [
  "/media",
  "/media-sizes",
  "/calendars",
  "/feeds",
  "/api",
  "/fonts",
  "/pagefind",
  "/_next",
  "/_redirects",
  "/_headers",
  "/__goodfellow",
  "/404.html",
  "/goodfellow-site.json",
  "/goodfellow-build.json",
  "/sitemap.xml",
  "/robots.txt",
];

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
  // Other websites only over HTTPS, as the Redirects tab says, so visitors are never sent somewhere unencrypted.
  if (!/^https:\/\//i.test(text)) return undefined;
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
  // Where each old address sends visitors on the site, to find redirects that lead back to themselves.
  const next = new Map<string, string>();
  for (const redirect of redirects) {
    const from = redirectFrom(redirect.from);
    const to = redirectTarget(redirect.to);
    const path = to && targetPath(to);
    if (from.ok && path && !next.has(from.path)) next.set(from.path, path);
  }
  const loops = (start: string) => {
    let at = next.get(start);
    for (let steps = 0; at !== undefined && steps <= next.size; steps++) {
      if (at === start) return true;
      at = next.get(at);
    }
    return false;
  };
  return redirects.map((redirect) => {
    const from = redirectFrom(redirect.from);
    if (!from.ok) return from.problem;
    if (isReservedRedirect(from.path)) return "reserved";
    if (seen.has(from.path)) return "duplicate";
    seen.add(from.path);
    if (!redirect.to.trim()) return "no-to";
    const to = redirectTarget(redirect.to);
    if (!to) return "bad-to";
    if (targetPath(to) === from.path || loops(from.path)) return "loop";
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The title of the page a target on this site is, for the link's text. */
function targetTitle(content: Pick<SiteContent, "pages">, to: string): string | undefined {
  const path = targetPath(to);
  const page = path && content.pages.find((candidate) => candidate.path === path);
  const title = page && (page.content.data.root.props as Record<string, unknown> | undefined)?.title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}

/**
 * A page that sends visitors on at once and tells search engines where the
 * page is now. It replaces itself in the browser's history, so Back skips it,
 * and says where visitors are going, for the moment it shows, or for good
 * without JavaScript, when the `<meta>` refresh sends them on instead.
 */
export function redirectPage(
  content: Pick<SiteContent, "settings" | "redirectMessage"> & Partial<Pick<SiteContent, "pages">>,
  to: string,
  base?: string,
): string {
  const { settings } = content;
  const href = withBase(to, base);
  const canonical = to.startsWith("/") ? settings.url && absoluteUrl(settings.url, to) : to;
  const link = escapeHtml(href);
  const colors = { ...DEFAULT_THEME_COLORS, ...settings.theme.colors };
  const name = (content.pages && targetTitle({ pages: content.pages }, to)) ?? to;
  const anchor = `<a href="${link}" style="color:${escapeHtml(colors.primary)}">${escapeHtml(name)}</a>`;
  const message = escapeHtml(content.redirectMessage?.trim() || REDIRECT_MESSAGE);
  const text = message.includes(REDIRECT_LINK_PLACEHOLDER)
    ? message.split(REDIRECT_LINK_PLACEHOLDER).join(anchor)
    : `${message} ${anchor}`;
  // Keeps the part after # of the old address, as a server's redirect would, unless the target has its own.
  const target = JSON.stringify(href).replace(/</g, "\\u003c");
  const script = href.includes("#") ? `location.replace(${target});` : `location.replace(${target} + location.hash);`;
  const style = [
    "margin:0",
    "font:1.125rem/1.6 system-ui,sans-serif",
    `color:${colors.foreground}`,
    `background:${colors.background}`,
  ].join(";");
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(settings.language)}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(settings.title)}</title>`,
    '<meta name="robots" content="noindex">',
    ...(canonical ? [`<link rel="canonical" href="${escapeHtml(canonical)}">`] : []),
    `<meta http-equiv="refresh" content="0; url=${link}">`,
    ...(settings.theme.darkMode
      ? [
          '<meta name="color-scheme" content="light dark">',
          `<style>${escapeStyleText(
            `@media (prefers-color-scheme: dark){body{color:${darkThemeColor(settings.theme, "foreground")}!important;background:${darkThemeColor(settings.theme, "background")}!important}a{color:${darkThemeColor(settings.theme, "primary")}!important}}`,
          )}</style>`,
        ]
      : []),
    `<script>${script}</script>`,
    "</head>",
    `<body style="${escapeHtml(style)}">`,
    `<main style="max-width:36rem;margin:20vh auto 0;padding:0 1.5rem">`,
    `<p style="margin:0 0 .5rem;font-weight:600">${escapeHtml(settings.title)}</p>`,
    `<p style="margin:0">${text}</p>`,
    "</main>",
    "</body>",
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

/** A redirect's page, with the redirect it's for, so a build can list the ones it wrote for Cloudflare. */
export interface RedirectFile extends BuildFile, Redirect {}

/**
 * The pages a build writes for the site's redirects, leaving out any whose old
 * address a page has (`taken`), since pages always win. `base` is the site's
 * base path, which builds add to addresses on the site.
 */
export function redirectFiles(
  content: Pick<SiteContent, "settings" | "redirects" | "redirectMessage"> & Partial<Pick<SiteContent, "pages">>,
  options: { taken?: Iterable<string>; base?: string } = {},
): RedirectFile[] {
  // Pages, files and the first of two redirects win, whatever their capitals: `About/index.html` and
  // `about/index.html` are one file on some computers and hosts, as `Media/` is `media/`.
  const taken = new Set([...(options.taken ?? [])].map((path) => path.toLowerCase()));
  const redirects = content.redirects ?? [];
  const problems = redirectProblems(redirects);
  return redirects.flatMap((redirect, index) => {
    const from = redirectFrom(redirect.from);
    const to = redirectTarget(redirect.to);
    if (problems[index] !== undefined || !from.ok || !to) return [];
    const lower = from.path.toLowerCase();
    if (taken.has(lower) || isReservedRedirect(lower)) return [];
    taken.add(lower);
    return [
      {
        path: `/${redirectOutputFile(from.path)}`,
        content: redirectPage(content, to, options.base),
        from: from.path,
        to,
      },
    ];
  });
}

/** Where Cloudflare Pages reads redirects from, in the site's build output. Other hosts serve it as a file. */
export const CLOUDFLARE_REDIRECTS_PATH = "/_redirects";

/** How many fixed redirects Cloudflare Pages reads from `_redirects`; it leaves out the rest. */
export const CLOUDFLARE_REDIRECTS_LIMIT = 2000;

/**
 * Cloudflare Pages' `_redirects` file for the redirects a build wrote pages
 * for, so Cloudflare sends visitors on itself, as a permanent redirect, while
 * the pages stay for other hosts. Cloudflare follows a redirect even where the
 * site has a file, so only those the build wrote a page for are listed, since
 * an address with a page of its own never gets one. Each old address takes two
 * lines, without and with a trailing slash; past Cloudflare's limit, the rest
 * are left to their pages, and `left` says how many.
 */
export function cloudflareRedirects(
  redirects: readonly Redirect[],
  base?: string,
): { file: BuildFile | undefined; left: number } {
  const lines: string[] = [];
  let left = 0;
  for (const { from, to } of redirects) {
    const target = to.startsWith("/") ? withBase(to, base).replace(/ /g, "%20") : to;
    const old = encodeURI(withBase(from, base));
    const spellings = /\.html?$/i.test(from) ? [old] : [old, `${old}/`];
    if (lines.length + spellings.length > CLOUDFLARE_REDIRECTS_LIMIT) {
      left++;
      continue;
    }
    for (const spelling of spellings) lines.push(`${spelling} ${target} 301`);
  }
  return {
    file: lines.length > 0 ? { path: CLOUDFLARE_REDIRECTS_PATH, content: `${lines.join("\n")}\n` } : undefined,
    left,
  };
}
