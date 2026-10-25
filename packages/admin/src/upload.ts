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

const UNSAFE_SVG_ELEMENTS = ["script", "foreignObject", "iframe", "embed", "object", "audio", "video"];

/**
 * Removes anything from an SVG that could run code if someone opens the
 * file directly: scripts, embedded pages, event handlers, and javascript:, vbscript:
 * and data: links other than images.
 */
export function cleanSvg(text: string): string | undefined {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror") || doc.documentElement.nodeName.toLowerCase() !== "svg") return undefined;
  for (const name of UNSAFE_SVG_ELEMENTS) {
    for (const element of [...doc.getElementsByTagName(name)]) element.remove();
  }
  for (const element of [doc.documentElement, ...doc.documentElement.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim().toLowerCase();
      if (
        attribute.name.toLowerCase().startsWith("on") ||
        value.startsWith("javascript:") ||
        value.startsWith("vbscript:") ||
        (value.startsWith("data:") && !value.startsWith("data:image/"))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
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
