/**
 * Contrast between CSS colors, as WCAG measures it, for warning about theme
 * colors that text is hard to read on. Reads the color formats Site Settings
 * offers and themes use: hex, `rgb()`, `hsl()`, `oklch()` and `oklab()`.
 */

/** A color as red, green and blue from 0 to 1, in sRGB. */
type Rgb = [number, number, number];

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseHex(hex: string): Rgb | undefined {
  const digits = hex.slice(1);
  if (!/^[0-9a-f]+$/i.test(digits)) return undefined;
  const full =
    digits.length === 3 || digits.length === 4
      ? [...digits.slice(0, 3)].map((digit) => digit + digit).join("")
      : digits.length === 6 || digits.length === 8
        ? digits.slice(0, 6)
        : undefined;
  if (!full) return undefined;
  return [0, 2, 4].map((at) => Number.parseInt(full.slice(at, at + 2), 16) / 255) as Rgb;
}

/** A function's arguments, such as `30 58 138` or `30, 58, 138`, without any alpha after `/`. */
function functionArguments(color: string): string[] | undefined {
  const match = /^[a-z]+\(([^)]*)\)$/i.exec(color);
  if (!match?.[1]) return undefined;
  const [channels = ""] = match[1].split("/");
  const parts = channels
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 3 ? parts.slice(0, 3) : undefined;
}

/** A number, or a percentage of `full`. */
function amount(text: string, full: number): number | undefined {
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) return undefined;
  return text.endsWith("%") ? (value / 100) * full : value;
}

function hue(text: string): number | undefined {
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) return undefined;
  if (text.endsWith("rad")) return (value * 180) / Math.PI;
  if (text.endsWith("turn")) return value * 360;
  return value;
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function oklabToRgb(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => clamp(fromLinear(channel))) as Rgb;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const turn = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((turn % 2) - 1));
  const [r, g, b] =
    turn < 1
      ? [chroma, x, 0]
      : turn < 2
        ? [x, chroma, 0]
        : turn < 3
          ? [0, chroma, x]
          : turn < 4
            ? [0, x, chroma]
            : turn < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const lightest = l - chroma / 2;
  return [r + lightest, g + lightest, b + lightest].map(clamp) as Rgb;
}

/** A CSS color in sRGB, or `undefined` for one this can't read, such as a color name. */
export function parseColor(color: string): Rgb | undefined {
  const text = color.trim().toLowerCase();
  if (text.startsWith("#")) return parseHex(text);
  const parts = functionArguments(text);
  if (!parts) return undefined;
  const [first = "", second = "", third = ""] = parts;
  const kind = text.slice(0, text.indexOf("("));
  if (kind === "rgb" || kind === "rgba") {
    const channels = [first, second, third].map((part) => amount(part, 255));
    if (channels.some((channel) => channel === undefined)) return undefined;
    return channels.map((channel) => clamp((channel ?? 0) / 255)) as Rgb;
  }
  if (kind === "hsl" || kind === "hsla") {
    const [h, s, l] = [hue(first), amount(second, 1), amount(third, 1)];
    if (h === undefined || s === undefined || l === undefined) return undefined;
    // Percentages are fractions here; bare numbers are read as percentages, as CSS's modern syntax allows.
    return hslToRgb(h, second.endsWith("%") ? s : s / 100, third.endsWith("%") ? l : l / 100);
  }
  if (kind === "oklch" || kind === "oklab") {
    const lightness = amount(first, 1);
    if (lightness === undefined) return undefined;
    if (kind === "oklab") {
      const [a, b] = [amount(second, 0.4), amount(third, 0.4)];
      return a === undefined || b === undefined ? undefined : oklabToRgb(lightness, a, b);
    }
    const [chroma, angle] = [amount(second, 0.4), hue(third)];
    if (chroma === undefined || angle === undefined) return undefined;
    const radians = (angle * Math.PI) / 180;
    return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians));
  }
  return undefined;
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG's contrast ratio between two colors, from 1 to 21, or `undefined` if either can't be read. */
export function contrastRatio(text: string, background: string): number | undefined {
  const [first, second] = [parseColor(text), parseColor(background)];
  if (!first || !second) return undefined;
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The contrast WCAG asks for between ordinary text and its background (level AA). */
export const MINIMUM_CONTRAST = 4.5;
