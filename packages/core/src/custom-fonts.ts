/**
 * A site's own fonts: WOFF2 files an owner uploads on the Theme tab, kept in
 * the media library's fonts folder (`FONTS_MEDIA_DIR`, never a media storage
 * plugin's, since browsers load fonts from another address only where it sends
 * headers a static host can't), and named in `content/site.json`'s
 * `theme.fonts.custom`. `heading` and `body` can name one of their families
 * like any Google font. No React or DOM.
 */

import { MEDIA_DIR } from "./content/paths.js";
import type { CustomFont, CustomFontFile, FontCategory, Theme } from "./content/schemas.js";
import type { FileChange } from "./content/store.js";

/** Where a site's own fonts are kept. */
export const FONTS_MEDIA_DIR = `${MEDIA_DIR}/fonts`;

/** A font file's address: in the fonts folder, named in lowercase letters, numbers and hyphens. */
export const CUSTOM_FONT_ADDRESS = /^\/media\/fonts\/[a-z0-9][a-z0-9-]{0,99}\.woff2$/;

/** How many fonts of its own a site can have, and how many files each. */
export const MAX_CUSTOM_FONTS = 8;
export const MAX_FONT_FILES = 18;

/** The largest font file that can be added. Whole alphabets of Chinese, Japanese or Korean fit. */
export const MAX_FONT_BYTES = 5 * 1024 * 1024;

/** Weights by the words fonts' file names use for them. */
const WEIGHT_WORDS: Array<[RegExp, number]> = [
  [/(extra|ultra)[-_ ]?light/i, 200],
  [/(semi|demi)[-_ ]?bold/i, 600],
  [/(extra|ultra)[-_ ]?bold/i, 800],
  [/hairline|thin/i, 100],
  [/light/i, 300],
  [/medium/i, 500],
  [/bold/i, 700],
  [/black|heavy/i, 900],
  [/regular|normal|book|roman/i, 400],
];

/** Whether bytes are a WOFF2 font: every one starts with `wOF2`. */
export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.length > 48 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
}

/** The site's own fonts. */
export function customFonts(theme: Theme): CustomFont[] {
  return theme.fonts.custom ?? [];
}

/** The site's own font of a family, compared without case, or `undefined` for a Google font. */
export function customFont(theme: Theme, family: string | undefined): CustomFont | undefined {
  if (!family) return undefined;
  const name = family.toLowerCase();
  return customFonts(theme).find((font) => font.family.toLowerCase() === name);
}

/**
 * What a font file's name says about it: its weight, whether it's italic, and
 * whether it's a variable font, which has every weight in one file.
 * `Brandon-SemiBoldItalic.woff2` → 600, italic.
 */
