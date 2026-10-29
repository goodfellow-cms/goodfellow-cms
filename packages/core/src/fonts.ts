/**
 * Preloading a site's Google Fonts. The stylesheet names each font file by an
 * address only Google knows, so pages are built with it read once, and each
 * page asks for its fonts as soon as it starts loading rather than once the
 * stylesheet has arrived.
 */
import type { Theme } from "./content/schemas.js";
import { googleFontsUrl } from "./theme.js";

/** Google answers each browser with the files it takes; this asks for woff2, which every current browser takes. */
const WOFF2_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const FONT_FILES = "https://fonts.gstatic.com/";

/**
 * The weights pages show most: text in 400 and headings in 700 (the Heading
 * block's bold). A variable font has one file for every weight.
 */
const TEXT_WEIGHT = 400;
const HEADING_WEIGHT = 700;

/**
 * The latin files, the subset nearly every page uses, that a Google Fonts
 * stylesheet gives each family at a weight.
 */
export function fontFilesFor(css: string, wanted: Array<{ family: string; weight: number }>): string[] {
  const files: string[] = [];
  for (const [, subset, body] of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    if (subset !== "latin" || !body) continue;
    const family = /font-family:\s*['"]([^'"]+)['"]/.exec(body)?.[1];
    const style = /font-style:\s*(\w+)/.exec(body)?.[1];
    const weights = /font-weight:\s*(\d+)(?:\s+(\d+))?/.exec(body);
    const url = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/.exec(body)?.[1];
    if (!family || style !== "normal" || !weights || !url?.startsWith(FONT_FILES)) continue;
    const low = Number(weights[1]);
    const high = Number(weights[2] ?? weights[1]);
    const used = wanted.some((font) => font.family === family && font.weight >= low && font.weight <= high);
    if (used && !files.includes(url)) files.push(url);
  }
  return files;
}

/**
 * Reads a stylesheet as text, asking as the given browser, or gives `undefined`
 * if it can't be read. `@goodfellow-cms/core/node`'s `readStylesheet` reads it
 * from the web.
 */
export type ReadStylesheet = (url: string, userAgent: string) => Promise<string | undefined>;

// What each reader has read, so a build reads the stylesheet once for all its pages.
const cache = new WeakMap<ReadStylesheet, Map<string, Promise<string[]>>>();

/**
 * The font files a site's pages should preload: its text font's and its
 * headings' latin files, read from Google Fonts' stylesheet. If it can't be
 * read, pages are built without preloading, as before.
 */
export function fontPreloads(theme: Theme, read: ReadStylesheet): Promise<string[]> {
  const url = googleFontsUrl(theme);
  if (!url) return Promise.resolve([]);
  const { heading, body } = theme.fonts;
  const wanted = [
    ...(body ? [{ family: body, weight: TEXT_WEIGHT }] : []),
    ...(heading ? [{ family: heading, weight: HEADING_WEIGHT }] : []),
  ];
  const key = `${url}#${JSON.stringify(wanted)}`;
  let known = cache.get(read);
  if (!known) {
    known = new Map();
    cache.set(read, known);
  }
  let files = known.get(key);
  if (!files) {
    files = read(url, WOFF2_BROWSER).then(
      (css) => (css ? fontFilesFor(css, wanted) : []),
      () => [],
    );
    known.set(key, files);
  }
  return files;
}

/**
 * Where builds put the site's own copy of its Google Fonts, under its base
 * path, so visitors' browsers load them from the site rather than from Google.
 */
export const FONTS_DIR = "fonts/google";

/** Reads a font file, or gives `undefined` if it can't be read. `@goodfellow-cms/core/node`'s `readFontFile` reads it from the web. */
export type ReadFontFile = (url: string) => Promise<Uint8Array | undefined>;

/** A site's Google Fonts as files of its own, which builds write and point pages at with `withSelfHostedFonts()`. */
export interface SelfHostedFonts {
  /** Google's stylesheet, which pages link to as they're rendered. */
  source: string;
  /** The site's copy of it, such as `fonts/google/1a2b3c4d.css`, without the base path. */
  stylesheet: string;
  /** Each Google font file's address, and where the site's copy goes. */
  fonts: Array<{ url: string; path: string }>;
  /** Every file to write: the stylesheet, then the fonts. */
  files: Array<{ path: string; content: string } | { path: string; bytes: Uint8Array }>;
}

