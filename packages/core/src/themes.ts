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
import { compareReleases, inRange, NPM_REGISTRY, releaseVersion } from "./updates.js";

/** The keyword themes' packages carry, and the topic their repositories carry. */
export const THEME_KEYWORD = "goodfellow-theme";
/** The file at the root of a theme's package that says what it is. */
export const THEME_MANIFEST = "goodfellow-theme.json";
/** npm packages' files, at an exact release, from jsDelivr. */
export const JSDELIVR_NPM = "https://cdn.jsdelivr.net/npm";
/** The package whose release a theme's `peerDependencies` range names. */
export const THEME_PEER = "@goodfellow-cms/core";
/**
 * How many days old a release must be before it's offered: most harmful
 * releases of npm packages are found and removed within a few days.
 */
export const THEME_RELEASE_AGE_DAYS = 3;
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

export type ThemeErrorCode = "unavailable" | "not-found" | "not-a-theme" | "bad-file";

/** Thrown when a theme can't be found or read; the admin panel says what happened from `code`. */
export class ThemeError extends Error {
  override name = "ThemeError";
  constructor(
    readonly code: ThemeErrorCode,
    message: string,
    readonly file?: string,
  ) {
    super(message);
  }
}

/** The part of `fetch` reading themes uses, so core needs no DOM types. Pass the browser's or Node's `fetch`. */
export type ThemeFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface ThemeFetchOptions {
  fetch?: ThemeFetch;
}

const globalFetch = (url: string) => (globalThis as unknown as { fetch: ThemeFetch }).fetch(url);
const host = (url: string) => new URL(url).hostname;

async function getJson(url: string, fetcher: ThemeFetch): Promise<unknown> {
  let response: Awaited<ReturnType<ThemeFetch>>;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new ThemeError("unavailable", `Couldn't reach ${host(url)}: ${(error as Error).message}`);
  }
  if (response.status === 404) throw new ThemeError("not-found", `${url} wasn't found.`);
  if (!response.ok) throw new ThemeError("unavailable", `${host(url)} answered ${response.status}.`);
  return response.json();
}

/** A theme as a search lists it. */
export interface ThemeListing {
  name: string;
  description: string;
  /** Its newest release, whether or not it's offered yet. */
  version: string;
  /** Who published it on npm. */
  publisher?: string;
}

/** Themes on npm, newest-looking first, optionally matching words. Only packages named as themes are listed. */
export async function searchThemes(words = "", options: ThemeFetchOptions = {}): Promise<ThemeListing[]> {
  const text = `keywords:${THEME_KEYWORD}${words.trim() ? ` ${words.trim()}` : ""}`;
  const answer = (await getJson(
    `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&size=${MAX_THEMES}`,
    options.fetch ?? globalFetch,
  )) as { objects?: { package?: Record<string, unknown> }[] };
  const listings: ThemeListing[] = [];
  for (const { package: found } of answer.objects ?? []) {
    const name = typeof found?.name === "string" ? found.name : "";
    const version = typeof found?.version === "string" ? found.version : "";
    const keywords = Array.isArray(found?.keywords) ? found.keywords : [];
    if (!isThemeName(name) || !releaseVersion(version) || !keywords.includes(THEME_KEYWORD)) continue;
    const publisher = (found?.publisher as { username?: unknown } | undefined)?.username;
    listings.push({
      name,
      version,
      description: typeof found?.description === "string" ? found.description : "",
      ...(typeof publisher === "string" && { publisher }),
    });
  }
  return listings;
}

/** One release of a theme, as npm describes it. */
export interface ThemeRelease {
  version: string;
  /** When it was published, as an ISO 8601 date. */
  published: string;
  /** The Goodfellow releases it says it works with. */
  goodfellow?: string;
  /** Whether npm has a record of where it was built, which npm checked when it was published. */
  provenance: boolean;
  /** Its source repository, as its `package.json` says; npm checked it matches where it was built when it has provenance. */
  repository?: string;
  /** Why its publisher says not to use it, if they do. */
  deprecated?: string;
}

