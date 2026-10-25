/**
 * Finding and reading themes on npm: packages named `goodfellow-theme-<name>`
 * (or `@scope/goodfellow-theme-<name>`) with the `goodfellow-theme` keyword,
 * read from npm's registry and their files from jsDelivr, both of which answer
 * browsers. Nothing here runs a theme's code: a theme has none.
 */
import { ContentError } from "./content/errors.js";
import { FOOTER_FILE, HEADER_FILE } from "./content/paths.js";
import {
  parseThemeLayout,
  THEME_CSS_END,
  type ThemePackage,
  themeCssLoads,
  themeManifestSchema,
} from "./content/themes.js";
import {
  chooseRelease,
  GOODFELLOW_PEER,
  getPackageText,
  PackageError,
  type PackageErrorCode,
  type PackageFetch,
  type PackageFetchOptions,
  type PackageListing,
  type PackageRelease,
  packageFetch,
  packageFileUrl,
  packageReleases,
  RELEASE_AGE_DAYS,
  type ReleaseChoice,
  searchPackages,
} from "./npm-packages.js";

export { JSDELIVR_NPM, worksWith } from "./npm-packages.js";

/** The keyword themes' packages carry, and the topic their repositories carry. */
export const THEME_KEYWORD = "goodfellow-theme";
/** The file at the root of a theme's package that says what it is. */
export const THEME_MANIFEST = "goodfellow-theme.json";
/** The package whose release a theme's `peerDependencies` range names. */
export const THEME_PEER = GOODFELLOW_PEER;
/** How many days old a release must be before it's offered (`RELEASE_AGE_DAYS`). */
export const THEME_RELEASE_AGE_DAYS = RELEASE_AGE_DAYS;
/** At most this many themes are listed for a search. */
export const MAX_THEMES = 50;

const THEME_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?goodfellow-theme-[a-z0-9][a-z0-9._~-]*$/;

/** Whether a package's name is a theme's, such as `goodfellow-theme-forest` or `@acme/goodfellow-theme-forest`. */
export function isThemeName(name: string): boolean {
  return THEME_NAME.test(name) && name.length <= 214;
}

