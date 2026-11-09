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

/**
 * The site's sign-in settings, with its database: no sign-up, since an
 * admin invites people, and sessions cached in a signed cookie, which the
 * middleware reads without the database, so most requests read none.
 */
export function authOptions(database: BetterAuthOptions["database"], siteEnv: SiteEnv) {
  return {
    database,
    ...(siteEnv.BETTER_AUTH_SECRET && { secret: siteEnv.BETTER_AUTH_SECRET }),
    ...(siteEnv.GOODFELLOW_SITE_URL && {
      baseURL: siteEnv.GOODFELLOW_SITE_URL,
      trustedOrigins: [siteEnv.GOODFELLOW_SITE_URL],
    }),
    emailAndPassword: { enabled: true, disableSignUp: true },
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
 * `false` for someone signed in who may not edit (banned, or another role).
 */
export async function authorize(request: Request): Promise<AppEditor | null | false> {
  return authorizeWith(await auth(), request);
}

/** `authorize()` with a Better Auth of its own, as tests give it. */
export async function authorizeWith(siteAuth: SiteAuth, request: Request): Promise<AppEditor | null | false> {
  const session = await siteAuth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const { user } = session;
  if (user.banned || (user.role !== "admin" && user.role !== "editor")) return false;
  return {
    login: user.email,
    name: user.name,
    email: user.email,
    ...(user.image && { avatarUrl: user.image }),
    role: user.role === "admin" ? "owner" : "editor",
  };
}
