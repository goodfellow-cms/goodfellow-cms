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