/** What a theme is called in lists until its own title is read: `goodfellow-theme-quiet-forest` → "Quiet forest". */
export function themeLabel(name: string): string {
  const words = name.replace(/^.*goodfellow-theme-/, "").replace(/[-_.~]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ThemeErrorCode = PackageErrorCode;
/** Thrown when a theme can't be found or read; the admin panel says what happened from `code`. */
export const ThemeError = PackageError;
export type ThemeError = PackageError;
export type ThemeFetch = PackageFetch;
export type ThemeFetchOptions = PackageFetchOptions;
/** A theme as a search lists it. */
export type ThemeListing = PackageListing;
/** One release of a theme, as npm describes it. */
export type ThemeRelease = PackageRelease;
/** Which release of a theme to offer, and why newer ones aren't. */
export type ThemeChoice = ReleaseChoice;

/** Themes on npm, newest-looking first, optionally matching words. Only packages named as themes are listed. */
export function searchThemes(words = "", options: ThemeFetchOptions = {}): Promise<ThemeListing[]> {
  return searchPackages(THEME_KEYWORD, isThemeName, words, { ...options, size: MAX_THEMES });
}

/** A theme's releases on npm, oldest first. Pre-releases are left out. */
export async function themeReleases(name: string, options: ThemeFetchOptions = {}): Promise<ThemeRelease[]> {
  if (!isThemeName(name)) throw new ThemeError("not-a-theme", `${name} isn't named as a theme.`);
  return packageReleases(name, options);
}

/** The release of a theme to offer on a Goodfellow release, from its releases oldest first. */
export const chooseThemeRelease = chooseRelease;

/** A file of a theme's release, from jsDelivr. */
export const themeFileUrl = packageFileUrl;

/**
 * Reads a theme's release: its `goodfellow-theme.json`, and the CSS, header
 * and footer it names, each checked as the site would check it. Throws a
 * `ThemeError` when it can't be read or isn't a theme.
 */
export async function fetchTheme(release: ThemeRelease & { name: string }, options: ThemeFetchOptions = {}) {
  const fetcher = packageFetch(options);
  const { name, version } = release;
  const read = (file: string) => getPackageText(themeFileUrl(name, version, file), file, fetcher);
  let raw: unknown;
  try {
    raw = JSON.parse(await read(THEME_MANIFEST));
  } catch (error) {
    if (error instanceof ThemeError) throw error.code === "bad-file" ? notATheme(name) : error;
    throw new ThemeError("bad-file", `${THEME_MANIFEST} isn't valid JSON.`, THEME_MANIFEST);
  }
  const parsed = themeManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ThemeError(
      "bad-file",
      `${THEME_MANIFEST}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
      THEME_MANIFEST,
    );
  }
  const manifest = parsed.data;
  const layout = async (file: string | undefined, site: string) => {
    if (!file) return undefined;
    try {
      return parseThemeLayout(site, await read(file));
    } catch (error) {
      if (error instanceof ContentError) {
        throw new ThemeError("bad-file", `${file}: ${error.problems[0]?.message ?? error.message}`, file);
      }
      throw error;
    }
  };
  const [css, header, footer] = await Promise.all([
    manifest.css ? read(manifest.css) : undefined,
    layout(manifest.header, HEADER_FILE),
    layout(manifest.footer, FOOTER_FILE),
  ]);
  if (css?.includes(THEME_CSS_END)) {
    throw new ThemeError("bad-file", `${manifest.css} can't contain the line that ends a theme's CSS.`, manifest.css);
  }
  const theme: ThemePackage = {
    name,
    release: version,
    manifest,
    ...(css !== undefined && { css }),
    ...(header && { header }),
    ...(footer && { footer }),
    ...(release.goodfellow && { goodfellow: release.goodfellow }),
  };
  checkLayoutAddresses(theme);
  return theme;
}

function notATheme(name: string): ThemeError {
  return new ThemeError("not-a-theme", `${name} has no ${THEME_MANIFEST}.`, THEME_MANIFEST);
}

/**
 * Built-in blocks a theme's header and footer may use: ones that show text or
 * the site's own settings, menus and pages, and load nothing from elsewhere.
 * A site's other blocks, such as Custom HTML, could run a theme's code.
 */
export const THEME_LAYOUT_BLOCKS: readonly string[] = [
  "Section",
  "Grid",
  "Flex",
  "Space",
  "Heading",
  "Text",
  "Button",
  "ContactDetails",
  "Menu",
  "SiteBrand",
  "Search",
  "DarkModeSwitch",
  "LanguageSwitch",
];

/** Every block in a theme's header and footer, and every text in their props. */
function visitLayouts(theme: ThemePackage, onBlock: (type: string) => void, onText: (text: string) => void) {
  const visit = (value: unknown) => {
    if (typeof value === "string") onText(value);
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && typeof record.props === "object") onBlock(record.type);
    for (const child of Object.values(record)) visit(child);
  };
  visit(theme.header?.data);
  visit(theme.footer?.data);
}

/**
 * The blocks a theme's header and footer use that it may not use there: ones
 * outside `THEME_LAYOUT_BLOCKS`, or that the site doesn't have. Any keeps the
 * header and footer from being used.
 */
export function themeUnknownBlocks(theme: ThemePackage, blocks: Iterable<string>): string[] {
  const known = new Set(blocks);
  const refused = new Set<string>();
  visitLayouts(
    theme,
    (type) => {
      if (!THEME_LAYOUT_BLOCKS.includes(type) || !known.has(type)) refused.add(type);
    },
    () => undefined,
  );
  return [...refused].sort();
}

/** Addresses that run code or hide it, which no theme's header or footer may hold. */
function unsafeAddress(text: string): boolean {
  return /^\s*(?:javascript|vbscript|data):/i.test(text);
}

/** Throws when a theme's header or footer holds an address that would run code, such as a `javascript:` link. */
function checkLayoutAddresses(theme: ThemePackage): void {
  visitLayouts(
    theme,
    () => undefined,
    (text) => {
      if (unsafeAddress(text)) {
        throw new ThemeError("bad-file", "The theme's header or footer has an address that would run code.");
      }
    },
  );
}

/**
 * What installing a theme would have visitors' browsers load besides Google
 * Fonts and the site's own media: from its CSS, from classes it gives parts
 * or its header's and footer's blocks (such as arbitrary `url()` backgrounds), and from its
 * header's and footer's pictures.
 */
export function themeLoads(theme: ThemePackage): string[] {
  const texts = [theme.css ?? "", ...Object.values(theme.manifest.theme.parts ?? {})];
  const pictures: string[] = [];
  visitLayouts(
    theme,
    () => undefined,
    (text) => {
      texts.push(text);
      for (const match of text.matchAll(/\b(?:src|poster)\s*=\s*["']([^"']+)["']/gi)) pictures.push(match[1] ?? "");
      if (/^(?:https?:)?\/\//i.test(text.trim()) && /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i.test(text)) {
        pictures.push(text.trim());
      }
    },
  );
  const found = new Set([
    ...themeCssLoads(texts.join("\n")),
    ...themeCssLoads(pictures.map((url) => `url(${url})`).join(" ")),
  ]);
  return [...found].sort();
}
