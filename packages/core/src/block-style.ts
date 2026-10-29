/**
 * A block's look as an editor chooses it (text alignment, font size, colors,
 * space inside and around it, rounded corners), kept as Tailwind classes in
 * the block's `className`, which every block has. Content needs nowhere new to
 * keep it, and the site's Tailwind finds the classes in `content/` as it does
 * any others. The theme's colors are `text-primary` and `bg-muted`, sizes are
 * on Tailwind's scales, and values of an editor's own are arbitrary classes
 * such as `p-[13px]`. Hiding a block on some sizes of screen is Tailwind's
 * breakpoints' `hidden` (`max-sm:hidden`, `sm:max-lg:hidden`, `lg:hidden`).
 * Other classes the style doesn't cover, responsive and dark ones included,
 * are kept as they were.
 */
import { THEME_COLORS, type ThemeColor } from "./content/schemas.js";

export type TextAlign = "left" | "center" | "right" | "justify";
export type Side = "top" | "right" | "bottom" | "left";
/** Space on each side: a step on Tailwind's spacing scale (`4`), or a length of the editor's own (`13px`). */
export type Sides = Partial<Record<Side, string>>;
/**
 * Sizes of screen, by Tailwind's breakpoints: phones below `sm` (640px),
 * tablets from `sm` to below `lg` (1024px), and computers from `lg`.
 */
export type ScreenSize = "phones" | "tablets" | "computers";

/**
 * A block's look. Sizes are a step on Tailwind's scale (`lg`, `4`) or a length
 * of the editor's own (`18px`); colors a theme color's name (`primary`) or a
 * color of the editor's own (`#1d4ed8`).
 */
export interface BlockStyle {
  align?: TextAlign;
  fontSize?: string;
  color?: string;
  background?: string;
  padding?: Sides;
  margin?: Sides;
  radius?: string;
  /** The sizes of screen the block isn't shown on, in `SCREEN_SIZES`' order. */
  hiddenOn?: ScreenSize[];
}

export const TEXT_ALIGNS: readonly TextAlign[] = ["left", "center", "right", "justify"];
export const SIDES: readonly Side[] = ["top", "right", "bottom", "left"];

/** Tailwind's font sizes, smallest first. */
export const FONT_SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"] as const;

/** Steps of Tailwind's spacing scale offered for space inside and around blocks, each a quarter of a rem. */
export const SPACING_STEPS = ["0", "1", "2", "3", "4", "6", "8", "10", "12", "16", "20", "24"] as const;

export const SCREEN_SIZES: readonly ScreenSize[] = ["phones", "tablets", "computers"];

/**
 * The classes that hide a block on sizes of screen, each with the sizes it
 * covers, written out so Tailwind finds them. Those covering two sizes come
 * first, so a style is written with the fewest. Plain `hidden` is never one:
 * blocks use it with `dark:block` and the like, which isn't hiding them.
 */
const HIDDEN_CLASSES: ReadonlyArray<readonly [string, readonly ScreenSize[]]> = [
  ["max-lg:hidden", ["phones", "tablets"]],
  ["sm:hidden", ["tablets", "computers"]],
  ["max-sm:hidden", ["phones"]],
  ["sm:max-lg:hidden", ["tablets"]],
  ["lg:hidden", ["computers"]],
];
const HIDDEN_BY_CLASS = new Map(HIDDEN_CLASSES);

/** Rounded corners: none, the theme's sizes, and round. */
export const RADII = ["none", "sm", "md", "lg", "xl", "full"] as const;

