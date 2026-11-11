// The site's own sign-in: Better Auth, with email addresses and passwords, and two roles. Better Auth is given the
// database's dialect (lib/db/dialect.ts), never a driver, so this file is the same on every host.
import type { AppEditor } from "@goodfellow-cms/core";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth, type Where } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { dialectFor } from "./db/dialect.ts";
import { canSendEmail, passwordResetEmail, sendEmail } from "./email.ts";
import { env, inBackground, type SiteEnv } from "./env.ts";

/** How long a signed-in session is checked from its signed cookie alone, without reading the database. */
export const SESSION_CACHE_SECONDS = 5 * 60;

/** The fewest characters `BETTER_AUTH_SECRET` may have. */
export const MIN_SECRET_LENGTH = 32;

/** How many times one address may try to sign in, and in how many seconds. */
export const SIGN_IN_LIMIT = { window: 5 * 60, max: 10 };

/** How many times one network address may ask for a password reset email, and in how many seconds. */
export const RESET_LIMIT = { window: 60 * 60, max: 5 };

/**
 * How many password reset emails one account may be sent, and in how many seconds, whoever asks: the network
 * address's limit can't stop people at several addresses filling someone's inbox.
 */
export const RESET_ACCOUNT_LIMIT = { window: 60 * 60, max: 3 };

/** How long a password reset's link works, in minutes. */
export const RESET_MINUTES = 30;

/** The fewest characters a password may have. */
export const MIN_PASSWORD_LENGTH = 12;

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

/** Whether the site can send password reset emails at all: without them, asking for one says so rather than wait. */
export function canSendResets(siteEnv: SiteEnv): boolean {
  return canSendEmail(siteEnv) && Boolean(siteEnv.GOODFELLOW_SITE_URL);
}

/** The start of the identifier of Better Auth's password reset links, which invitations use too (lib/editors.ts). */
export const RESET_IDENTIFIER = "reset-password:";

/**
 * The start of the identifier of a mark that an account was sent a reset email, kept for `RESET_ACCOUNT_LIMIT`'s
 * window, apart from the links themselves, so retiring links doesn't reset the count.
 */
export const RESET_SENT_IDENTIFIER = "reset-sent:";

/**
 * Makes every link that would let someone choose a password for this account stop working, but `keep`, the
 * identifier of one just made: invitations and password resets alike, since they're the same kind of link. Other
 * verifications are kept.
 */
export async function retireResetLinks(
  adapter: { deleteMany: (data: { model: string; where: Where[] }) => Promise<number> },
  userId: string,
  keep?: string,
): Promise<void> {
  await adapter.deleteMany({
    model: "verification",
    where: [
      { field: "value", value: userId },
      { field: "identifier", operator: "starts_with", value: RESET_IDENTIFIER },
      // The link just made, which replaces the rest.
      ...(keep ? [{ field: "identifier", operator: "ne", value: keep } satisfies Where] : []),
    ],
  });
}

type AuthContext = Parameters<NonNullable<BetterAuthPlugin["init"]>>[0];

/**
 * The site's own rules for password reset links: an account is sent at most `RESET_ACCOUNT_LIMIT`'s emails, with the
 * same answer as any other, and choosing a password from any link makes the account's other links stop working, so a
 * link that went astray can't be used after the one that arrived. Where the site can't send email, asking answers `RESET_UNAVAILABLE` for every address alike.
 */
function resetLinks(siteEnv: SiteEnv) {
  let context: AuthContext | undefined;
  return {
    plugin: {
      id: "site-reset-links",
      init(authContext) {
        context = authContext;
      },
      hooks: {
        before: [
          {
            matcher: (ctx) => ctx.path === "/request-password-reset",
            handler: createAuthMiddleware(async (ctx) => {
              if (!canSendResets(siteEnv)) {
                throw APIError.from("SERVICE_UNAVAILABLE", {
                  message: "This site can't send password reset emails.",
                  code: "RESET_UNAVAILABLE",
                });
              }
              const { adapter, internalAdapter } = ctx.context;
              const now = Date.now();
              // Marks past their hour go.
              await adapter.deleteMany({
                model: "verification",
                where: [
                  { field: "identifier", operator: "starts_with", value: RESET_SENT_IDENTIFIER },
                  { field: "expiresAt", operator: "lt", value: new Date(now) },
                ],
              });
              const email = typeof ctx.body?.email === "string" ? ctx.body.email : "";
              const user = email ? await internalAdapter.findUserByEmail(email) : null;
              // Marked first and counted after, so of requests at the same moment, only those within the limit by
              // the order their marks were written can go ahead. Done for every address, so how long the answer
              // takes says little about which have accounts.
              const mark = `${RESET_SENT_IDENTIFIER}${generateRandomString(32)}`;
              await internalAdapter.createVerificationValue({
                identifier: mark,
                value: user?.user.id ?? "",
                expiresAt: new Date(now + RESET_ACCOUNT_LIMIT.window * 1000),
              });
              const sent = await adapter.count({
                model: "verification",
                where: [
                  { field: "value", value: user?.user.id ?? "" },
                  { field: "identifier", operator: "starts_with", value: RESET_SENT_IDENTIFIER },
                ],
              });
              const limited = sent > RESET_ACCOUNT_LIMIT.max;
              // A request that sends nothing leaves no mark, so asking too often doesn't keep the limit going.
              if (!user || limited) await internalAdapter.deleteVerificationByIdentifier(mark);
              if (user && limited) {
                // Better Auth's own answer, so a visitor can't tell the account was limited, or exists.
                return ctx.json({
                  status: true,
                  message: "If this email exists in our system, check your email for the reset link",
                });
              }
            }),
          },
        ],
      },
    } satisfies BetterAuthPlugin,
    async onPasswordReset({ user }: { user: { id: string } }) {
      if (context) await retireResetLinks(context.adapter, user.id);
    },
  };
}

/**
 * The paths of Better Auth's admin plugin, which only the server uses (lib/editors.ts, through `api`), never a
 * browser: those routes don't refuse an admin changing their own role, which could leave the site without one.
 */
const ADMIN_PATHS = Object.values(admin().endpoints).map((endpoint) => endpoint.path);

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
  const resets = resetLinks(siteEnv);
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
      onPasswordReset: resets.onPasswordReset,
    },
    // The server calls these through `api`, which `disabledPaths` doesn't hold; browsers get "Not Found".
    disabledPaths: ADMIN_PATHS,
    // Always on: Better Auth turns it on by itself only where NODE_ENV is "production", which Workers don't set. Kept
    // in the database, so every copy of the Worker counts the same attempts.
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: { "/sign-in/email": SIGN_IN_LIMIT, "/request-password-reset": RESET_LIMIT },
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
      resets.plugin,
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
