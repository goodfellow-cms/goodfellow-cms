/** The kinds of media file a site can have, and the names uploads are saved under. */
import { slugify, uniqueName } from "./changes.js";

export type MediaKind = "image" | "document" | "audio" | "video";

/** The kinds of file that can be uploaded, by extension. Pages, scripts and other files that could run code aren't allowed. */
const KINDS: Record<string, MediaKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  svg: "image",
  ico: "image",
  pdf: "document",
  txt: "document",
  csv: "document",
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  odt: "document",
  ods: "document",
  odp: "document",
  mp3: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  // Captions and subtitles for videos.
  vtt: "document",
};

export const ALLOWED_EXTENSIONS = Object.keys(KINDS);

/** The largest file that can be uploaded, after large photos are made smaller. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** What kind of file a name or address is, or `undefined` if it can't be uploaded. */
export function mediaKind(name: string): MediaKind | undefined {
  return KINDS[extensionOf(name)];
}

/** The file's name, without its folder: `public/media/photo.jpg` → `photo.jpg`. */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * The name an upload is saved under: lowercase, with hyphens, and not one
 * that's already taken. `Easter Vigil (1).JPEG` → `easter-vigil-1.jpg`.
 */
export function uploadName(original: string, taken: Iterable<string>): string {
  const extension = extensionOf(original).replace(/^jpeg$/, "jpg");
  const base = slugify(original.slice(0, original.length - extensionOf(original).length - 1) || original) || "file";
  const names = new Set([...taken].map((name) => name.toLowerCase()));
  const stems = new Set(
    [...names].filter((name) => name.endsWith(`.${extension}`)).map((name) => name.slice(0, -extension.length - 1)),
  );
  return `${uniqueName(base, stems)}.${extension}`;
}
