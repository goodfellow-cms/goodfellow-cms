import { sitePath } from "@/lib/site-path";

/** Where to go after signing in or up: `next` from the address, if it's a page of this site (`sitePath()`), or `fallback`. */
export function nextPath(fallback = "/"): string {
  return sitePath(new URLSearchParams(location.search).get("next"), fallback);
}
