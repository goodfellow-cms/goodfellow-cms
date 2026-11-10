// The site's own sign-in: Better Auth, with email addresses and passwords, and two roles. Better Auth is given the
// database's dialect (lib/db/dialect.ts), never a driver, so this file is the same on every host.
import type { AppEditor } from "@goodfellow-cms/core";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { dialectFor } from "./db/dialect.ts";
import { env, type SiteEnv } from "./env.ts";

/** How long a signed-in session is checked from its signed cookie alone, without reading the database. */
export const SESSION_CACHE_SECONDS = 5 * 60;

/** The fewest characters `BETTER_AUTH_SECRET` may have. */
export const MIN_SECRET_LENGTH = 32;

/** How many times one address may try to sign in, and in how many seconds. */
export const SIGN_IN_LIMIT = { window: 5 * 60, max: 10 };

/**
 * `BETTER_AUTH_SECRET`, which signs sessions. Without one, Better Auth falls back to a secret anyone can read in its
 * code, which would let anyone sign a session for this site, so the site refuses to sign anyone in.
 */
export function sessionSecret(siteEnv: SiteEnv): string {
  const secret = siteEnv.BETTER_AUTH_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Set BETTER_AUTH_SECRET to at least ${MIN_SECRET_LENGTH} random characters, such as \`openssl rand -base64 32\` makes.`,
    );
  }
  return secret;
}

/**
 * The site's sign-in settings, with its database: no sign-up, since an
 * admin invites people, and sessions cached in a signed cookie, which the
 * middleware reads without the database, so most requests read none.
 */
export function authOptions(database: BetterAuthOptions["database"], siteEnv: SiteEnv) {
  return {
    database,
    secret: sessionSecret(siteEnv),
    ...(siteEnv.GOODFELLOW_SITE_URL && {
      baseURL: siteEnv.GOODFELLOW_SITE_URL,
      trustedOrigins: [siteEnv.GOODFELLOW_SITE_URL],
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
    // Always on: Better Auth turns it on by itself only where NODE_ENV is "production", which Workers don't set. Kept
    // in the database, so every copy of the Worker counts the same attempts.
    rateLimit: { enabled: true, storage: "database", customRules: { "/sign-in/email": SIGN_IN_LIMIT } },
    advanced: {
      // The site's addresses end in a slash (`trailingSlash`), so its routes arrive as `/api/auth/get-session/`.
      skipTrailingSlashes: true,
      ...(siteEnv.CLIENT_IP_HEADER && { ipAddress: { ipAddressHeaders: [siteEnv.CLIENT_IP_HEADER] } }),
    },
    session: { cookieCache: { enabled: true, maxAge: SESSION_CACHE_SECONDS } },
    // `admin` people are the site's owners; everyone else an admin invites is an editor.
    plugins: [admin({ defaultRole: "editor", adminRoles: ["admin"] }), nextCookies()],
  } satisfies BetterAuthOptions;
}

function makeAuth(database: BetterAuthOptions["database"], siteEnv: SiteEnv) {
  return betterAuth(authOptions(database, siteEnv));
}

export type SiteAuth = ReturnType<typeof makeAuth>;

let instance: Promise<SiteAuth> | undefined;

/** The site's Better Auth, made the first time it's asked for, once the environment can be read. */
export function auth(): Promise<SiteAuth> {
  instance ??= (async () => {
    const siteEnv = await env();
    return makeAuth(await dialectFor(siteEnv), siteEnv);
  })();
  return instance;
}

/**
 * Who's asking the admin panel's API, as Goodfellow needs them: the site's
 * `admin` people are owners, its editors editors, `null` for nobody, and
 * `false` for someone signed in who may not edit (banned, another role, or an
 * admin acting as someone else).
 */
export async function authorize(request: Request): Promise<AppEditor | null | false> {
  return authorizeWith(await auth(), request);
}

/**
 * Whether a request comes from someone signed in, for pages only they see: their session is checked, from its signed
 * cookie for a few minutes at a time and the database after that, never only seen. `cookies` are the ones Better Auth
 * renewed or ended while checking, for the answer to pass on.
 */
export async function signedInWith(
  siteAuth: SiteAuth,
  request: Request,
): Promise<{ signedIn: boolean; cookies: string[] }> {
  const { headers, response } = await siteAuth.api.getSession({ headers: request.headers, returnHeaders: true });
  return { signedIn: Boolean(response && !response.user.banned), cookies: headers.getSetCookie() };
}

/** `authorize()` with a Better Auth of its own, as tests give it. */
export async function authorizeWith(siteAuth: SiteAuth, request: Request): Promise<AppEditor | null | false> {
  // Read from the database every time, never the session cookie's cached copy, so someone who's banned or loses
  // their role can't publish for the rest of the cache's time.
  const session = await siteAuth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session) return null;
  const { user } = session;
  if (user.banned || (user.role !== "admin" && user.role !== "editor")) return false;
  // An admin acting as someone else, with the admin plugin's impersonation, would publish in that person's name.
  if (session.session.impersonatedBy) return false;
  return {
    login: user.email,
    name: user.name,
    email: user.email,
    ...(user.image && { avatarUrl: user.image }),
    role: user.role === "admin" ? "owner" : "editor",
  };
}