/** A theme's releases on npm, oldest first. Pre-releases are left out. */
export async function themeReleases(name: string, options: ThemeFetchOptions = {}): Promise<ThemeRelease[]> {
  if (!isThemeName(name)) throw new ThemeError("not-a-theme", `${name} isn't named as a theme.`);
  const metadata = (await getJson(`${NPM_REGISTRY}/${name.replace("/", "%2F")}`, options.fetch ?? globalFetch)) as {
    versions?: Record<string, Record<string, unknown>>;
    time?: Record<string, string>;
  };
  const releases: ThemeRelease[] = [];
  for (const [version, details] of Object.entries(metadata.versions ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const peers = (details.peerDependencies ?? {}) as Record<string, unknown>;
    const dist = (details.dist ?? {}) as { attestations?: { provenance?: unknown } };
    const repository = details.repository;
    const url =
      typeof repository === "string"
        ? repository
        : typeof (repository as { url?: unknown } | undefined)?.url === "string"
          ? (repository as { url: string }).url
          : undefined;
    releases.push({
      version,
      published: metadata.time?.[version] ?? "",
      ...(typeof peers[THEME_PEER] === "string" && { goodfellow: peers[THEME_PEER] }),
      provenance: dist.attestations?.provenance !== undefined,
      ...(url && { repository: repositoryAddress(url) }),
      ...(typeof details.deprecated === "string" && { deprecated: details.deprecated }),
    });
  }
  return releases.sort((a, b) => compareReleases(a.version, b.version));
}

/** A repository's web address from `package.json`'s spelling: `git+https://github.com/a/b.git` → `https://github.com/a/b`. */
function repositoryAddress(url: string): string {
  const shorthand = /^(github|gitlab):([\w.-]+\/[\w.-]+)$/.exec(url);
  if (shorthand) return `https://${shorthand[1]}.com/${shorthand[2]}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "");
}

/** Which release of a theme to offer, and why newer ones aren't. */
export interface ThemeChoice {
  /** The newest release that's old enough, says it works with this Goodfellow release, and isn't deprecated. */
  release?: ThemeRelease;
  /** A newer release that will be offered once it's `THEME_RELEASE_AGE_DAYS` old. */
  waiting?: ThemeRelease;
  /** A newer release that doesn't say it works with this Goodfellow release. */
  incompatible?: ThemeRelease;
}

/** Whether a release says it works with a Goodfellow release; one that doesn't say isn't offered. */
export function worksWith(release: Pick<ThemeRelease, "goodfellow">, goodfellow: string): boolean {
  return release.goodfellow !== undefined && inRange(goodfellow, release.goodfellow);
}

/** The release of a theme to offer on a Goodfellow release, from its releases oldest first. */
export function chooseThemeRelease(
  releases: readonly ThemeRelease[],
  goodfellow: string,
  now: Date = new Date(),
): ThemeChoice {
  const choice: ThemeChoice = {};
  const oldest = now.getTime() - THEME_RELEASE_AGE_DAYS * 86_400_000;
  for (const release of [...releases].reverse()) {
    if (release.deprecated) continue;
    if (!worksWith(release, goodfellow)) {
      choice.incompatible ??= release;
      continue;
    }
    const published = Date.parse(release.published);
    if (!(published <= oldest)) {
      choice.waiting ??= release;
      continue;
    }
    choice.release = release;
    break;
  }
  if (choice.waiting && choice.release && compareReleases(choice.waiting.version, choice.release.version) <= 0) {
    delete choice.waiting;
  }
  if (
    choice.incompatible &&
    choice.release &&
    compareReleases(choice.incompatible.version, choice.release.version) <= 0
  ) {
    delete choice.incompatible;
  }
  return choice;
}

/** A file of a theme's release, from jsDelivr. */
export function themeFileUrl(name: string, version: string, file: string): string {
  return `${JSDELIVR_NPM}/${name}@${version}/${file}`;
}

async function getText(url: string, file: string, fetcher: ThemeFetch): Promise<string> {
  let response: Awaited<ReturnType<ThemeFetch>>;
  try {
    response = await fetcher(url);
  } catch (error) {
    throw new ThemeError("unavailable", `Couldn't reach ${host(url)}: ${(error as Error).message}`);
  }
  if (response.status === 404) throw new ThemeError("bad-file", `The theme has no ${file}.`, file);
  if (!response.ok) throw new ThemeError("unavailable", `${host(url)} answered ${response.status}.`);
  return response.text();
}

/**
 * Reads a theme's release: its `goodfellow-theme.json`, and the CSS, header
 * and footer it names, each checked as the site would check it. Throws a
 * `ThemeError` when it can't be read or isn't a theme.
 */
export async function fetchTheme(release: ThemeRelease & { name: string }, options: ThemeFetchOptions = {}) {
  const fetcher = options.fetch ?? globalFetch;
  const { name, version } = release;
  const read = (file: string) => getText(themeFileUrl(name, version, file), file, fetcher);
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
 * or its header's and footer's blocks (such as `bg-[url(…)]`), and from its
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
