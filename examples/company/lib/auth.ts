// The site's own sign-in: Better Auth, with email addresses and passwords, and two roles. Better Auth is given the
// database's dialect (lib/db/dialect.ts), never a driver, so this file is the same on every host.
import type { AppEditor } from "@goodfellow-cms/core";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { twoFactor } from "better-auth/plugins/two-factor";
import { dialectFor } from "./db/dialect.ts";
import { passwordResetEmail, sendEmail } from "./email.ts";
import { env, inBackground, type SiteEnv } from "./env.ts";

/** How long a signed-in session is checked from its signed cookie alone, without reading the database. */
export const SESSION_CACHE_SECONDS = 5 * 60;

/** The fewest characters `BETTER_AUTH_SECRET` may have. */
export const MIN_SECRET_LENGTH = 32;

/** How many times one address may try to sign in, and in how many seconds. */
export const SIGN_IN_LIMIT = { window: 5 * 60, max: 10 };

/**
 * How many times one address may try a two-factor code, or turn it on or off, and in how many seconds: the same as
 * signing in, in place of the plugin's three every ten seconds, which a wrong code and then the right one could use
 * up, as could an office's editors signing in from one address. Ten wrong codes lock the account's codes for a while
 * whatever the address.
 */
export const TWO_FACTOR_LIMIT = SIGN_IN_LIMIT;

/** How many times one address may ask for a password reset email, and in how many seconds. */
export const RESET_LIMIT = { window: 60 * 60, max: 5 };

/** How long a password reset's link works, in minutes. */
export const RESET_MINUTES = 30;

/** The fewest characters a password may have. */
export const MIN_PASSWORD_LENGTH = 12;

/** What authenticator apps call the site's accounts: its address's host, which only its developers can change. */
export function issuerOf(siteEnv: SiteEnv): string {
  return siteEnv.GOODFELLOW_SITE_URL ? new URL(siteEnv.GOODFELLOW_SITE_URL).host : "Goodfellow site";
}

/**
 * Sends someone who forgot their password a link to choose a new one, at the site's own address, never the
 * request's. Better Auth asks for it for any address, and answers the same whether or not it has an account, so this
 * never fails where the visitor could see it: the email goes after the answer, and a failure is logged without it.
 */
function sendReset(siteEnv: SiteEnv) {
  return async ({ user, token }: { user: { email: string; name: string }; token: string }) => {
    const siteUrl = siteEnv.GOODFELLOW_SITE_URL;
    if (!siteUrl) return console.error("Set GOODFELLOW_SITE_URL so password reset emails can link to the site.");
    const link = new URL("/reset-password/", siteUrl);
    link.searchParams.set("token", token);
    const email = passwordResetEmail({
      to: user.email,
      name: user.name,
      siteUrl,
      link: link.href,
      minutes: RESET_MINUTES,
    });
    inBackground(
      sendEmail(siteEnv, email).catch((error: unknown) =>
        console.error(`A password reset email wasn't sent: ${error instanceof Error ? error.name : "error"}.`),
      ),
    );
  };
}

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
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      // Invitations use the same links (lib/editors.ts), with a longer life of their own.
      sendResetPassword: sendReset(siteEnv),
      resetPasswordTokenExpiresIn: RESET_MINUTES * 60,
      revokeSessionsOnPasswordReset: true,
    },
    // Always on: Better Auth turns it on by itself only where NODE_ENV is "production", which Workers don't set. Kept
    // in the database, so every copy of the Worker counts the same attempts.
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": SIGN_IN_LIMIT,
        "/two-factor/*": TWO_FACTOR_LIMIT,
        "/request-password-reset": RESET_LIMIT,
      },
    },
    advanced: {
      // The site's addresses end in a slash (`trailingSlash`), so its routes arrive as `/api/auth/get-session/`.
      skipTrailingSlashes: true,
      ...(siteEnv.CLIENT_IP_HEADER && { ipAddress: { ipAddressHeaders: [siteEnv.CLIENT_IP_HEADER] } }),
    },
    session: { cookieCache: { enabled: true, maxAge: SESSION_CACHE_SECONDS } },
    // The site's two roles, so the admin plugin refuses any other: `admin`, the site's owners, and `editor`, which
    // everyone else an admin invites is.
    plugins: [
      admin({ defaultRole: "editor", adminRoles: ["admin"], roles: { admin: adminAc, editor: userAc } }),
      // A code from an authenticator app, or a backup code, after the password, for people who turn it on at
      // /account/, which admins must before they can act as owners (`authorizeWith()`). Better Auth limits tries
      // (`TWO_FACTOR_LIMIT`, and the account's codes are locked for a while after ten wrong ones) and keeps
      // each secret, and the backup codes, encrypted with BETTER_AUTH_SECRET. Turning it on asks for the password
      // again.
      twoFactor({ issuer: issuerOf(siteEnv), backupCodeOptions: { storeBackupCodes: "encrypted" } }),
      nextCookies(),
    ],
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

/** Where Better Auth's routes are, under the site's address. */
const AUTH_PATH = "/api/auth/";

/**
 * Whether an address's path is one of the admin plugin's routes, however it's spelled: decoded, with repeated
 * slashes as one, in any letter case, since a router could read any of those as the route.
 */
export function isAdminPluginPath(pathname: string): boolean {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    // Not valid percent-encoding: no router reads it as a route.
  }
  path = path.replace(/\/{2,}/g, "/").toLowerCase();
  return path === `${AUTH_PATH}admin` || path.startsWith(`${AUTH_PATH}admin/`);
}

/**
 * Better Auth's routes, as the site answers them, without the admin plugin's: the site manages people only through
 * the editors page's API (lib/editors.ts), which calls the plugin on the server, where its own rules hold (an admin
 * needs two-factor sign-in, can't change themselves, and impersonates nobody). The plugin's routes would let an admin
 * with only a password do all of that from the browser.
 */
export async function authRoute(siteAuth: SiteAuth, request: Request): Promise<Response> {
  if (isAdminPluginPath(new URL(request.url).pathname)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  return siteAuth.handler(request);
}

/**
 * Who's asking the admin panel's API, as Goodfellow needs them: the site's
 * `admin` people with two-factor sign-in are owners, its editors and admins
 * without it editors, `null` for nobody, and `false` for someone signed in who
 * may not edit (banned, another role, or an admin acting as someone else).
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
    // A password alone never makes anyone an owner, who can change the site's settings and its editors.
    role: isOwner(user) ? "owner" : "editor",
  };
}

/** Whether someone may act as one of the site's owners: an admin who has turned on two-factor sign-in. */
export function isOwner(user: { role?: string | null; twoFactorEnabled?: boolean | null }): boolean {
  return user.role === "admin" && user.twoFactorEnabled === true;
}