const FONT_URL = /url\((https:\/\/fonts\.gstatic\.com\/[^)\s'"]+)\)/g;
/** Google's font files' paths, such as `s/inter/v13/UcC73Fwr.woff2`, which the site's copies keep. */
const FONT_PATH = /^s\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)+\.woff2$/;

/** A short hash of a stylesheet, so its name changes with it and browsers never keep an old one. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    h ^= text.charCodeAt(index);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A site's Google Fonts as files of its own: Google's stylesheet, read as a
 * current browser reads it, and every font file it names, with the
 * stylesheet pointing at the copies. `undefined` if the site has no Google
 * Fonts, or if the stylesheet or any of its files can't be read, so pages
 * keep loading them from Google rather than missing any.
 */
export async function selfHostedFonts(
  theme: Theme,
  read: ReadStylesheet,
  readFont: ReadFontFile,
): Promise<SelfHostedFonts | undefined> {
  const source = googleFontsUrl(theme);
  if (!source) return undefined;
  const css = await read(source, WOFF2_BROWSER).catch(() => undefined);
  if (!css) return undefined;
  const urls = [...new Set([...css.matchAll(FONT_URL)].map((match) => match[1] as string))];
  const fonts = urls.map((url) => ({ url, path: url.slice(FONT_FILES.length) }));
  if (fonts.length === 0 || fonts.some((font) => !FONT_PATH.test(font.path))) return undefined;
  const bytes = await Promise.all(fonts.map((font) => readFont(font.url).catch(() => undefined)));
  if (bytes.some((file) => !file || file.length === 0)) return undefined;
  // The stylesheet sits beside the fonts' folder, so its addresses are relative and work under any base path.
  const local = css.replace(FONT_URL, (_, url: string) => `url(${url.slice(FONT_FILES.length)})`);
  const stylesheet = `${FONTS_DIR}/${shortHash(local)}.css`;
  return {
    source,
    stylesheet,
    fonts: fonts.map((font) => ({ url: font.url, path: `${FONTS_DIR}/${font.path}` })),
    files: [
      { path: stylesheet, content: local },
      ...fonts.map((font, index) => ({ path: `${FONTS_DIR}/${font.path}`, bytes: bytes[index] as Uint8Array })),
    ],
  };
}

/**
 * A built page, or Next.js's payload for one, pointing at the site's copy of
 * its fonts rather than Google's: the stylesheet and the files it preloads,
 * however the page spells their addresses. `base` is the site's base path,
 * such as `/` or `/my-site/`.
 */
export function withSelfHostedFonts(text: string, fonts: SelfHostedFonts, base = "/"): string {
  const prefix = base.replace(/\/?$/, "/");
  const spellings = (url: string) => [url, url.replaceAll("&", "&amp;"), url.replaceAll("&", "\\u0026")];
  let out = text;
  for (const spelling of spellings(fonts.source)) out = out.split(spelling).join(`${prefix}${fonts.stylesheet}`);
  for (const font of fonts.fonts) out = out.split(font.url).join(`${prefix}${font.path}`);
  return out;
}

/** What a build did with a site's Google Fonts: copied them into the site, or left them to Google, which it couldn't reach. `undefined` for a site without any. */
export type SelfHostedResult = { hosted: number } | { unavailable: true } | undefined;

/**
 * What a build says about where its fonts and `robots.txt` are: that Google
 * couldn't be reached, so visitors' browsers still load the fonts from Google,
 * and, for a site in a subfolder, that search engines read `robots.txt` only
 * at the domain's root (`rootRobotsUrl()`), so the sitemap needs naming there
 * or in their own tools.
 */
export function buildNotes(result: {
  fonts?: SelfHostedResult;
  robotsElsewhere?: string;
  sitemap?: string;
  images?: { written: number; failed: string[] };
}): string[] {
  const lines: string[] = [];
  if (result.images && result.images.written > 0) {
    lines.push(
      `Wrote ${result.images.written} smaller cop${result.images.written === 1 ? "y" : "ies"} of the media library's photos, which pages offer browsers in place of the whole photo`,
    );
  }
  if (result.images && result.images.failed.length > 0) {
    lines.push(
      `Couldn't make smaller copies of ${result.images.failed.join(", ")}, so browsers download ${result.images.failed.length === 1 ? "it" : "them"} whole`,
    );
  }
  if (result.fonts && "hosted" in result.fonts) {
    lines.push(
      `Copied ${result.fonts.hosted} font file${result.fonts.hosted === 1 ? "" : "s"} into the site, so visitors' browsers don't ask Google Fonts for them`,
    );
  } else if (result.fonts) {
    lines.push(
      "Google Fonts couldn't be reached, so the site's pages load their fonts from Google until it's built again",
    );
  }
  if (result.robotsElsewhere) {
    lines.push(
      `Search engines read robots.txt only at ${result.robotsElsewhere}, not the one this build wrote in the site's folder. Unless that one names ${result.sitemap ?? "the sitemap"}, name it there or in Google Search Console and Bing Webmaster Tools, or give the site a domain of its own.`,
    );
  }
  return lines;
}
