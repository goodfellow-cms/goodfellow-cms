import {
  cleanedSvgAttribute,
  cssWithoutOutsideAddresses,
  type FileChange,
  fileName,
  isSafeFontFile,
  keepsSvgElement,
  MEDIA_DIR,
  SVG_NAMESPACE,
  withoutImageDetails,
} from "@goodfellow-cms/core";
import { extensionOf, MAX_UPLOAD_BYTES, mediaKind } from "./media.js";
import { mediaType } from "./media-previews.js";

/** Photos are made no larger than this on their longest side, which is plenty for any screen. */
export const MAX_IMAGE_SIDE = 2400;

export type UploadProblem = "type" | "size" | "unreadable" | "font";

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
  // A JPEG is always kept re-saved, even a little larger, since the original holds where it was taken.
  // Other photos are kept as they were if re-saving didn't help, and lose their details another way.
  return blob && (scale < 1 || type === "image/jpeg" || blob.size < file.size) ? blob : undefined;
}

/** Whether an element can stay, once its attributes are cleaned. */
function keepsElement(element: Element): boolean {
  return (
    element.namespaceURI === SVG_NAMESPACE && keepsSvgElement(element.localName, element.getAttribute("attributeName"))
  );
}

function cleanElement(element: Element): void {
  for (const attribute of [...element.attributes]) {
    const cleaned = cleanedSvgAttribute(
      element.localName,
      attribute.name,
      attribute.localName,
      attribute.namespaceURI,
      attribute.value,
    );
    if (!cleaned.keep) element.removeAttributeNode(attribute);
    else if (cleaned.value !== attribute.value) attribute.value = cleaned.value;
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
  // Fonts are added on the Theme tab, which names them in the theme.
  if (mediaKind(file.name) === "font") {
    throw new UploadError("font", file.name, `${file.name} is a font, which is added under Colors & fonts.`);
  }

  let blob: Blob = file;
  if (extension === "svg") {
    const cleaned = cleanSvg(await file.text());
    if (cleaned === undefined) throw new UploadError("unreadable", file.name, `${file.name} isn't a valid SVG image.`);
    blob = new Blob([cleaned], { type: "image/svg+xml" });
  } else if (mediaKind(file.name) === "image") {
    blob = (await resized(file, extension)) ?? file;
    if (blob === file && (extension === "png" || extension === "webp")) {
      // Kept as it was, which keeps animations, but without the details hidden in it, such as Exif's.
      blob = new Blob([withoutImageDetails(new Uint8Array(await file.arrayBuffer())) as Uint8Array<ArrayBuffer>], {
        type: file.type,
      });
    }
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

/**
 * Changes as they're published: a file into the media library must be a kind
 * the site can use by the name it's saved under, whatever it was chosen as,
 * and an SVG keeps only what draws it (`cleanSvg()`), however it got there,
 * from an upload, a replaced file or a plugin. Throws `UploadError` for a file
 * that can't be saved there.
 */
export function safeMediaChanges(changes: readonly FileChange[]): FileChange[] {
  return changes.map((change) => {
    if (!change.path.startsWith(`${MEDIA_DIR}/`) || "delete" in change) return change;
    const name = fileName(change.path);
    if (!mediaKind(name)) throw new UploadError("type", name, `${name} isn't a kind of file the site can use.`);
    if (mediaKind(name) === "font") {
      if (!isSafeFontFile(change.path, "bytes" in change ? change.bytes : undefined)) {
        throw new UploadError("type", name, `${name} isn't a font file the site can use.`);
      }
      return change;
    }
    if (extensionOf(name) !== "svg") return change;
    const text = "bytes" in change ? new TextDecoder().decode(change.bytes) : change.content;
    const cleaned = cleanSvg(text);
    if (cleaned === undefined) throw new UploadError("unreadable", name, `${name} isn't a valid SVG image.`);
    // An SVG that's already safe, such as one put back from Version history, keeps its own spelling.
    const asWritten = new XMLSerializer().serializeToString(new DOMParser().parseFromString(text, "image/svg+xml"));
    if (cleaned === asWritten) return change;
    return { path: change.path, bytes: new TextEncoder().encode(cleaned) };
  });
}