/** A theme color's name in classes: `primaryForeground` is `primary-foreground`. */
export function colorSlug(color: ThemeColor): string {
  return color.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

const COLOR_BY_SLUG = new Map<string, ThemeColor>(THEME_COLORS.map((color) => [colorSlug(color), color]));
const FONT_SIZE_SET = new Set<string>(FONT_SIZES);
const RADIUS_SET = new Set<string>(RADII);
/** Every step on Tailwind's spacing scale, halves included, as classes can name them. */
const SPACING_STEP = /^\d+(\.5)?$/;
const isSpacingStep = (step: string) => SPACING_STEP.test(step);
const isFontSize = (step: string) => FONT_SIZE_SET.has(step);
const isRadius = (step: string) => RADIUS_SET.has(step);
const isThemeColor = (slug: string) => COLOR_BY_SLUG.has(slug);

/** Whether a value is a color of an editor's own: a hex color, as color pickers give. */
export function isCustomColor(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
}

/** Whether a value is a length of an editor's own, such as `13px` or `1.5rem`. */
export function isCustomLength(value: string): boolean {
  return /^\d+(\.\d+)?(px|rem|em|%|vw|vh)$/.test(value) || value === "0";
}

/** A length an editor typed, tidied (`13 px` is `13px`, `13` is `13px`), or `undefined` for one that isn't. */
export function customLength(input: string): string | undefined {
  const text = input.trim().replace(/\s+/g, "").toLowerCase();
  const length = /^\d+(\.\d+)?$/.test(text) ? `${text}px` : text;
  return isCustomLength(length) ? length : undefined;
}

/** An arbitrary value from a class (`[13px]` is `13px`), or `undefined` for a class that has none. */
function arbitrary(value: string): string | undefined {
  return /^\[([^\]\s]+)\]$/.exec(value)?.[1];
}

function colorValue(value: string): string | undefined {
  if (COLOR_BY_SLUG.has(value)) return value;
  const custom = arbitrary(value);
  return custom && isCustomColor(custom) ? custom.toLowerCase() : undefined;
}

function lengthValue(value: string, steps: (step: string) => boolean): string | undefined {
  if (steps(value)) return value;
  const custom = arbitrary(value);
  return custom && isCustomLength(custom) ? custom : undefined;
}

const SPACING_SIDES: Record<string, readonly Side[]> = {
  "": SIDES,
  x: ["left", "right"],
  y: ["top", "bottom"],
  t: ["top"],
  r: ["right"],
  b: ["bottom"],
  l: ["left"],
};

/** What one class says about the style, or `false` for a class it doesn't cover. */
function readClass(name: string, style: BlockStyle): boolean {
  const hidden = HIDDEN_BY_CLASS.get(name);
  if (hidden) {
    const sizes = new Set([...(style.hiddenOn ?? []), ...hidden]);
    style.hiddenOn = SCREEN_SIZES.filter((size) => sizes.has(size));
    return true;
  }
  const align = /^text-(left|center|right|justify)$/.exec(name)?.[1] as TextAlign | undefined;
  if (align) {
    style.align = align;
    return true;
  }
  const text = /^text-(.+)$/.exec(name)?.[1];
  if (text !== undefined) {
    const size = lengthValue(text, isFontSize);
    if (size) {
      style.fontSize = size;
      return true;
    }
    const color = colorValue(text);
    if (color) {
      style.color = color;
      return true;
    }
    return false;
  }
  const background = /^bg-(.+)$/.exec(name)?.[1];
  if (background !== undefined) {
    const color = colorValue(background);
    if (!color) return false;
    style.background = color;
    return true;
  }
  const spacing = /^([pm])([xytrbl]?)-(.+)$/.exec(name);
  if (spacing) {
    const [, kind, sides = "", raw = ""] = spacing;
    const value = lengthValue(raw, isSpacingStep);
    if (!value) return false;
    const key = kind === "p" ? "padding" : "margin";
    const current = { ...style[key] };
    for (const side of SPACING_SIDES[sides] ?? []) current[side] = value;
    style[key] = current;
    return true;
  }
  const radius = /^rounded-(.+)$/.exec(name)?.[1];
  if (radius !== undefined) {
    const value = lengthValue(radius, isRadius);
    if (!value) return false;
    style.radius = value;
    return true;
  }
  return false;
}

