import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateFontFace, getMetricsForFamily, readMetrics } from "fontaine";
import type { FontCategory, Theme } from "./content/schemas.js";
import { CUSTOM_FONT_ADDRESS, customFont, fontCategory, fontFileFor } from "./custom-fonts.js";
import {
  FONTS_DIR,
  type HostedFonts,
  type ReadFontFile,
  type ReadStylesheet,
  type SelfHostedResult,
  selfHostedFonts,
  withSelfHostedFonts,
} from "./fonts.js";
import { type FontStandIns, googleFontsUrl } from "./theme.js";

/** How long a build waits for a stylesheet before going on without it. */
const TIMEOUT_MS = 5000;

/** How long a build waits for each font file. */
const FONT_TIMEOUT_MS = 15000;

/**
 * How long a build waits before asking again, after each try that failed. A
 * build can ask Google for the same fonts from several processes at once
 * (`next build` loads the config in each), and one failed request would leave
 * every page loading its fonts from Google, so each is asked again a few times.
 */
export const FONT_RETRY_DELAYS_MS = [1000, 3000];

/**
 * An answer from Google Fonts, asked again after a failed connection, a timeout
 * or an answer saying to try later (429 or 5xx), or `undefined` where none came.
 */
export async function fetchFontsAsset(
  url: string,
  init: { headers?: Record<string, string>; timeout: number },
  options: { fetch?: typeof fetch; delays?: number[]; wait?: (ms: number) => Promise<void> } = {},
): Promise<Response | undefined> {
  const send = options.fetch ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = options.delays ?? FONT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await send(url, {
        ...(init.headers && { headers: init.headers }),
        signal: AbortSignal.timeout(init.timeout),
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) return undefined;
    } catch {
      // A failed connection or a timeout: asked again below.
    }
    const delay = delays[attempt];
    if (delay === undefined) return undefined;
    await response?.body?.cancel().catch(() => undefined);
    await wait(delay);
  }
}

/** Reads a stylesheet from the web, for `fontPreloads()`. */
export const readStylesheet: ReadStylesheet = async (url, userAgent) => {
  try {
    const response = await fetchFontsAsset(url, { headers: { "user-agent": userAgent }, timeout: TIMEOUT_MS });
    return response ? await response.text() : undefined;
  } catch {
    return undefined;
  }
};

/** Reads a font file from the web, for `selfHostedFonts()`. */
export const readFontFile: ReadFontFile = async (url) => {
  try {
    const response = await fetchFontsAsset(url, { timeout: FONT_TIMEOUT_MS });
    return response ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Puts a built site's Google Fonts in the site itself (`selfHostedFonts()`),
 * in `FONTS_DIR`, and points every page and Next.js payload at them
 * (`withSelfHostedFonts()`), so visitors' browsers don't ask Google for them.
 * Where Google can't be reached, pages keep loading them from Google, as the
 * renderers wrote them. `base` is the site's base path.
 */
export async function selfHostFonts(
  outDir: string,
  theme: Theme,
  options: { base?: string; read?: ReadStylesheet; readFont?: ReadFontFile } = {},
): Promise<SelfHostedResult> {
  if (!googleFontsUrl(theme)) return undefined;
  const fonts = await selfHostedFonts(theme, options.read ?? readStylesheet, options.readFont ?? readFontFile);
  if (!fonts) return { unavailable: true };
  for (const file of fonts.files) {
    const target = join(outDir, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "content" in file ? file.content : file.bytes);
  }
  for (const entry of await readdir(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(html|txt)$/.test(entry.name)) continue;
    const file = join(entry.parentPath, entry.name);
    const text = await readFile(file, "utf8");
    const next = withSelfHostedFonts(text, fonts, options.base);
    if (next !== text) await writeFile(file, next);
  }
  return { hosted: fonts.fonts.length };
}

/**
 * Puts a full-stack site's Google Fonts in its `public/` folder
 * (`selfHostedFonts()`), in `FONTS_DIR`, in place of what an earlier build
 * put there (which stays where Google can't be reached, since another of
 * the build's processes may have written it), before Next.js renders any page, since it can't change pages
 * once they're rendered. Gives where they are, which the renderer points
 * pages at as it renders them, or `{ unavailable: true }` where Google can't
 * be reached, so pages keep loading them from Google, and `undefined` for a
 * site without any.
 */
export async function hostFonts(
  publicDir: string,
  theme: Theme,
  options: { read?: ReadStylesheet; readFont?: ReadFontFile } = {},
): Promise<HostedFonts | { unavailable: true } | undefined> {
  const folder = join(publicDir, FONTS_DIR);
  if (!googleFontsUrl(theme)) {
    await rm(folder, { recursive: true, force: true });
    return undefined;
  }
  // `next build` loads the config in several processes, each of which comes here: one that can't reach Google
  // leaves what another wrote, which pages may already point at.
  const fonts = await selfHostedFonts(theme, options.read ?? readStylesheet, options.readFont ?? readFontFile);
  if (!fonts) return { unavailable: true };
  const kept = new Set<string>();
  for (const file of fonts.files) {
    const target = join(publicDir, file.path);
    kept.add(target);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "content" in file ? file.content : file.bytes);
  }
  // What an earlier build put there goes, once this one's files are in place.
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && !kept.has(path)) await rm(path, { force: true });
  }
  return { source: fonts.source, stylesheet: fonts.stylesheet, fonts: fonts.fonts };
}