export function guessFontFile(name: string): Pick<CustomFontFile, "weight" | "weightTo" | "style"> {
  const stem = name.replace(/\.woff2$/i, "");
  const italic = /italic|oblique/i.test(stem);
  if (/variable|\[wght|[-_]vf\b|wght/i.test(stem)) {
    return { weight: 100, weightTo: 900, ...(italic && { style: "italic" }) };
  }
  const number = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(stem)?.[1];
  const weight = number ? Number(number) : (WEIGHT_WORDS.find(([pattern]) => pattern.test(stem))?.[1] ?? 400);
  return { weight, ...(italic && { style: "italic" }) };
}

/** The family a font file's name names: what's before its weight and style. `Brandon_Grotesque-BoldItalic.woff2` → `Brandon Grotesque`. */
export function guessFontFamily(name: string): string {
  const stem = name.replace(/\.woff2$/i, "").split(/[-]/)[0] ?? "";
  return stem
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** The name a font file is kept under: `brandon-700-italic.woff2`, or `brandon-100-900.woff2` for a variable font. */
export function fontFileName(family: string, file: Pick<CustomFontFile, "weight" | "weightTo" | "style">): string {
  const stem =
    family
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "font";
  const weights = file.weightTo ? `${file.weight}-${file.weightTo}` : String(file.weight);
  return `${stem.slice(0, 60)}-${weights}${file.style === "italic" ? "-italic" : ""}.woff2`;
}

/** A root-relative address with the site's base path in front: `/media/x` → `/repo/media/x`. */
function withPath(url: string, base: string | undefined): string {
  const prefix = (base ?? "").replace(/\/+$/, "");
  return prefix ? `${prefix}${url}` : url;
}

/**
 * The `@font-face` rules for the site's own fonts, under the site's base path.
 * `font-display: swap` shows a stand-in while each loads, so text is never
 * hidden. Families and addresses are checked by the schema, so nothing in
 * them can end a rule or the `<style>` element.
 */
export function customFontFaces(theme: Theme, base?: string): string {
  return customFonts(theme)
    .flatMap((font) =>
      font.files
        .filter((file) => CUSTOM_FONT_ADDRESS.test(file.src))
        .map((file) => {
          const weight = file.weightTo ? `${file.weight} ${file.weightTo}` : String(file.weight);
          return `@font-face{font-family:"${font.family}";src:url("${withPath(file.src, base)}") format("woff2");font-weight:${weight};font-style:${file.style ?? "normal"};font-display:swap}`;
        }),
    )
    .join("");
}

/** The file of a font with a weight, upright: the one for that weight, else the nearest. */
export function fontFileFor(font: CustomFont, weight: number): CustomFontFile | undefined {
  const upright = font.files.filter((file) => (file.style ?? "normal") === "normal");
  const files = upright.length ? upright : font.files;
  const covers = files.find((file) => file.weight <= weight && weight <= (file.weightTo ?? file.weight));
  if (covers) return covers;
  return [...files].sort((a, b) => Math.abs(a.weight - weight) - Math.abs(b.weight - weight))[0];
}

/**
 * The site's own font files pages should preload, as `fontPreloads()` does
 * for Google's: the text font's 400 and the headings' 700, upright.
 */
export function customFontPreloads(theme: Theme): string[] {
  const files = [
    fontFileFor(customFont(theme, theme.fonts.body) ?? emptyFont, 400),
    fontFileFor(customFont(theme, theme.fonts.heading) ?? emptyFont, 700),
  ];
  return [...new Set(files.flatMap((file) => (file && CUSTOM_FONT_ADDRESS.test(file.src) ? [file.src] : [])))];
}

const emptyFont: CustomFont = { family: "", files: [] };

/** The kind of font a family is, for its fallbacks: its own font's, or the one Site Settings saved for Google's. */
export function fontCategory(theme: Theme, part: "heading" | "body"): FontCategory | undefined {
  const own = customFont(theme, theme.fonts[part]);
  if (own) return own.category;
  return part === "heading" ? theme.fonts.headingCategory : theme.fonts.bodyCategory;
}

/** Every file of the site's own fonts, as media library paths (`public/media/fonts/…`). */
export function customFontPaths(theme: Theme): string[] {
  return customFonts(theme).flatMap((font) => font.files.map((file) => `public${file.src}`));
}

/**
 * Whether a file saved in the media library is a usable font file: in the
 * fonts folder, by the name it's saved under, and a WOFF2 font by its bytes,
 * so nothing else can be saved there as one.
 */
export function isSafeFontFile(path: string, bytes: Uint8Array | undefined): boolean {
  return (
    path.startsWith(`${FONTS_MEDIA_DIR}/`) &&
    CUSTOM_FONT_ADDRESS.test(path.slice("public".length)) &&
    bytes !== undefined &&
    isWoff2(bytes) &&
    bytes.length <= MAX_FONT_BYTES
  );
}

/**
 * The file changes that go with a change to the site's own fonts: each file
 * the fonts name that was added since the theme was loaded, from `added` (its
 * bytes, by path), and the deletion of each file the fonts no longer name. Published with `content/site.json` in one commit.
 */
export function customFontFileChanges(
  before: Theme,
  after: Theme,
  added: Readonly<Record<string, Uint8Array>>,
): FileChange[] {
  const was = new Set(customFontPaths(before));
  const now = new Set(customFontPaths(after));
  const changes: FileChange[] = [];
  for (const path of now) {
    const bytes = added[path];
    // Added since: new, or in place of a file of the same name that was taken out.
    if (bytes) changes.push({ path, bytes });
  }
  for (const path of was) if (!now.has(path)) changes.push({ path, delete: true });
  return changes;
}
