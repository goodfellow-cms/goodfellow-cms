// Where the site may send someone it's told to send on, such as after signing in: one helper, which the browser's
// pages and the server both use, so the two can't come to read an address differently. No imports, since it runs in
// both.

/**
 * `value` as a path on this site, with its query and fragment, or `fallback` (the home page) where it isn't one. It's
 * read as a browser reads it, so spellings that leave the site (`//other.example`, `/\other.example`, `/.//other.example`,
 * `javascript:`, any full address) give `fallback` instead.
 */
export function sitePath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback;
  try {
    const target = new URL(value, "https://site.invalid");
    // A path that comes out starting with two slashes, such as `/.//other.example`'s, would be another site's
    // address wherever the result is used as one.
    if (target.origin !== "https://site.invalid" || target.pathname.startsWith("//")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
