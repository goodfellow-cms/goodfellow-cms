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
 * The PDF's address, or nothing for anything else: only the media library's
 * PDFs (on the site, or a storage plugin's `https://` address) are shown in a
 * frame, since the site's own pages of any other kind would run in it.
 */
export function documentAddress(file: string): string | undefined {
  const address = file.trim();
  if (!/\.pdf$/i.test(address.split(/[?#]/)[0] ?? "")) return undefined;
  if (address.startsWith("/media/") && !address.includes("..")) return address;
  return /^https:\/\/[^/]+\//i.test(address) ? address : undefined;
}

/** The viewer's height, in pixels. */
export function documentHeight(height: number): number {
  const value = Number(height);
  return Number.isFinite(value) && value >= 200 ? Math.min(Math.round(value), 2000) : 800;
}
