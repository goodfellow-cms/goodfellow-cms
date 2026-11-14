// Which version of a page a request gets: everyone's, where members-only pages are teasers, or the members' version,
// in full. Both are rendered ahead and cached, so the choice is all a request costs (proxy.ts). It's made from a
// cookie this file signs, saying whether the person subscribes, so most requests read no database: only someone
// signed in whose cookie is missing or has run out is looked up, and then not again for `PAYWALL_SECONDS`.
import { getSessionCookie, parseCookies } from "better-auth/cookies";
import type { SiteAuth } from "./auth.ts";
import { subscribedUntil } from "./entitlements.ts";
import { PAYWALL_SECONDS } from "./paywall-time.ts";

/** The cookie that says which version of members-only pages someone gets. */
export const PAYWALL_COOKIE = "paywall";

export { PAYWALL_SECONDS } from "./paywall-time.ts";

/**
 * Where the members' versions of pages are, which only proxy.ts sends requests to: a request for an address here
 * itself is answered "Page not found", since only the cookie says who may see them.
 */
export const MEMBERS_VERSION_PATH = "/members/pages";

/** Who a request is answered for. */
export type Reader = "everyone" | "members";

/** What a cookie's value is signed with, apart from anything else `BETTER_AUTH_SECRET` signs. */
const PURPOSE = "goodfellow-company paywall 1";

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer): string {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  // A length base64 can't have, such as 4n + 1, makes atob throw: a damaged cookie is ignored, never an error.
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** The session the cookie belongs to, by a hash of its token, so it says nothing about anyone signed in since. */
async function sessionHash(token: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

/** A cookie's value: who it's for, until when (milliseconds since 1970), for which session, signed. */
export async function sealReader(secret: string, reader: Reader, until: number, token: string): Promise<string> {
  const body = `${reader === "members" ? "m" : "e"}.${until}.${await sessionHash(token)}`;
  const mac = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(`${PURPOSE}.${body}`));
  return `${body}.${base64url(mac)}`;
}

/** Who a cookie's value says a request is for, where it's signed, still current, and for this session. */
export async function openReader(
  secret: string,
  value: string,
  token: string,
  now: number,
): Promise<Reader | undefined> {
  const parts = value.split(".");
  if (parts.length !== 4) return undefined;
  const [who, until, session, mac] = parts as [string, string, string, string];
  const signature = fromBase64url(mac);
  if (!signature || (who !== "m" && who !== "e") || !/^\d{1,15}$/.test(until)) return undefined;
  const body = `${who}.${until}.${session}`;
  const signed = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    signature,
    encoder.encode(`${PURPOSE}.${body}`),
  );
  if (!signed || Number(until) <= now || session !== (await sessionHash(token))) return undefined;
  return who === "m" ? "members" : "everyone";
}

/** One cookie of the request's `cookie` header, read as Better Auth reads its own. */
function requestCookie(request: Request, name: string): string | undefined {
  return parseCookies(request.headers.get("cookie") ?? "").get(name);
}

function cookieHeader(request: Request, value: string, seconds: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${PAYWALL_COOKIE}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax${secure}`;
}

/**
 * The `set-cookie` header that forgets which version of members-only pages someone gets, so the next page they open
 * asks the database again: after they've just paid (lib/stripe.ts), rather than wait out `PAYWALL_SECONDS`.
 */
export function forgetReader(request: Request): string {
  return cookieHeader(request, "", 0);
}

/** What deciding who a request is for needs, loaded only for someone signed in. */
export interface PaywallSettings {
  siteAuth: SiteAuth;
  /** `BETTER_AUTH_SECRET`, which the cookie is signed with. */
  secret: string;
}

/**
 * Who `request` is answered for, and the cookies to send with the answer: the paywall cookie when it's set again or
 * cleared, and any Better Auth renewed or ended while it was asked. Nobody signed in is answered for everyone, without
 * `settings` or the database.
 */
export async function readerFor(
  request: Request,
  settings: () => Promise<PaywallSettings>,
  now = Date.now(),
): Promise<{ reader: Reader; cookies: string[] }> {
  const kept = requestCookie(request, PAYWALL_COOKIE);
  const token = getSessionCookie(request);
  if (!token) return { reader: "everyone", cookies: kept === undefined ? [] : [cookieHeader(request, "", 0)] };
  const { siteAuth, secret } = await settings();
  const known = kept === undefined ? undefined : await openReader(secret, kept, token, now);
  if (known) return { reader: known, cookies: [] };

  const { headers, response: session } = await siteAuth.api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
    returnHeaders: true,
  });
  const cookies = headers.getSetCookie();
  let reader: Reader = "everyone";
  let until = now + PAYWALL_SECONDS * 1000;
  if (session && !session.user.banned) {
    const subscribed = await subscribedUntil((await siteAuth.$context).adapter, session.user.id, new Date(now));
    if (subscribed !== undefined) {
      reader = "members";
      if (subscribed) until = Math.min(until, subscribed.getTime());
    }
  }
  const value = await sealReader(secret, reader, until, token);
  cookies.push(cookieHeader(request, value, Math.max(1, Math.ceil((until - now) / 1000))));
  return { reader, cookies };
}

/**
 * The app's own routes, in app/, which have no members' version: a test keeps it the same as app/'s folders, so a
 * route added there isn't sent to a members' version that doesn't exist.
 */
export const APP_ROUTES = [
  "accept-invite",
  "account",
  "admin",
  "api",
  "reset-password",
  "sign-in",
  "sign-out",
  "sign-up",
] as const;

/** What isn't a page, by its first segment: the app's routes and the folders of built files and media. */
const NOT_PAGES = new Set<string>([
  ...APP_ROUTES,
  "_next",
  "members",
  "media",
  "media-sizes",
  "fonts",
  "pagefind",
  "feeds",
  "calendars",
]);

/**
 * Whether a request is for one of the site's pages, which have a members' version, rather than a file or a route,
 * by its `routedPath()`.
 */
export function isPageRequest(method: string, path: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const first = path.split("/", 2)[1] ?? "";
  if (NOT_PAGES.has(first)) return false;
  // Files, such as /robots.txt or /goodfellow-site.json, have a dot in their last segment; pages don't. Read by
  // position, not a pattern, which a long address of dots would make slow.
  return !path.slice(path.lastIndexOf("/") + 1).includes(".");
}

/**
 * A request's address as the router reads it, so no other spelling of an address gets past a check on it: escapes
 * such as `%70` for `p` undone, letters in lowercase, and repeated slashes as one. `undefined` for an address whose
 * escapes can't be read.
 */
export function routedPath(pathname: string): string | undefined {
  let path = pathname;
  // Each round undoes one layer of escapes, until none are left to undo.
  for (let round = 0; round < 5; round++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return undefined;
    }
    if (decoded === path) break;
    path = decoded;
  }
  return path.replace(/[\\/]+/g, "/").toLowerCase();
}

/** Whether a request asks for a members' version itself, by its `routedPath()`, which only proxy.ts may send to. */
export function isMembersVersion(path: string): boolean {
  return path === MEMBERS_VERSION_PATH || path.startsWith(`${MEMBERS_VERSION_PATH}/`);
}

/** Where proxy.ts sends a member's request for `url`'s page: its members' version, with the same query. */
export function membersVersionUrl(url: URL): URL {
  const target = new URL(url);
  target.pathname = `${MEMBERS_VERSION_PATH}${url.pathname}`;
  return target;
}
