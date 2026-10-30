// What the Document viewer shows, with no React, so its web and native versions share it.

export interface DocumentProps {
  /** A PDF from the media library, such as `/media/bulletin.pdf`. */
  file: string;
  /** What the document is, for screen readers; its file name without it. */
  title: string;
  /** How tall the viewer is, in pixels. */
  height: number;
  linkLabel: string;
  className: string;
}

/**
 * The PDF's address, or nothing for anything else: the media library's PDFs,
 * on the site or a storage plugin's `https://` address, and other sites'.
 */
export function documentAddress(file: string): string | undefined {
  const address = file.trim();
  if (!/\.pdf$/i.test(address.split(/[?#]/)[0] ?? "")) return undefined;
  if (address.startsWith("/media/") && !address.includes("..")) return address;
  return /^https:\/\/[^/]+\//i.test(address) ? address : undefined;
}

/**
 * Whether a PDF's address is the media library's, which the page shows in a
 * frame: on the site, or where the site's media storage keeps it (`storage`,
 * its files' public address). Browsers won't show a PDF in a sandboxed frame,
 * and another site could answer for a `.pdf` address with a page, so other
 * sites' PDFs are only linked.
 */
export function isFramedDocument(address: string, storage: string | undefined): boolean {
  if (address.startsWith("/media/")) return true;
  if (!storage) return false;
  const prefix = storage.replace(/\/*$/, "/");
  return address.startsWith(prefix) && !address.slice(prefix.length).split(/[?#]/)[0]?.split("/").includes("..");
}

/** The viewer's height, in pixels. */
export function documentHeight(height: number): number {
  const value = Number(height);
  return Number.isFinite(value) && value >= 200 ? Math.min(Math.round(value), 2000) : 800;
}
