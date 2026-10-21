import { entryTitle, MEDIA_DIR, mediaKind, type SiteContent } from "@goodfellow-cms/core";
import { pageTitle } from "./changes.js";

export {
  ALLOWED_EXTENSIONS,
  extensionOf,
  fileName,
  MAX_UPLOAD_BYTES,
  type MediaKind,
  mediaKind,
  uploadName,
} from "@goodfellow-cms/core";

/** Files in `public/media/` are served from `/media/` on the site. */
export const MEDIA_URL_PREFIX = "/media/";

/** `public/media/photo.jpg` → `/media/photo.jpg`. */
export function mediaUrl(path: string): string {
  return `${MEDIA_URL_PREFIX}${path.slice(MEDIA_DIR.length + 1)}`;
}

/** `/media/photo.jpg` → `public/media/photo.jpg`, or `undefined` for addresses outside the media folder. */
export function mediaPath(url: string): string | undefined {
  if (!url.startsWith(MEDIA_URL_PREFIX)) return undefined;
  const rest = url.slice(MEDIA_URL_PREFIX.length).split(/[?#]/)[0] ?? "";
  if (!rest || rest.split("/").some((part) => part === "" || part === "." || part === "..")) return undefined;
  return `${MEDIA_DIR}/${decodeURIComponent(rest)}`;
}

/** A file size in words: `2.4 MB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where a media file is used, by name, so editors know what deleting or replacing it affects. */
export function mediaUsage(
  content: SiteContent,
  url: string,
  names: { header: string; footer: string; settings: string; css: string },
): string[] {
  const uses = (value: unknown) => JSON.stringify(value).includes(url);
  const used: string[] = [];
  if (uses(content.settings)) used.push(names.settings);
  if (uses(content.header)) used.push(names.header);
  if (uses(content.footer)) used.push(names.footer);
  for (const page of content.pages) if (uses(page.content)) used.push(pageTitle(page));
  for (const collection of content.collections) {
    if (uses(collection.settings)) used.push(collection.settings.name);
    for (const entry of collection.entries) if (uses(entry.content)) used.push(entryTitle(entry));
  }
  if (content.customCss.includes(url)) used.push(names.css);
  return used;
}

/** The addresses of the site's uploaded images, such as `/media/photo.jpg`. */
export function siteImages(media: string[]): string[] {
  return media.filter((path) => mediaKind(path) === "image").map(mediaUrl);
}
