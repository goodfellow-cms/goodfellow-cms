// Where the site may send someone it's told to send on, such as after signing in: one helper, which the browser's
// pages and the server both use, so the two can't come to read an address differently. No imports, since it runs in
// both.

/**
 * `value` as a path on this site, with its query and fragment, or `fallback` (the home page) where it isn't one. It's
 * read as a browser reads it, so spellings that leave the site (`//other.example`, `/\other.example`, `javascript:`,
 * any full address) give `fallback` instead.
 */
export function sitePath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  try {
    const target = new URL(value, "https://site.invalid");
    return target.origin === "https://site.invalid" ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch {
    return fallback;
  }
}
