import { generateFontFace, getMetricsForFamily } from "fontaine";
import type { FontCategory, Theme } from "./content/schemas.js";
import type { ReadStylesheet } from "./fonts.js";
import type { FontStandIns } from "./theme.js";

/** How long a build waits for a stylesheet before going on without it. */
const TIMEOUT_MS = 5000;

/** Reads a stylesheet from the web, for `fontPreloads()`. */
export const readStylesheet: ReadStylesheet = async (url, userAgent) => {
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
};

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

async function standInsFor(family: string, category: FontCategory | undefined) {
  const metrics = await getMetricsForFamily(family);
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
 * Stand-ins for a theme's Google Fonts, made with Fontaine from each font's
 * measurements: the computer's own fonts, resized so text takes the same space
 * while the font loads and doesn't move when it arrives. Fonts Fontaine has no
 * measurements for get none.
 */
export async function fontStandIns(theme: Theme): Promise<FontStandIns> {
  const { heading, body, headingCategory, bodyCategory } = theme.fonts;
  try {
    const headingStandIns = heading ? await standInsFor(heading, headingCategory) : undefined;
    const bodyStandIns =
      body && body !== heading ? await standInsFor(body, bodyCategory) : body ? headingStandIns : undefined;
    return {
      css: (headingStandIns?.css ?? "") + (body !== heading ? (bodyStandIns?.css ?? "") : ""),
      ...(headingStandIns?.names.length && { heading: headingStandIns.names }),
      ...(bodyStandIns?.names.length && { body: bodyStandIns.names }),
    };
  } catch {
    return { css: "" };
  }
}
