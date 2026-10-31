/**
 * Site checks: mistakes in a site's content that the admin panel stops or
 * warns about when publishing, and that `goodfellow build` reports. They're
 * worked out from content files alone, so they run in the browser and in
 * Node alike, without rendering pages.
 *
 * - Errors: links to pages, items or media that don't exist, and items'
 *   links to items that don't exist, and synced blocks that aren't there or
 *   that place others.
 * - Warnings: pages without a title or description, theme colors that text
 *   is hard to read on, and translations of something that isn't in the main
 *   language.
 */
import type { ComponentConfig } from "@puckeditor/core";
import { contrastRatio, MINIMUM_CONTRAST } from "../contrast.js";
import { isScriptUrl } from "../external-links.js";
import { DEFAULT_THEME_COLORS, darkThemeColor } from "../theme.js";
import { missingItemLinks } from "./item-links.js";
import {
  entryLanguage,
  entrySourceHash,
  entryTranslations,
  mainLanguage,
  pageLanguage,
  pageSourceHash,
  pageTranslations,
  siteLanguages,
  translationState,
} from "./languages.js";
import { siteLinks } from "./links.js";
import type { Page, SiteContent } from "./load.js";
import { allPages } from "./load.js";
import { storedAddresses } from "./media-storage.js";
import { linkTarget } from "./page-address.js";
import { SITE_FILE } from "./paths.js";
import { redirectFrom, redirectProblems } from "./redirects.js";
import type { ThemeColor } from "./schemas.js";
import { sitePages } from "./site-pages.js";
import { syncedBlockProblems } from "./synced-blocks.js";

export type SiteProblem =
  /** A link to a page or item the site doesn't have. */
  | { kind: "missing-page"; severity: "error"; file: string; target: string }
  /** An item's link to an item (`target`, its name) that isn't in `collection`. */
  | { kind: "missing-item"; severity: "error"; file: string; target: string; collection: string }
  /** A Synced block block (in `file`) placing a synced block (`target`, its name) the site doesn't have. */
  | { kind: "missing-synced-block"; severity: "error"; file: string; target: string }
  /** A synced block (`file`) that places another (`target`), which isn't shown, so nothing loops. */
  | { kind: "nested-synced-block"; severity: "error"; file: string; target: string }
  /** A link to, or an image or video from, a media file the site doesn't have. */
  | { kind: "missing-media"; severity: "error"; file: string; target: string }
  /** A link that would run code (`javascript:` and the like), which pages leave out. */
  | { kind: "unsafe-link"; severity: "error"; file: string; target: string }
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
    }
  /** An image without alt text, so people who can't see it don't know what it shows (`target` is its address). */
  | { kind: "no-alt"; severity: "warning"; file: string; path: string; target: string }
  /** A heading a level or more below the one before it, such as a level 4 after a level 2, or that a page starts with. */
  | {
      kind: "skipped-heading";
      severity: "warning";
      file: string;
      path: string;
      text: string;
      level: number;
      previous?: number;
    }
  /** A link whose text, such as "Click here", doesn't say where it goes. */
  | { kind: "vague-link"; severity: "warning"; file: string; path: string; target: string; text: string }
  /** A link with no text at all, such as an icon without a label. */
  | { kind: "empty-link"; severity: "warning"; file: string; path: string; target: string }
  /**
   * A translation of something that isn't in the main language, or a page or
   * item in the main language that says it translates something: `target` is
   * the address or item's name it names.
   */
  | { kind: "bad-translation"; severity: "warning"; file: string; target: string }
  /**
   * A page or item in the main language (`file`, at `path`, or the item's name)
   * that has no translation in one of the site's other languages.
   */
  | { kind: "missing-translation"; severity: "warning"; file: string; path: string; language: string }
  /** A page's or item's translation (`translation`) that it has changed since, in `language`. */
  | {
      kind: "outdated-translation";
      severity: "warning";
      file: string;
      path: string;
      language: string;
      translation: string;
    }
  /**
   * What an automated accessibility checker found on a built page, by its rule
   * (axe-core's), with what it means in plain words and how many places on the page have it.
   */
  | {
      kind: "accessibility";
      severity: "warning";
      file: string;
      path: string;
      rule: string;
      help: string;
      count: number;
    };

