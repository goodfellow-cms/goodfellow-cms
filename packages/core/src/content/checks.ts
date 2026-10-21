/**
 * Site checks: mistakes in a site's content that the admin panel stops or
 * warns about when publishing, and that `goodfellow build` reports. They're
 * worked out from content files alone, so they run in the browser and in
 * Node alike, without rendering pages.
 *
 * - Errors: links to pages, items or media that don't exist.
 * - Warnings: pages without a title or description, and theme colors that
 *   text is hard to read on.
 */
import type { ComponentConfig } from "@puckeditor/core";
import { contrastRatio, MINIMUM_CONTRAST } from "../contrast.js";
import { DEFAULT_THEME_COLORS, darkThemeColor } from "../theme.js";
import { linkTarget, siteLinks } from "./links.js";
import type { Page, SiteContent } from "./load.js";
import { allPages } from "./load.js";
import { SITE_FILE } from "./paths.js";
import type { ThemeColor } from "./schemas.js";
import { sitePages } from "./site-pages.js";

export type SiteProblem =
  /** A link to a page or item the site doesn't have. */
  | { kind: "missing-page"; severity: "error"; file: string; target: string }
  /** A link to, or an image or video from, a media file the site doesn't have. */
  | { kind: "missing-media"; severity: "error"; file: string; target: string }
  /** A page without a title of its own, so visitors' tabs and search results show only the site's. */
  | { kind: "no-title"; severity: "warning"; file: string; path: string }
  /** A page without a description, when the site has none either, for search results to show. */
  | { kind: "no-description"; severity: "warning"; file: string; path: string }
  /** Theme colors that text is hard to read on. */
  | {
      kind: "low-contrast";
      severity: "warning";
      file: string;
      text: ThemeColor;
      background: ThemeColor;
      /** WCAG's contrast ratio, rounded to one decimal place. */
      ratio: number;
      dark: boolean;
    };

export interface SiteCheckOptions {
  /** The site's media files' addresses, such as `/media/photo.jpg`. */
  media: readonly string[];
  /** The site's blocks, whose fields say which props hold links and which pages blocks add. */
  blocks?: Record<string, ComponentConfig>;
  /** Today, as `YYYY-MM-DD`, for pages blocks add, such as a calendar's months. */
  today?: string;
}

/** Text and the backgrounds it's shown on, as the theme's names pair them. */
const COLOR_PAIRS: ReadonlyArray<readonly [ThemeColor, ThemeColor]> = [
  ["foreground", "background"],
  ["mutedForeground", "background"],
  ["primaryForeground", "primary"],
  ["secondaryForeground", "secondary"],
  ["mutedForeground", "muted"],
  ["accentForeground", "accent"],
];

function readString(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function pageWarnings(content: SiteContent, page: Page): SiteProblem[] {
  if (page.path === "/404") return [];
  const props = page.content.data.root.props as Record<string, unknown> | undefined;
  const problems: SiteProblem[] = [];
  // The home page is titled with the site's name.
  if (page.path !== "/" && !readString(props, "title")) {
    problems.push({ kind: "no-title", severity: "warning", file: page.file, path: page.path });
  }
  if (!readString(props, "description") && !content.settings.description?.trim()) {
    problems.push({ kind: "no-description", severity: "warning", file: page.file, path: page.path });
  }
  return problems;
}

/** Theme colors that text is hard to read on, light and, where the site has dark mode, dark. */
export function contrastProblems(theme: SiteContent["settings"]["theme"]): SiteProblem[] {
  const problems: SiteProblem[] = [];
  const schemes = [
    { dark: false, color: (name: ThemeColor) => theme.colors[name] ?? DEFAULT_THEME_COLORS[name] },
    ...(theme.darkMode ? [{ dark: true, color: (name: ThemeColor) => darkThemeColor(theme, name) }] : []),
  ];
  for (const { dark, color } of schemes) {
    for (const [text, background] of COLOR_PAIRS) {
      const ratio = contrastRatio(color(text), color(background));
      if (ratio !== undefined && ratio < MINIMUM_CONTRAST) {
        problems.push({
          kind: "low-contrast",
          severity: "warning",
          file: SITE_FILE,
          text,
          background,
          ratio: Math.floor(ratio * 10) / 10,
          dark,
        });
      }
    }
  }
  return problems;
}

/** Every problem the site has, errors first, in the order its files are listed. */
export function checkSite(content: SiteContent, options: SiteCheckOptions): SiteProblem[] {
  const pages = options.blocks && options.today ? sitePages(content, options.today, options.blocks) : allPages(content);
  const addresses = new Set(pages.map((page) => page.path));
  for (const redirect of content.redirects ?? []) addresses.add(redirect.from);
  const media = new Set(options.media);

  const errors: SiteProblem[] = [];
  for (const [file, links] of siteLinks(content, options.blocks)) {
    const seen = new Set<string>();
    for (const link of links) {
      const target = linkTarget(link);
      if (!target || seen.has(target.path)) continue;
      seen.add(target.path);
      if (target.kind === "media" && !media.has(target.path)) {
        errors.push({ kind: "missing-media", severity: "error", file, target: target.path });
      } else if (target.kind === "page" && !addresses.has(target.path)) {
        errors.push({ kind: "missing-page", severity: "error", file, target: target.path });
      }
    }
  }
  const warnings = [
    ...content.pages.flatMap((page) => pageWarnings(content, page)),
    ...contrastProblems(content.settings.theme),
  ];
  return [...errors, ...warnings];
}

/** What makes a problem the same one before and after a change. */
export function problemKey(problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
    case "missing-media":
      return `${problem.kind} ${problem.file} ${problem.target}`;
    case "no-title":
    case "no-description":
      return `${problem.kind} ${problem.file}`;
    case "low-contrast":
      return `${problem.kind} ${problem.text} ${problem.background} ${problem.dark}`;
  }
}

/**
 * What a publish needs to say: the errors it would bring, which stop it
 * (such as a link to a page it deletes, wherever the link is), and what the
 * files it changes have wrong besides, which the editor can publish anyway.
 * Problems in other files that were there before aren't mentioned.
 */
export function publishProblems(
  before: readonly SiteProblem[],
  after: readonly SiteProblem[],
  changedFiles: Iterable<string>,
): { blocking: SiteProblem[]; warnings: SiteProblem[] } {
  const existing = new Set(before.map(problemKey));
  const changed = new Set(changedFiles);
  const blocking = after.filter((problem) => problem.severity === "error" && !existing.has(problemKey(problem)));
  const blocked = new Set(blocking);
  const warnings = after.filter((problem) => !blocked.has(problem) && changed.has(problem.file));
  return { blocking, warnings };
}

/** A problem as developers' tools say it, such as `goodfellow build`, naming the file it's in. */
export function formatSiteProblem(problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
      return `${problem.file} links to ${problem.target}, which isn't a page or item on the site.`;
    case "missing-media":
      return `${problem.file} uses ${problem.target}, which isn't in public/media/.`;
    case "no-title":
      return `${problem.file} (${problem.path}) has no title.`;
    case "no-description":
      return `${problem.file} (${problem.path}) has no description, and the site has none either.`;
    case "low-contrast":
      return `${problem.file}: ${problem.dark ? "dark mode's " : ""}${problem.text} on ${problem.background} has a contrast of ${problem.ratio.toFixed(1)} to 1, below ${MINIMUM_CONTRAST} to 1.`;
  }
}
