/**
 * What an SVG in the media library may hold, so it can't run code or tell
 * another site it was opened: the rules the admin panel cleans uploads with
 * (`cleanSvg()`, in the browser's own parser) and servers check what they're
 * sent against (`isCleanSvg()` in `@goodfellow-cms/core/node`), so both agree.
 * No DOM: each side reads the file with its own parser.
 */

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
export const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/** Namespaces an SVG's attributes may be in, besides none. */
export const SVG_ATTRIBUTE_NAMESPACES: ReadonlySet<string> = new Set([XLINK_NAMESPACE, XML_NAMESPACE, XMLNS_NAMESPACE]);

/** The SVG elements uploads keep: drawing, text, links, styles and animation, but nothing that loads a page or runs code. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "title",
  "desc",
  "switch",
  "view",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "textPath",
  "image",
  "a",
  "style",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "animate",
  "animateMotion",
  "animateTransform",
  "mpath",
]);

/** Addresses links may have: within the file, on the web, relative ones, and pictures. */
const SAFE_SVG_ADDRESS = /^(#|https?:|data:image\/(png|jpeg|gif|webp)[;,]|(?![a-z][a-z\d+.-]*:))/;

/**
 * Addresses an SVG loads as it draws (images, filters' images, `use` and CSS's
 * `url()`): within the file, the site's own, and pictures in the file, so an
 * SVG opened on its own never asks another site for anything. Browsers read
 * `\` as `/` in web addresses, so `/\host` is another site's, as `//host` is.
 */
const LOADED_SVG_ADDRESS = /^(#|data:image\/(png|jpeg|gif|webp)[;,]|(?![a-z][a-z\d+.-]*:)(?![/\\]{2}))/;

/** An attribute's value as a browser reads an address: without the spaces and control characters it skips. */
export function normalizedSvgValue(value: string): string {
  return value.replace(/[\s\p{Cc}]/gu, "").toLowerCase();
}

/** Whether a value says something CSS reads as loading from an address: `url()` in any case, or `image-set()`. */
function loadsInCss(value: string): boolean {
  return /url\s*\(|image-set\s*\(/i.test(value);
}

/**
 * CSS with what would load from another site taken out: `@import`, and
 * `url()`s other than the file's own and the site's. Escapes could spell
 * either some other way, and `image-set()` loads from a plain string, so CSS
 * with any is left out whole (`undefined`).
 */
export function cssWithoutOutsideAddresses(css: string): string | undefined {
  if (css.includes("\\") || /image-set\s*\(/i.test(css)) return undefined;
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _quote: string, address: string) =>
      LOADED_SVG_ADDRESS.test(normalizedSvgValue(address)) ? whole : "none",
    );
}

function isLink(name: string): boolean {
  return name === "href" || name === "xlink:href";
}

/**
 * Whether an element can stay, by its local name (in SVG's namespace) and,
 * for animations, the attribute it animates: animating a link or an event
 * handler would set it after the file's been cleaned.
 */
export function keepsSvgElement(localName: string, animates: string | null): boolean {
  if (!SVG_ELEMENTS.has(localName)) return false;
  if (localName.startsWith("animate")) {
    const name = normalizedSvgValue(animates ?? "");
    if (isLink(name) || name.startsWith("on")) return false;
  }
  return true;
}

/** What an attribute of an SVG element becomes once cleaned: its value as it was, a cleaned one, or nothing. */
export type CleanedAttribute = { keep: true; value: string } | { keep: false };

/**
 * An attribute as cleaning leaves it, by its qualified name (`xlink:href`),
 * local name, namespace (`null` for none) and value, on an element with this
 * local name: links only where they're safe, no event handlers or other
 * namespaces, and CSS with nothing that loads from another site.
 */
export function cleanedSvgAttribute(
  element: string,
  name: string,
  localName: string,
  namespace: string | null,
  value: string,
): CleanedAttribute {
  let cleaned = value;
  // Presentation attributes are CSS, which escapes could spell an address in, as `style` can.
  if (loadsInCss(value) || value.includes("\\")) {
    const css = cssWithoutOutsideAddresses(value);
    if (css === undefined) return { keep: false };
    cleaned = css;
  }
  const normalized = normalizedSvgValue(cleaned);
  // Only links are followed when someone chooses to; everything else's addresses load with the picture.
  const loads = element !== "a";
  if (
    (namespace !== null && !SVG_ATTRIBUTE_NAMESPACES.has(namespace)) ||
    (name.includes(":") && !/^(xlink|xml|xmlns):/.test(name)) ||
    localName.toLowerCase().startsWith("on") ||
    normalized.includes("javascript:") ||
    normalized.includes("vbscript:") ||
    (isLink(name.toLowerCase()) && !(loads ? LOADED_SVG_ADDRESS : SAFE_SVG_ADDRESS).test(normalized))
  ) {
    return { keep: false };
  }
  return { keep: true, value: cleaned };
}