export interface SiteCheckOptions {
  /** The site's media files' addresses, such as `/media/photo.jpg`. */
  media: readonly string[];
  /** The site's blocks, whose fields say which props hold links and which pages blocks add. */
  blocks?: Record<string, ComponentConfig>;
  /** Today, as `YYYY-MM-DD`, for pages blocks add, such as a calendar's months. */
  today?: string;
  /**
   * Every page the site has, as `sitePages()` gives them, where they were
   * worked out elsewhere, such as by the frame the admin panel runs the site's code in.
   */
  pages?: readonly Page[];
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

/**
 * Translations that don't link up: of a page or item that isn't in the main
 * language, or from the main language itself. A translation of a page that
 * doesn't exist is a link to it that's missing, so it's an error already.
 */
function translationProblems(content: SiteContent): SiteProblem[] {
  const { settings } = content;
  const main = mainLanguage(settings);
  const problems: SiteProblem[] = [];
  const bad = (file: string, target: string) =>
    problems.push({ kind: "bad-translation", severity: "warning", file, target });
  for (const page of content.pages) {
    const target = page.content.translationOf;
    if (target === undefined) continue;
    const source = content.pages.find((candidate) => candidate.path === target);
    if (pageLanguage(content, page) === main) bad(page.file, target);
    else if (source && pageLanguage(content, source) !== main) bad(page.file, target);
  }
  for (const collection of content.collections) {
    for (const entry of collection.entries) {
      const target = entry.content.translationOf;
      if (target === undefined) continue;
      const source = collection.entries.find((candidate) => candidate.slug === target);
      if (!source || entryLanguage(settings, entry) === main) bad(entry.file, target);
      else if (entryLanguage(settings, source) !== main) bad(entry.file, target);
    }
  }
  // What the main language's pages and items lack, or have that's out of date, in each other language.
  const others = siteLanguages(settings).filter((language) => !language.main);
  /** Each other language's translation of a page or item: missing, or out of date with `source`, its hash now. */
  const untranslated = (
    file: string,
    path: string,
    source: string,
    translations: Map<string, { translatedFrom?: string; at: string }>,
  ) => {
    for (const language of others) {
      const translation = translations.get(language.code);
      if (!translation) {
        problems.push({ kind: "missing-translation", severity: "warning", file, path, language: language.code });
      } else if (translationState(source, translation) === "outdated") {
        problems.push({
          kind: "outdated-translation",
          severity: "warning",
          file,
          path,
          language: language.code,
          translation: translation.at,
        });
      }
    }
  };
  if (others.length > 0) {
    for (const page of content.pages) {
      if (page.path === "/404" || pageLanguage(content, page) !== main) continue;
      const translations = new Map(
        [...pageTranslations(content, page)].map(([code, translation]) => [
          code,
          { translatedFrom: translation.content.translatedFrom, at: translation.path },
        ]),
      );
      untranslated(page.file, page.path, pageSourceHash(page), translations);
    }
    for (const collection of content.collections) {
      for (const entry of collection.entries) {
        if (entryLanguage(settings, entry) !== main) continue;
        const translations = new Map(
          [...entryTranslations(settings, collection, entry)].map(([code, translation]) => [
            code,
            { translatedFrom: translation.content.translatedFrom, at: translation.path ?? translation.slug },
          ]),
        );
        untranslated(entry.file, entry.path ?? entry.slug, entrySourceHash(entry), translations);
      }
    }
  }
  return problems;
}

/** Every problem the site has, errors first, in the order its files are listed. */
export function checkSite(content: SiteContent, options: SiteCheckOptions): SiteProblem[] {
  const pages =
    options.pages ??
    (options.blocks && options.today ? sitePages(content, options.today, options.blocks) : allPages(content));
  const addresses = new Set(pages.map((page) => page.path));
  // Old addresses spelled as visitors' links reach them, and only those of redirects builds write.
  const redirects = content.redirects ?? [];
  redirectProblems(redirects).forEach((problem, index) => {
    const from = redirects[index] && redirectFrom(redirects[index].from);
    if (problem === undefined && from?.ok) addresses.add(from.path);
  });
  // Media a plugin keeps outside the repository is the site's too.
  const media = new Set([...options.media, ...storedAddresses(content.mediaStorage)]);

  const errors: SiteProblem[] = [];
  for (const [file, links] of siteLinks(content, options.blocks)) {
    const seen = new Set<string>();
    for (const link of links) {
      if (isScriptUrl(link)) {
        if (!seen.has(link)) errors.push({ kind: "unsafe-link", severity: "error", file, target: link });
        seen.add(link);
        continue;
      }
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
  const seenItems = new Set<string>();
  for (const missing of missingItemLinks(content)) {
    const key = `${missing.entry.file} ${missing.target} ${missing.slug}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    errors.push({
      kind: "missing-item",
      severity: "error",
      file: missing.entry.file,
      target: missing.slug,
      collection: missing.target,
    });
  }
  for (const problem of syncedBlockProblems(content)) errors.push({ ...problem, severity: "error" });
  const warnings = [
    ...content.pages.flatMap((page) => pageWarnings(content, page)),
    ...translationProblems(content),
    ...contrastProblems(content.settings.theme),
  ];
  return [...errors, ...warnings];
}

/** What makes a problem the same one before and after a change. */
export function problemKey(problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
    case "missing-media":
    case "unsafe-link":
      return `${problem.kind} ${problem.file} ${problem.target}`;
    case "missing-item":
      return `${problem.kind} ${problem.file} ${problem.collection} ${problem.target}`;
    case "missing-synced-block":
    case "nested-synced-block":
      return `${problem.kind} ${problem.file} ${problem.target}`;
    case "no-title":
    case "no-description":
      return `${problem.kind} ${problem.file}`;
    case "low-contrast":
      return `${problem.kind} ${problem.text} ${problem.background} ${problem.dark}`;
    // Not by page: the header's and footer's are on every page, and are one problem.
    case "no-alt":
    case "vague-link":
    case "empty-link":
    case "bad-translation":
      return `${problem.kind} ${problem.file} ${problem.target}`;
    case "missing-translation":
    case "outdated-translation":
      return `${problem.kind} ${problem.file} ${problem.language}`;
    case "skipped-heading":
      return `${problem.kind} ${problem.file} ${problem.level} ${problem.text}`;
    case "accessibility":
      return `${problem.kind} ${problem.file} ${problem.rule}`;
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
  // Translations missing or out of date are said once, when a publish brings them: a site may well leave pages
  // untranslated for good.
  const warnings = after.filter(
    (problem) =>
      !blocked.has(problem) &&
      changed.has(problem.file) &&
      (!ONCE_ONLY.has(problem.kind) || !existing.has(problemKey(problem))),
  );
  return { blocking, warnings };
}

/** Warnings a publish shows only when it brings them. */
const ONCE_ONLY = new Set<SiteProblem["kind"]>(["missing-translation", "outdated-translation"]);

/** A problem as developers' tools say it, such as `goodfellow build`, naming the file it's in. */
export function formatSiteProblem(problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
      return `${problem.file} links to ${problem.target}, which isn't a page or item on the site.`;
    case "missing-item":
      return `${problem.file} links to ${problem.target} in ${problem.collection}, which isn't an item there.`;
    case "missing-synced-block":
      return problem.target
        ? `${problem.file} places the synced block ${problem.target}, which the site doesn't have.`
        : `${problem.file} has a Synced block block that doesn't say which synced block it places.`;
    case "nested-synced-block":
      return `${problem.file} places the synced block ${problem.target}, but synced blocks can't place others, so it isn't shown.`;
    case "missing-media":
      return `${problem.file} uses ${problem.target}, which isn't in public/media/.`;
    case "unsafe-link":
      return `${problem.file} links to ${problem.target}, an address that would run code, which pages leave out.`;
    case "no-title":
      return `${problem.file} (${problem.path}) has no title.`;
    case "no-description":
      return `${problem.file} (${problem.path}) has no description, and the site has none either.`;
    case "low-contrast":
      return `${problem.file}: ${problem.dark ? "dark mode's " : ""}${problem.text} on ${problem.background} has a contrast of ${problem.ratio.toFixed(1)} to 1, below ${MINIMUM_CONTRAST} to 1.`;
    case "no-alt":
      return `${problem.file} (${problem.path}) shows ${problem.target || "an image"} without alt text.`;
    case "skipped-heading":
      return problem.previous === undefined
        ? `${problem.file} (${problem.path}) starts with a level ${problem.level} heading, "${problem.text}".`
        : `${problem.file} (${problem.path}) has a level ${problem.level} heading, "${problem.text}", after a level ${problem.previous} one.`;
    case "vague-link":
      return `${problem.file} (${problem.path}) links to ${problem.target} with the text "${problem.text}", which doesn't say where it goes.`;
    case "empty-link":
      return `${problem.file} (${problem.path}) has a link to ${problem.target} with no text.`;
    case "bad-translation":
      return `${problem.file} says it translates ${problem.target}, but translations translate a page or item in the site's main language.`;
    case "missing-translation":
      return `${problem.file} (${problem.path}) has no translation in ${problem.language}.`;
    case "outdated-translation":
      return `${problem.file} (${problem.path}) has changed since ${problem.translation}, its translation in ${problem.language}, was made.`;
    case "accessibility":
      return `${problem.path}: ${problem.help} (${problem.rule}${problem.count > 1 ? `, ${problem.count} places` : ""}).`;
  }
}
