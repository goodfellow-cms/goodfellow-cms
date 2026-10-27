/**
 * Blocks' icons, as data rather than code, so the editor's block list and
 * editor plugins can show them without running anything of the site's: SVG
 * shapes on a 24-unit grid, drawn with a 2-unit stroke and no fill, as
 * Lucide's icons are (`import { Heading } from "lucide"` is one). Only plain
 * shapes and the attributes that place them are kept, so an icon can't carry
 * a script, a link or anything loaded from elsewhere.
 */
import { z } from "zod";

/** The SVG elements an icon may have. */
export const ICON_SHAPES = ["path", "circle", "ellipse", "line", "polyline", "polygon", "rect"] as const;
export type IconShape = (typeof ICON_SHAPES)[number];

/** The attributes that say where each shape is, the only ones an icon keeps. */
export const ICON_ATTRIBUTES = [
  "d",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "width",
  "height",
  "points",
] as const;

/** A block's icon: its shapes in order, each an element's name and its attributes. */
export type BlockIcon = ReadonlyArray<readonly [IconShape, Readonly<Record<string, string>>]>;

/** At most this many shapes, and this much in each attribute: icons are small. */
const MAX_SHAPES = 32;
const MAX_VALUE = 2_000;

/** Numbers, letters and the punctuation of path data and points: never `url(…)`, quotes or `<`. */
const SAFE_VALUE = /^[\d\s.,+\-eEaAcChHlLmMqQsStTvVzZ]*$/;

/**
 * An icon with only what icons may hold, or `undefined` where there's none:
 * unknown shapes and attributes are left out, and so are values that aren't
 * numbers or path data. Lucide's icon data, with its `key`s, fits as it is.
 */
export function cleanBlockIcon(value: unknown): BlockIcon | undefined {
  if (!Array.isArray(value)) return undefined;
  const shapes: Array<[IconShape, Record<string, string>]> = [];
  for (const entry of value.slice(0, MAX_SHAPES)) {
    if (!Array.isArray(entry)) continue;
    const [name, attributes] = entry as [unknown, unknown];
    if (!(ICON_SHAPES as readonly unknown[]).includes(name)) continue;
    if (!attributes || typeof attributes !== "object") continue;
    const kept: Record<string, string> = {};
    for (const attribute of ICON_ATTRIBUTES) {
      const given = (attributes as Record<string, unknown>)[attribute];
      if (typeof given !== "string" && typeof given !== "number") continue;
      const text = String(given);
      if (text.length <= MAX_VALUE && SAFE_VALUE.test(text)) kept[attribute] = text;
    }
    if (Object.keys(kept).length > 0) shapes.push([name as IconShape, kept]);
  }
  return shapes.length > 0 ? shapes : undefined;
}

/** An icon in a site's description: what isn't one is left out rather than failing the description. */
export const blockIconSchema = z
  .unknown()
  .transform((value) => cleanBlockIcon(value))
  .optional();
