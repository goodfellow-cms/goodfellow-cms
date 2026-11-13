/**
 * Where to go after signing in or up: `next` from the address, if it's on this site, or the home page. It's read as
 * the browser would read it, so spellings such as `/\other.example` that leave the site are refused.
 */
export function nextPath(): string {
  const next = new URLSearchParams(location.search).get("next") ?? "/";
  try {
    const target = new URL(next, location.origin);
    return target.origin === location.origin ? `${target.pathname}${target.search}${target.hash}` : "/";
  } catch {
    return "/";
  }
}