/**
 * The computer fonts each kind of font is stood in for by, the first one the
 * computer has used: Windows and macOS have the first, Android has Roboto,
 * and Linux usually Liberation's or Noto's. Liberation's fonts are made to the
 * same measurements as Arial, Times New Roman and Courier New, which Fontaine
 * has measurements for where it has none for them.
 */
const SANS = [{ font: "Arial" }, { font: "Roboto" }, { font: "Liberation Sans", like: "Arial" }, { font: "Noto Sans" }];
const STAND_INS: Record<FontCategory, Array<{ font: string; like?: string }>> = {
  "sans-serif": SANS,
  serif: [
    { font: "Times New Roman" },
    { font: "Georgia" },
    { font: "Liberation Serif", like: "Times New Roman" },
    { font: "Noto Serif" },
  ],
  monospace: [{ font: "Courier New" }, { font: "Liberation Mono", like: "Courier New" }],
  display: SANS,
  handwriting: SANS,
};

const CATEGORIES = new Set<string>(Object.keys(STAND_INS));

/** A stand-in's name: each computer font gets one of its own, so the browser can go on to the next. */
function standInName(family: string, local: string): string {
  return `${family} fallback (${local})`;
}

/**
 * A font's measurements: a Google font's from Fontaine's list, or the site's
 * own font's read from its file in the site at `root`, if it has one.
 */
async function metricsFor(theme: Theme, family: string, root: string | undefined) {
  const own = customFont(theme, family);
  if (!own) return getMetricsForFamily(family);
  const file = fontFileFor(own, 400);
  if (!root || !file || !CUSTOM_FONT_ADDRESS.test(file.src)) return null;
  return readMetrics(pathToFileURL(join(root, "public", file.src))).catch(() => null);
}

async function standInsFor(theme: Theme, family: string, category: FontCategory | undefined, root?: string) {
  const metrics = await metricsFor(theme, family, root);
  if (!metrics) return { names: [], css: "" };
  const kind = category ?? (CATEGORIES.has(metrics.category ?? "") ? (metrics.category as FontCategory) : "sans-serif");
  const names: string[] = [];
  let css = "";
  for (const { font, like } of STAND_INS[kind]) {
    const localMetrics = await getMetricsForFamily(like ?? font);
    if (!localMetrics) continue;
    const name = standInName(family, font);
    names.push(name);
    // One rule per line, without generateFontFace()'s blank lines.
    css += generateFontFace(metrics, { name, font, metrics: localMetrics }).replace(/\s+/g, " ").trim();
  }
  return { names, css };
}

/**
 * Stand-ins for a theme's fonts, made with Fontaine from each font's
 * measurements: the computer's own fonts, resized so text takes the same space
 * while the font loads and doesn't move when it arrives. The site's own fonts
 * are measured from their files in the site at `root`; fonts Fontaine has no
 * measurements for, and the site's own without `root`, get none.
 */
export async function fontStandIns(theme: Theme, options: { root?: string } = {}): Promise<FontStandIns> {
  const { heading, body } = theme.fonts;
  const headingCategory = fontCategory(theme, "heading");
  const bodyCategory = fontCategory(theme, "body");
  try {
    const headingStandIns = heading ? await standInsFor(theme, heading, headingCategory, options.root) : undefined;
    const bodyStandIns =
      body && body !== heading
        ? await standInsFor(theme, body, bodyCategory, options.root)
        : body
          ? headingStandIns
          : undefined;
    return {
      css: (headingStandIns?.css ?? "") + (body !== heading ? (bodyStandIns?.css ?? "") : ""),
      ...(headingStandIns?.names.length && { heading: headingStandIns.names }),
      ...(bodyStandIns?.names.length && { body: bodyStandIns.names }),
    };
  } catch {
    return { css: "" };
  }
}
