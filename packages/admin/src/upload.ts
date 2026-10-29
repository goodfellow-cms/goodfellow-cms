import { extensionOf, MAX_UPLOAD_BYTES, mediaKind } from "./media.js";
import { mediaType } from "./media-previews.js";

/** Photos are made no larger than this on their longest side, which is plenty for any screen. */
export const MAX_IMAGE_SIDE = 2400;

export type UploadProblem = "type" | "size" | "unreadable";

export class UploadError extends Error {
  override name = "UploadError";

  constructor(
    readonly problem: UploadProblem,
    readonly file: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedUpload {
  /** The name the file was chosen with. */
  name: string;
  bytes: Uint8Array;
  type: string;
}

const REENCODED: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

async function canvasBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
}

/**
 * Re-saves a photo: smaller if it's larger than any screen needs, and always
 * for JPEGs, which drops details hidden in the file such as where it was taken.
 * Returns `undefined` to keep the file as it is.
 */
async function resized(file: File, extension: string): Promise<Blob | undefined> {
  const type = REENCODED[extension];
  if (!type || typeof createImageBitmap !== "function") return undefined;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new UploadError("unreadable", file.name, `${file.name} couldn't be read as an image.`);
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && type !== "image/jpeg") {
    bitmap.close();
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvasBlob(canvas, type);
  // Keep the original if re-saving didn't help, such as for an already well-compressed small photo.
  return blob && (scale < 1 || blob.size < file.size) ? blob : undefined;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
/** Namespaces an SVG's attributes may be in, besides none. */
const SVG_ATTRIBUTE_NAMESPACES = new Set([
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/xmlns/",
]);
/** The SVG elements uploads keep: drawing, text, links, styles and animation, but nothing that loads a page or runs code. */
const SVG_ELEMENTS = new Set([
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
/** Addresses links and images may have: within the file, on the web, relative ones, and pictures. */
const SAFE_SVG_ADDRESS = /^(#|https?:|data:image\/(png|jpeg|gif|webp)[;,]|(?![a-z][a-z\d+.-]*:))/;

/**
 * Addresses an SVG loads as it draws (images, filters' images, `use` and CSS's
 * `url()`): within the file, the site's own, and pictures in the file, so an
 * SVG opened on its own never asks another site for anything.
 */
const LOADED_SVG_ADDRESS = /^(#|data:image\/(png|jpeg|gif|webp)[;,]|(?![a-z][a-z\d+.-]*:)(?!\/\/))/;

/**
 * CSS with what would load from another site taken out: `@import`, and
 * `url()`s other than the file's own and the site's. Escapes could spell
 * either some other way, so CSS with any is left out whole (`undefined`).
 */
function cssWithoutOutsideAddresses(css: string): string | undefined {
  if (css.includes("\\")) return undefined;
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _quote: string, address: string) =>
      LOADED_SVG_ADDRESS.test(normalized(address)) ? whole : "none",
    );
}

/** An attribute's value as a browser reads an address: without the spaces and control characters it skips. */
function normalized(value: string): string {
  return value.replace(/[\s\p{Cc}]/gu, "").toLowerCase();
}

function isLink(name: string): boolean {
  return name === "href" || name === "xlink:href";
}

/** Whether an element can stay, once its attributes are cleaned. */
function keepsElement(element: Element): boolean {
  if (element.namespaceURI !== SVG_NAMESPACE || !SVG_ELEMENTS.has(element.localName)) return false;
  if (element.localName.startsWith("animate")) {
    // Animating a link or an event handler sets it after the file's been cleaned.
    const name = normalized(element.getAttribute("attributeName") ?? "");
    if (isLink(name) || name.startsWith("on")) return false;
  }
  return true;
}

function cleanElement(element: Element): void {
  // Only links are followed when someone chooses to; everything else's addresses load with the picture.
  const loads = element.localName !== "a";
  for (const attribute of [...element.attributes]) {
    const value = normalized(attribute.value);
    if (attribute.value.includes("url(") || (attribute.localName === "style" && attribute.value.includes("\\"))) {
      const css = cssWithoutOutsideAddresses(attribute.value);
      if (css === undefined) {
        element.removeAttributeNode(attribute);
        continue;
      }
      attribute.value = css;
    }
    if (
      (attribute.namespaceURI !== null && !SVG_ATTRIBUTE_NAMESPACES.has(attribute.namespaceURI)) ||
      (attribute.name.includes(":") && !/^(xlink|xml|xmlns):/.test(attribute.name)) ||
      attribute.localName.toLowerCase().startsWith("on") ||
      value.includes("javascript:") ||
      value.includes("vbscript:") ||
      (isLink(attribute.name.toLowerCase()) && !(loads ? LOADED_SVG_ADDRESS : SAFE_SVG_ADDRESS).test(value))
    ) {
      element.removeAttributeNode(attribute);
    }
  }
  for (const child of [...element.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      if (keepsElement(child as Element)) cleanElement(child as Element);
      else child.remove();
    } else if (child.nodeType !== Node.TEXT_NODE && child.nodeType !== Node.CDATA_SECTION_NODE) {
      child.remove();
    }
  }
  if (element.localName === "style") {
    const css = cssWithoutOutsideAddresses(element.textContent ?? "");
    if (css === undefined) element.remove();
    else if (css !== element.textContent) element.textContent = css;
  }
}

/**
 * Keeps only what an SVG needs to draw itself, so it can't run code if someone
 * opens the file directly: SVG's own drawing elements, with no scripts,
 * embedded pages, elements from other namespaces, event handlers, processing
 * instructions (an XSL stylesheet could write a page), or javascript:, vbscript:
 * and other addresses than the web's, the file's own and pictures. What it
 * loads as it draws comes only from the file itself or the site, so opening it
 * tells no one else.
 */
export function cleanSvg(text: string): string | undefined {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.namespaceURI !== SVG_NAMESPACE || root.localName !== "svg") {
    return undefined;
  }
  for (const child of [...doc.childNodes]) if (child !== root) child.remove();
  cleanElement(root);
  return new XMLSerializer().serializeToString(doc);
}

/** A file checked and made ready, as a `Blob`: photos made web-sized, SVGs made safe, other files as they are. */
async function prepared(file: File, maxBytes: number): Promise<Blob> {
  const extension = extensionOf(file.name);
  if (!mediaKind(file.name)) {
    throw new UploadError("type", file.name, `${file.name} isn't a kind of file the site can use.`);
  }

  let blob: Blob = file;
  if (extension === "svg") {
    const cleaned = cleanSvg(await file.text());
    if (cleaned === undefined) throw new UploadError("unreadable", file.name, `${file.name} isn't a valid SVG image.`);
    blob = new Blob([cleaned], { type: "image/svg+xml" });
  } else if (mediaKind(file.name) === "image") {
    blob = (await resized(file, extension)) ?? file;
  }

  if (blob.size > maxBytes) {
    throw new UploadError("size", file.name, `${file.name} is ${blob.size} bytes, over the ${maxBytes}-byte limit.`);
  }
  return blob;
}

/** Checks a file chosen for upload and gets it ready: photos made web-sized, SVGs made safe. */
export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const blob = await prepared(file, MAX_UPLOAD_BYTES);
  return { name: file.name, bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type || file.type };
}

/** A file ready for a plugin to keep outside the site's own files, never read into memory whole. */
export interface PreparedStoredUpload {
  name: string;
  blob: Blob;
  type: string;
  /** A picture's size in pixels, where the browser can read it. */
  width?: number;
  height?: number;
}

/** Reads a picture's size in pixels, or nothing where the browser can't. */
export async function imageSize(blob: Blob, name: string): Promise<{ width: number; height: number } | undefined> {
  if (mediaKind(name) !== "image" || extensionOf(name) === "svg" || typeof createImageBitmap !== "function") {
    return undefined;
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size.width > 0 && size.height > 0 ? size : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Checks a file for media storage and gets it ready as `prepareUpload()`
 * does, up to the storage's largest file rather than the site's own 25 MB.
 */
export async function prepareStoredUpload(file: File, maxBytes: number): Promise<PreparedStoredUpload> {
  const blob = await prepared(file, maxBytes);
  const type = blob.type || file.type || mediaType(file.name);
  return { name: file.name, blob, type, ...(await imageSize(blob, file.name)) };
}