/**
 * A block's `className` read as its style and the classes the style doesn't
 * cover, in their order. Later classes win over earlier ones, as Tailwind's
 * merging of a block's classes has them.
 */
export function readBlockStyle(className: unknown): { style: BlockStyle; other: string[] } {
  const style: BlockStyle = {};
  const other: string[] = [];
  const names = typeof className === "string" ? className.split(/\s+/).filter(Boolean) : [];
  for (const name of names) if (!readClass(name, style)) other.push(name);
  return { style, other };
}

/** A value as a class's value: a step or theme color as it is, a length or color of the editor's own in brackets. */
function classValue(value: string, named: (value: string) => boolean): string {
  return named(value) ? value : `[${value}]`;
}

/** A step or length, if it's one a class can say; anything else is left out. */
function validLength(value: string | undefined, steps: (step: string) => boolean): string | undefined {
  if (value === undefined || value === "") return undefined;
  return steps(value) || isCustomLength(value) ? value : undefined;
}

function validColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isThemeColor(value) || isCustomColor(value) ? value : undefined;
}

/** Space on each side as the fewest classes: `p-4`, `px-4 py-2`, or a class for each side. */
function sideClasses(prefix: "p" | "m", sides: Sides | undefined): string[] {
  if (!sides) return [];
  const value = (side: Side) => validLength(sides[side], isSpacingStep);
  const [top, right, bottom, left] = SIDES.map(value);
  const write = (suffix: string, length: string) => `${prefix}${suffix}-${classValue(length, isSpacingStep)}`;
  if (top !== undefined && top === right && top === bottom && top === left) return [write("", top)];
  const classes: string[] = [];
  if (left !== undefined && left === right) classes.push(write("x", left));
  else {
    if (left !== undefined) classes.push(write("l", left));
    if (right !== undefined) classes.push(write("r", right));
  }
  if (top !== undefined && top === bottom) classes.push(write("y", top));
  else {
    if (top !== undefined) classes.push(write("t", top));
    if (bottom !== undefined) classes.push(write("b", bottom));
  }
  return classes;
}

/** A style's classes, in a fixed order, leaving out anything a class can't say. */
export function blockStyleClasses(style: BlockStyle): string[] {
  const classes: string[] = [];
  if (style.align && TEXT_ALIGNS.includes(style.align)) classes.push(`text-${style.align}`);
  const size = validLength(style.fontSize, isFontSize);
  if (size) classes.push(`text-${classValue(size, isFontSize)}`);
  const color = validColor(style.color);
  if (color) classes.push(`text-${classValue(color, isThemeColor)}`);
  const background = validColor(style.background);
  if (background) classes.push(`bg-${classValue(background, isThemeColor)}`);
  classes.push(...sideClasses("p", style.padding), ...sideClasses("m", style.margin));
  const radius = validLength(style.radius, isRadius);
  if (radius) classes.push(`rounded-${classValue(radius, isRadius)}`);
  classes.push(...hiddenClasses(style.hiddenOn));
  return classes;
}

/** The fewest classes that hide a block on these sizes of screen. */
function hiddenClasses(sizes: readonly ScreenSize[] | undefined): string[] {
  const left = new Set(sizes?.filter((size) => SCREEN_SIZES.includes(size)));
  const classes: string[] = [];
  for (const [name, covers] of HIDDEN_CLASSES) {
    if (left.size === 0) break;
    if (covers.every((size) => left.has(size))) {
      classes.push(name);
      for (const size of covers) left.delete(size);
    }
  }
  return classes;
}

/**
 * A block's `className` with this style: the classes it doesn't cover first,
 * as they were, then the style's, so the style wins where they'd clash.
 */
export function withBlockStyle(other: readonly string[], style: BlockStyle): string {
  return [...other, ...blockStyleClasses(style)].join(" ");
}

/** A theme color by its name in classes (`primary-foreground`), if it is one. */
export function themeColorOf(slug: string): ThemeColor | undefined {
  return COLOR_BY_SLUG.get(slug);
}
