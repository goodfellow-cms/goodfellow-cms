import { type ContentStore, trimChars } from "@goodfellow-cms/core";
import { extensionOf, MEDIA_URL_PREFIX, mediaPath } from "./media.js";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  vtt: "text/vtt",
};

/** The type to show a file as, from its name. Needed so browsers display SVGs from memory. */
export function mediaType(name: string): string {
  return TYPES[extensionOf(name)] ?? "application/octet-stream";
}

/**
 * Where the admin panel shows media from. Content refers to files as
 * `/media/photo.jpg`, which only works once the site is rebuilt, and only if the
 * site is at the root of its address. Previews instead use the site's own
 * address, and for files the live site doesn't have yet (just uploaded, or
 * uploaded by someone else since the last rebuild), a copy read from the
 * repository.
 */
export interface MediaPreviews {
  /** The address to show a media file from now. Other addresses are returned as they are. */
  resolve(url: string): string;
  /** Reads a file the live site doesn't have yet from the repository, and returns an address to show it from. */
  load(url: string): Promise<string | undefined>;
  /** Shows an uploaded file from memory until the live site has it. */
  remember(url: string, bytes: Uint8Array): void;
  /** A file's bytes, from memory or the repository, for a frame to show it from: frames can't read the repository. */
  bytes(url: string): Promise<Uint8Array | undefined>;
}

export function createMediaPreviews(store: Pick<ContentStore, "readBytes">, siteUrl: string): MediaPreviews {
  const local = new Map<string, string>();
  const remembered = new Map<string, Uint8Array>();
  const loading = new Map<string, Promise<string | undefined>>();
  const base = trimChars(siteUrl, "/", { start: false });

  const remember = (url: string, bytes: Uint8Array) => {
    const previous = local.get(url);
    if (previous) URL.revokeObjectURL(previous);
    remembered.set(url, bytes);
    local.set(url, URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType(url) })));
  };

  return {
    resolve(url) {
      if (!url.startsWith(MEDIA_URL_PREFIX)) return url;
      return local.get(url) ?? `${base}${url}`;
    },
    remember,
    async bytes(url) {
      const known = remembered.get(url);
      if (known) return known;
      const path = mediaPath(url);
      return path ? await store.readBytes(path).catch(() => undefined) : undefined;
    },
    load(url) {
      const known = local.get(url);
      if (known) return Promise.resolve(known);
      const path = mediaPath(url);
      if (!path) return Promise.resolve(undefined);
      let pending = loading.get(url);
      if (!pending) {
        pending = store
          .readBytes(path)
          .then((bytes) => {
            if (!bytes) return undefined;
            remember(url, bytes);
            return local.get(url);
          })
          .catch(() => undefined);
        loading.set(url, pending);
      }
      return pending;
    },
  };
}

const URL_ATTRIBUTES = ["src", "href", "poster"];
const MEDIA_IN_STYLE = /url\((['"]?)(\/media\/[^'")]+)\1\)/g;

/**
 * Keeps media in a preview document showing: rewrites `/media/…` addresses in
 * images, links and inline styles as the preview changes, and if an image
 * still doesn't load, reads it from the repository instead.
 */
export function showMediaInPreview(doc: Document, previews: MediaPreviews): () => void {
  const fix = (element: Element) => {
    for (const attribute of URL_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (!value?.startsWith(MEDIA_URL_PREFIX)) continue;
      const resolved = previews.resolve(value);
      if (resolved !== value) {
        element.setAttribute(`data-gf-${attribute}`, value);
        element.setAttribute(attribute, resolved);
      }
    }
    const style = element.getAttribute("style");
    if (style?.includes(MEDIA_URL_PREFIX)) {
      const resolved = style.replace(
        MEDIA_IN_STYLE,
        (_match, quote: string, url: string) => `url(${quote}${previews.resolve(url)}${quote})`,
      );
      if (resolved !== style) element.setAttribute("style", resolved);
    }
  };
  const fixTree = (root: Element) => {
    fix(root);
    for (const element of root.querySelectorAll("[src], [href], [poster], [style]")) fix(element);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target.nodeType === 1) fix(record.target as Element);
      for (const node of record.addedNodes) if (node.nodeType === 1) fixTree(node as Element);
    }
  });
  observer.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [...URL_ATTRIBUTES, "style"],
  });
  fixTree(doc.documentElement);

  // Images the live site doesn't have yet fail to load: show them from the repository instead.
  const onError = (event: Event) => {
    const image = event.target as Element | null;
    if (image?.tagName !== "IMG") return;
    const original = image.getAttribute("data-gf-src") ?? image.getAttribute("src") ?? "";
    if (!original.startsWith(MEDIA_URL_PREFIX) || image.hasAttribute("data-gf-loaded")) return;
    image.setAttribute("data-gf-loaded", "");
    void previews.load(original).then((url) => {
      if (url) {
        image.setAttribute("data-gf-src", original);
        image.setAttribute("src", url);
      }
    });
  };
  doc.addEventListener("error", onError, true);

  return () => {
    observer.disconnect();
    doc.removeEventListener("error", onError, true);
  };
}
