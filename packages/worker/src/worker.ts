/**
 * Goodfellow's sign-in worker: editors sign in with GitHub, and the admin
 * panel gets a token for one repository, with only the permissions it needs,
 * lasting an hour. It stores nothing: the person's own GitHub token is revoked
 * as soon as they've signed in, and the session the browser keeps says only
 * who they are and which site it's for, sealed so it can't be changed.
 *
 * The admin panel asks:
 * 1. `GET /github/check`: can this page sign in here at all?
 * 2. `GET /github/start`: sends the person to GitHub, which comes back to
 *    `/github/callback`, which goes back to the admin panel with a grant. With
 *    `install=1`, GitHub's page installs Goodfellow first, and signs them in too.
 * 3. `POST /github/session`: the grant and the PKCE verifier only that tab
 *    knows, for a session and the first token.
 * 4. `POST /github/token`: the session, for a new token, about once an hour,
 *    checking the person still edits the site each time.
 *
 * Where a site keeps its content in a repository of its own, both ask with
 * `code`, its code repository, and get a second token for it too, which can
 * only read it and its workflow runs, or for an owner, run them: once the
 * code's `goodfellow.config.tsx` names the site's repository, and GitHub says
 * the person can see the code repository (or for an owner, publish to it).
 *
 * The site setup page signs in the same way, with `/github/setup/*` creating
 * the repository. Creating it needs the person's own token, so the setup
 * page's session keeps it, sealed, until the repository exists (both, for a
 * site whose content has a repository of its own) or half an hour has passed,
 * whichever is first; then it's revoked.
 */

import githubAppJwt from "universal-github-app-jwt";
import {
  type App,
  type GitHubConfig,
  GitHubError,
  github,
  githubJson,
  installationToken,
  type Permissions,
  repoPath,
  revokeUserToken,
  type UserTokens,
  userTokens,
} from "./github.js";
import { base64UrlEncode, challengeFor, createSealer, type Sealer } from "./seal.js";

export interface WorkerEnv {
  /** For GitHub Enterprise and tests. Defaults to `https://api.github.com`. */
  GITHUB_API?: string;
  /** For GitHub Enterprise and tests. Defaults to `https://github.com`. */
  GITHUB_WEB?: string;
  /** The everyday app, which editors sign in with: Contents, Deployments, Actions (read) and Pages (read). */
  EDIT_APP_ID?: string;
  EDIT_APP_SLUG?: string;
  EDIT_CLIENT_ID?: string;
  EDIT_CLIENT_SECRET?: string;
  EDIT_PRIVATE_KEY?: string;
  /** The owners' app: Administration, Pages, Actions, Contents, Workflows and Secrets, for the Editors and Domain screens and creating sites. */
  OWNER_APP_ID?: string;
  OWNER_APP_SLUG?: string;
  OWNER_CLIENT_ID?: string;
  OWNER_CLIENT_SECRET?: string;
  OWNER_PRIVATE_KEY?: string;
  /** 32 random bytes, base64-encoded, which seal sessions. Changing it signs everyone out. */
  SESSION_KEY?: string;
  /** Addresses of setup pages allowed to create sites, separated by commas, such as `https://goodfellow-cms.github.io`. */
  SETUP_ORIGINS?: string;
  /**
   * The only addresses tokens may go to, separated by commas, such as
   * `https://example.org,https://admin.example.org`. Where it's set, an address
   * the site's files name gets tokens only if it's listed here too, since
   * editors can change those files; owners' sign-ins to listed addresses also
   * skip the page that asks first.
   */
  ALLOWED_ORIGINS?: string;
}

export interface WorkerOptions {
  /** For tests: where requests to GitHub go. */
  fetch?: typeof fetch;
  now?: () => number;
}

type Purpose = "edit" | "owner" | "setup";

/** Why the worker can't help, which the admin panel turns into plain words. */
export type SignInProblem =
  | "not-installed"
  | "no-address"
  | "wrong-address"
  | "local-address"
  | "no-access"
  | "cant-publish"
  | "not-owner"
  | "invalid"
  | "cancelled"
  | "unavailable"
  | "bad-request"
  | "name-taken"
  | "name-invalid"
  | "not-allowed";

/**
 * What each kind of sign-in's tokens may do. Editors' tokens can't change
 * workflows or the repository's settings. Checks and Commit statuses show
 * when Cloudflare Pages has built the site.
 */
export const PERMISSIONS: Record<Purpose, Permissions> = {
  edit: {
    contents: "write",
    // Submitting a draft for review opens a pull request.
    pull_requests: "write",
    metadata: "read",
    deployments: "read",
    actions: "read",
    pages: "read",
    checks: "read",
    statuses: "read",
  },
  owner: {
    administration: "write",
    pages: "write",
    actions: "write",
    // The nightly build setting, a repository variable the site's workflow reads.
    variables: "write",
    contents: "read",
    metadata: "read",
  },
  setup: {
    administration: "write",
    contents: "write",
    workflows: "write",
    pages: "write",
    secrets: "write",
    metadata: "read",
  },
};

/**
 * Permissions added since the apps were first set up, which installations
 * accept only when someone approves them on GitHub. Until then, tokens are
 * made without them, and the admin panel does without what they're for.
 */
export const LATER_PERMISSIONS: Partial<Record<Purpose, string[]>> = {
  edit: ["checks", "statuses", "pull_requests"],
  owner: ["variables"],
  setup: ["secrets"],
};

/** `permissions` without those an installation may not have accepted yet. */
function withoutLater(purpose: Purpose, permissions: Permissions): Permissions {
  const later = new Set(LATER_PERMISSIONS[purpose] ?? []);
  return Object.fromEntries(Object.entries(permissions).filter(([name]) => !later.has(name)));
}

/**
 * What tokens for a site's code repository may do, where its content is kept
 * in a repository of its own: read its updates' runs and its files, and for
 * owners, run its update workflow. Never change its code.
 */
export const CODE_PERMISSIONS: Record<"edit" | "owner", Permissions> = {
  edit: { actions: "read", contents: "read", metadata: "read" },
  owner: { actions: "write", contents: "read", metadata: "read" },
};

/** The file a site's code repository names its content repository in. */
const CONFIG_FILE = "goodfellow.config.tsx";

const STATE_LIFETIME = 10 * 60_000;
const GRANT_LIFETIME = 5 * 60_000;
const SESSION_LIFETIME = 12 * 3_600_000;
const REMEMBERED_SESSION_LIFETIME = 30 * 24 * 3_600_000;
/** The setup page's session, which holds the person's own token, lasts only as long as creating a site takes. */
const SETUP_SESSION_LIFETIME = 30 * 60_000;

/** The person signed in, as the admin panel shows them and commits name them. */
export interface SignedInUser {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
  /** GitHub's private address for them, so commits link to their account without showing their email. */
  email: string;
}

interface StateData {
  purpose: Purpose;
  repo?: string;
  return: string;
  challenge: string;
  remember: boolean;
  /** Sent to GitHub's install page first, so the return address can only be checked once it's back. */
  install?: boolean;
}

interface SessionData {
  purpose: Purpose;
  repo?: string;
  /** When the person signed in, after which the session lasts no longer than its lifetime, however often it's used. */
  signedInAt?: number;
  /** The only address the session's tokens go to. */
  origin: string;
  remember: boolean;
  user: SignedInUser;
  /** The person's own GitHub token: only in the setup page's session, which needs it to create the repository. */
  tokens?: UserTokens;
}

interface GrantData extends SessionData {
  challenge: string;
}

class Problem extends Error {
  constructor(
    readonly problem: SignInProblem,
    readonly status: number,
    readonly extra: Record<string, string> = {},
  ) {
    super(problem);
  }
}

const REPO = /^[\w.-]+\/[\w.-]+$/;
const CHALLENGE = /^[\w-]{43}$/;

/** Addresses on the computer itself: tokens are never given to them, since `goodfellow dev` and `next dev` don't need one. */
export function isLocalAddress(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

function originOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

/** The person as the admin panel sees them: GitHub's id isn't needed there. */
function publicUser({ login, name, avatarUrl, email }: SignedInUser) {
  return { login, name, avatarUrl, email };
}

const PAGE_MESSAGES: Partial<Record<SignInProblem, string>> = {
  "not-installed":
    "Goodfellow isn't installed on the site's repository, perhaps because another was chosen. Go back to the admin panel and install it again, choosing the site.",
  "no-address":
    "The site's settings don't have its address yet, so signing in with GitHub can't check where to come back to.",
  "wrong-address": "This isn't the address the site's settings list, so signing in with GitHub can't come back here.",
  "local-address":
    "Signing in with GitHub works only on the published site. Sign in with an access token here instead.",
  invalid: "Signing in took too long. Go back and try again.",
  "bad-request": "This sign-in link isn't complete. Go back and try again.",
  unavailable: "Signing in with GitHub isn't working right now. Go back and sign in with an access token instead.",
};

function page(problem: SignInProblem, status = 400): Response {
  const message = PAGE_MESSAGES[problem] ?? PAGE_MESSAGES.unavailable;
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Couldn't sign in</title><main style="font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem"><h1>Couldn't sign in</h1><p>${message}</p></main></html>`,
    { status, headers: PAGE_HEADERS },
  );
}

/** Headers for the worker's own pages, which nothing may show in a frame. */
const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

/** The cookie that shows an owner's sign-in was continued from the worker's own page, in the same browser. */
const CONFIRM_COOKIE = "__Host-goodfellow_confirm";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * The page an owner's sign-in shows before going to GitHub, which may sign
 * them in without asking: an editor can change the addresses the site's files
 * name, so the owner sees where the token would go, and continues only from
 * here, with a cookie a link from elsewhere can't set.
 */
function confirmPage(url: URL, repo: string, origin: string, nonce: string): Response {
  const next = new URL(url);
  next.searchParams.set("confirm", nonce);
  const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in as an owner?</title><main style="font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 1rem"><h1>Sign in as an owner?</h1><p>You're signing in with GitHub as an owner of <strong>${escapeHtml(repo)}</strong>, so the admin panel at <strong>${escapeHtml(origin)}</strong> can manage the site's editors, domain and updates.</p><p>Only continue if you opened the admin panel at that address yourself. If a link brought you here, close this page.</p><p><a href="${escapeHtml(next.href)}" style="display: inline-block; padding: 0.5rem 1rem; border-radius: 0.375rem; background: #1f2937; color: #fff; text-decoration: none">Continue to GitHub</a></p></main></html>`;
  return new Response(body, {
    status: 200,
    headers: {
      ...PAGE_HEADERS,
      "set-cookie": `${CONFIRM_COOKIE}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600`,
    },
  });
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export function createWorker(options: WorkerOptions = {}) {
  const now = options.now ?? Date.now;
  const sealers = new Map<string, Promise<Sealer>>();
  const installations = new Map<string, { id: number | undefined; at: number }>();

  async function handle(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get("origin") ?? undefined;
    const cors = {
      "access-control-allow-origin": requestOrigin ?? "*",
      "access-control-allow-methods": "GET, POST",
      "access-control-allow-headers": "content-type",
      vary: "origin",
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
      });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const config: GitHubConfig = {
      api: (env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, ""),
      web: (env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, ""),
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    };
    const origins = (list: string | undefined) =>
      (list ?? "")
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
    const setupOrigins = origins(env.SETUP_ORIGINS);
    const allowedOrigins = origins(env.ALLOWED_ORIGINS);

    const apps: Partial<Record<"edit" | "owner", App>> = {};
    if (env.EDIT_APP_ID && env.EDIT_CLIENT_ID && env.EDIT_CLIENT_SECRET && env.EDIT_PRIVATE_KEY) {
      apps.edit = {
        id: env.EDIT_APP_ID,
        slug: env.EDIT_APP_SLUG ?? "",
        clientId: env.EDIT_CLIENT_ID,
        clientSecret: env.EDIT_CLIENT_SECRET,
        privateKey: env.EDIT_PRIVATE_KEY,
      };
    }
    if (env.OWNER_APP_ID && env.OWNER_CLIENT_ID && env.OWNER_CLIENT_SECRET && env.OWNER_PRIVATE_KEY) {
      apps.owner = {
        id: env.OWNER_APP_ID,
        slug: env.OWNER_APP_SLUG ?? "",
        clientId: env.OWNER_CLIENT_ID,
        clientSecret: env.OWNER_CLIENT_SECRET,
        privateKey: env.OWNER_PRIVATE_KEY,
      };
    }

    function appFor(purpose: Purpose): App {
      const app = purpose === "edit" ? apps.edit : apps.owner;
      if (!app) throw new Problem("unavailable", 503);
      return app;
    }

    function installUrl(app: App): string {
      return `${config.web}/apps/${encodeURIComponent(app.slug)}/installations/new`;
    }

    /** A token for calling GitHub as the app itself, such as to make installation tokens. */
    async function jwtFor(app: App): Promise<string> {
      return (await githubAppJwt({ id: app.id, privateKey: app.privateKey, now: Math.floor(now() / 1000) })).token;
    }

    function sealer(): Promise<Sealer> {
      const key = env.SESSION_KEY ?? "";
      let found = sealers.get(key);
      if (!found) {
        found = createSealer(key, now);
        found.catch(() => sealers.delete(key));
        sealers.set(key, found);
      }
      return found.catch(() => {
        throw new Problem("unavailable", 503);
      });
    }

    /** The app's installation on a repository, or `undefined` if it isn't installed there. Remembered for five minutes. */
    async function installationFor(app: App, repo: string): Promise<number | undefined> {
      const key = `${app.id}:${repo.toLowerCase()}`;
      const cached = installations.get(key);
      if (cached && cached.id !== undefined && now() - cached.at < 5 * 60_000) return cached.id;
      try {
        const { id } = await githubJson<{ id: number }>(config, `/repos/${repoPath(repo)}/installation`, {
          auth: { bearer: await jwtFor(app) },
        });
        installations.set(key, { id, at: now() });
        return id;
      } catch (error) {
        if (error instanceof GitHubError && error.status === 404) return undefined;
        throw error;
      }
    }

    /**
     * `make` called with the app's installation on the repository. Where GitHub
     * refuses the remembered installation, as it does once the app is
     * uninstalled or the repository taken out of it, it's looked up again, so
     * the person is told to install the app rather than that signing in isn't
     * working.
     */
    async function withInstallation<T>(app: App, repo: string, make: (installation: number) => Promise<T>): Promise<T> {
      const installation = await installationFor(app, repo);
      if (installation === undefined) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
      try {
        return await make(installation);
      } catch (error) {
        if (!(error instanceof GitHubError && (error.status === 404 || error.status === 422))) throw error;
        installations.delete(`${app.id}:${repo.toLowerCase()}`);
        const current = await installationFor(app, repo);
        if (current === undefined) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
        if (current === installation) throw error;
        return make(current);
      }
    }

    /**
     * The addresses tokens may go to: the Site address in the site's settings
     * (`content/site.json`), read with an installation token, and the admin
     * address and the site's other copies, such as staging, that the site's
     * build names there, if it has them. Empty without a Site address.
     */
    async function siteAddresses(repo: string, token: string): Promise<string[]> {
      let url: string | undefined;
      try {
        const response = await github(config, `/repos/${repoPath(repo)}/contents/content/site.json`, {
          auth: { bearer: token },
          accept: "application/vnd.github.raw+json",
        });
        const settings = JSON.parse(await response.text()) as { url?: unknown };
        url = typeof settings.url === "string" ? settings.url : undefined;
      } catch (error) {
        if (error instanceof GitHubError && error.status !== 404) throw error;
      }
      const site = url && originOf(url);
      if (!url || !site) return [];
      const { admin, broker, copies = [] } = await describedAddresses(url);
      // A site with a token broker signs in only there, so its tokens never reach the site's own pages.
      const addresses = broker ? [broker] : [...new Set([site, ...(admin ? [admin] : []), ...copies])];
      return allowedOrigins.length > 0 ? addresses.filter((address) => allowedOrigins.includes(address)) : addresses;
    }

    /**
     * The admin address, token broker and other copies of the site in its
     * description (`goodfellow-site.json`, which builds write from the site's
     * config) at the Site address, where editors sign in when the site has
     * them. Tokens already go to the Site address, so what it serves names no
     * address editors couldn't.
     */
    async function describedAddresses(
      siteUrl: string,
    ): Promise<{ admin?: string; broker?: string; copies?: string[] }> {
      try {
        const response = await config.fetch(new URL("goodfellow-site.json", siteUrl.replace(/\/?$/, "/")).href, {
          redirect: "error",
        });
        if (!response.ok) return {};
        const description = JSON.parse(await response.text()) as {
          admin?: { url?: unknown };
          broker?: { url?: unknown };
          copies?: unknown;
        };
        const address = (url: unknown) => {
          const origin = typeof url === "string" ? originOf(url) : undefined;
          return origin && !isLocalAddress(origin) ? origin : undefined;
        };
        const admin = address(description.admin?.url);
        const broker = address(description.broker?.url);
        const copies = (Array.isArray(description.copies) ? description.copies : [])
          .map(address)
          .filter((origin): origin is string => origin !== undefined);
        return { ...(admin && { admin }), ...(broker && { broker }), ...(copies.length > 0 && { copies }) };
      } catch {
        return {};
      }
    }

    /** Checks that the app is installed on the repository and that `origin` is the site's own address, its admin address, another copy's, or its token broker's. */
    async function checkSite(purpose: Purpose, repo: string, origin: string | undefined): Promise<number> {
      if (!origin || !originOf(origin) || isLocalAddress(origin)) throw new Problem("local-address", 403);
      const app = appFor(purpose);
      const jwt = await jwtFor(app);
      const { installation, reader } = await withInstallation(app, repo, async (installation) => ({
        installation,
        reader: await installationToken(config, jwt, installation, repo, { contents: "read", metadata: "read" }),
      }));
      let addresses: string[];
      try {
        addresses = await siteAddresses(repo, reader.token);
      } finally {
        await revoke(reader.token);
      }
      if (addresses.length === 0) throw new Problem("no-address", 409);
      if (!addresses.includes(origin)) throw new Problem("wrong-address", 403);
      return installation;
    }

    async function revoke(token: string): Promise<void> {
      await github(config, "/installation/token", { method: "DELETE", auth: { bearer: token } }).catch(() => {});
    }

    function checkSetupOrigin(origin: string | undefined): void {
      if (!origin || !setupOrigins.includes(origin)) throw new Problem("wrong-address", 403);
    }

    async function readBody(): Promise<Record<string, unknown>> {
      try {
        const body = JSON.parse(await request.text()) as unknown;
        if (body && typeof body === "object") return body as Record<string, unknown>;
      } catch {
        // Answered below.
      }
      throw new Problem("bad-request", 400);
    }

    async function openSession(body: Record<string, unknown>, purpose?: Purpose): Promise<SessionData> {
      const session = await (await sealer()).open<SessionData>("session", body.session);
      if (!session) throw new Problem("invalid", 401);
      if (session.origin !== requestOrigin) throw new Problem("wrong-address", 403);
      if (purpose && session.purpose !== purpose) throw new Problem("bad-request", 400);
      return session;
    }

    /** A session sealed again, lasting until its lifetime since the person signed in, never longer. */
    async function sealSession(session: SessionData): Promise<string> {
      const lifetime =
        session.purpose === "setup"
          ? SETUP_SESSION_LIFETIME
          : session.remember
            ? REMEMBERED_SESSION_LIFETIME
            : SESSION_LIFETIME;
      // Sessions from before `signedInAt` count from now.
      const signedInAt = session.signedInAt ?? now();
      const left = signedInAt + lifetime - now();
      if (left <= 0) throw new Problem("invalid", 401);
      return (await sealer()).seal("session", { ...session, signedInAt }, left);
    }

    /** What the person may do on the repository, as GitHub says. */
    function allowed(purpose: Purpose, permissions: { push?: boolean; admin?: boolean } | undefined): void {
      if (purpose === "edit" && !permissions?.push) throw new Problem("cant-publish", 403);
      if (purpose === "owner" && !permissions?.admin) throw new Problem("not-owner", 403);
    }

    /** Whether the person may do what the sign-in is for, asked with their own token as they sign in. */
    async function checkAccess(purpose: Purpose, repo: string, token: string): Promise<void> {
      let found: { permissions?: { push?: boolean; admin?: boolean } };
      try {
        found = await githubJson(config, `/repos/${repoPath(repo)}`, { auth: { bearer: token } });
      } catch (error) {
        if (error instanceof GitHubError && error.status === 401) throw new Problem("invalid", 401);
        if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
          throw new Problem("no-access", 403);
        }
        throw error;
      }
      allowed(purpose, found.permissions);
    }

    /** Whether the person still may, asked with an installation token, since the worker keeps no token of theirs. */
    async function checkStillAllowed(session: SessionData, repo: string, token: string): Promise<void> {
      let found: { permission?: string; user?: { permissions?: { push?: boolean; admin?: boolean } } };
      try {
        found = await githubJson(
          config,
          `/repos/${repoPath(repo)}/collaborators/${encodeURIComponent(session.user.login)}/permission`,
          { auth: { bearer: token } },
        );
      } catch (error) {
        if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
          throw new Problem("no-access", 403);
        }
        throw error;
      }
      const permission = found.permission ?? "none";
      allowed(session.purpose, {
        push: found.user?.permissions?.push ?? ["admin", "maintain", "write"].includes(permission),
        admin: found.user?.permissions?.admin ?? permission === "admin",
      });
    }

    /**
     * A token for the session's repository, for the address it was issued to,
     * once GitHub says the person still edits the site (or owns it, for an
     * owner's sign-in), and the session to use next time.
     */
    /** A token with a purpose's permissions, or, for an installation that hasn't accepted the later ones, without them. */
    async function purposeToken(jwt: string, installation: number, repo: string, purpose: Purpose) {
      try {
        return await installationToken(config, jwt, installation, repo, PERMISSIONS[purpose]);
      } catch (error) {
        if (!(error instanceof GitHubError && error.status === 422) || !LATER_PERMISSIONS[purpose]) throw error;
        return installationToken(config, jwt, installation, repo, withoutLater(purpose, PERMISSIONS[purpose]));
      }
    }

    async function issue(session: SessionData, code?: unknown) {
      const repo = session.repo;
      if (!repo) throw new Problem("bad-request", 400);
      const app = appFor(session.purpose);
      const jwt = await jwtFor(app);
      const issued = await withInstallation(app, repo, (installation) =>
        purposeToken(jwt, installation, repo, session.purpose),
      );
      try {
        await checkStillAllowed(session, repo, issued.token);
        // Checked every time, since the site's address can change, and its old address shouldn't keep getting tokens.
        if (!(await siteAddresses(repo, issued.token)).includes(session.origin)) {
          throw new Problem("wrong-address", 403);
        }
      } catch (error) {
        await revoke(issued.token);
        throw error;
      }
      const codeToken = await issueCode(session, code);
      return {
        session: await sealSession(session),
        token: issued.token,
        expiresAt: issued.expiresAt,
        user: publicUser(session.user),
        ...(codeToken && { code: codeToken }),
      };
    }

    /** Whether the person may use the code repository as the token would, asked with that token. */
    async function mayUseCode(session: SessionData, code: string, token: string): Promise<boolean> {
      const auth = { bearer: token };
      const found = await githubJson<{ permission?: string }>(
        config,
        `/repos/${repoPath(code)}/collaborators/${encodeURIComponent(session.user.login)}/permission`,
        { auth },
      );
      const permission = found.permission ?? "none";
      if (session.purpose === "owner") return ["admin", "maintain", "write"].includes(permission);
      if (permission !== "none") return true;
      // Anyone can see a public repository's updates.
      const repository = await githubJson<{ private?: boolean }>(config, `/repos/${repoPath(code)}`, { auth });
      return repository.private === false;
    }

    /** Whether the code repository is the site's: its config names the site's repository, as its backend. */
    async function namesSite(code: string, site: string, token: string): Promise<boolean> {
      const response = await github(config, `/repos/${repoPath(code)}/contents/${CONFIG_FILE}`, {
        auth: { bearer: token },
        accept: "application/vnd.github.raw+json",
      });
      return (await response.text()).toLowerCase().includes(JSON.stringify(site.toLowerCase()));
    }

    /**
     * A token for the site's code repository, or `undefined` where the worker
     * can't give one: Goodfellow isn't installed there, it isn't this site's
     * code, or the person can't see it. Signing in works either way.
     */
    async function issueCode(session: SessionData, code: unknown) {
      const repo = session.repo;
      if (typeof code !== "string" || !REPO.test(code) || !repo || code.toLowerCase() === repo.toLowerCase()) {
        return undefined;
      }
      if (session.purpose === "setup") return undefined;
      const app = appFor(session.purpose);
      const installation = await installationFor(app, code);
      if (installation === undefined) return undefined;
      let issued: { token: string; expiresAt: string } | undefined;
      try {
        issued = await installationToken(
          config,
          await jwtFor(app),
          installation,
          code,
          CODE_PERMISSIONS[session.purpose],
        );
        if ((await namesSite(code, repo, issued.token)) && (await mayUseCode(session, code, issued.token)))
          return issued;
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
      }
      if (issued) await revoke(issued.token);
      return undefined;
    }

    function backTo(state: StateData, params: Record<string, string>): Response {
      const target = new URL(state.return);
      for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
      return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
    }

    async function userInstallations(token: string) {
      type Installation = { id: number; account: { login: string; type: string }; repository_selection: string };
      const found: Installation[] = [];
      for (let page = 1; page <= 10; page++) {
        const { installations = [] } = await githubJson<{ installations?: Installation[] }>(
          config,
          `/user/installations?per_page=100&page=${page}`,
          { auth: { bearer: token } },
        );
        found.push(...installations);
        if (installations.length < 100) break;
      }
      return found;
    }

    try {
      const path = url.pathname.replace(/\/$/, "");

      if (path === "" || path === "/health") {
        return json({
          ok: Boolean(apps.edit && env.SESSION_KEY),
          apps: Object.fromEntries(Object.entries(apps).map(([kind, app]) => [kind, { slug: app.slug }])),
        });
      }

      if (path === "/github/check" && request.method === "GET") {
        const purpose = url.searchParams.get("purpose") === "owner" ? "owner" : "edit";
        const repo = url.searchParams.get("repo") ?? "";
        if (!REPO.test(repo)) throw new Problem("bad-request", 400);
        await checkSite(purpose, repo, requestOrigin);
        return json({ ok: true });
      }

      if (path === "/github/start" && request.method === "GET") {
        const params = url.searchParams;
        const purposeParam = params.get("purpose");
        const purpose: Purpose = purposeParam === "owner" || purposeParam === "setup" ? purposeParam : "edit";
        const back = params.get("return") ?? "";
        const origin = originOf(back);
        const challenge = params.get("challenge") ?? "";
        const repo = params.get("repo") ?? undefined;
        if (!origin || !CHALLENGE.test(challenge) || (purpose !== "setup" && !REPO.test(repo ?? ""))) {
          return page("bad-request");
        }
        const install = params.get("install") === "1";
        try {
          if (purpose === "setup") checkSetupOrigin(origin);
          else {
            // Until it's installed, the site's settings can't be read, so installing checks the address on the way back.
            if (!install) await checkSite(purpose, repo ?? "", origin);
            else if (isLocalAddress(origin)) throw new Problem("local-address", 403);
          }
        } catch (error) {
          if (error instanceof Problem) return page(error.problem, error.status);
          throw error;
        }
        if (purpose === "owner" && !allowedOrigins.includes(origin)) {
          const nonce = cookie(request, CONFIRM_COOKIE);
          if (!nonce || params.get("confirm") !== nonce) {
            const fresh = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
            return confirmPage(url, repo ?? "", origin, fresh);
          }
        }
        const state: StateData = {
          purpose,
          ...(purpose !== "setup" && { repo }),
          return: back,
          challenge,
          remember: params.get("remember") === "1",
          ...(install && { install }),
        };
        const sealed = await (await sealer()).seal("state", state, STATE_LIFETIME);
        const app = appFor(purpose);
        // GitHub's install page signs the person in too, since the apps ask for that, and comes back to the callback.
        const location = install
          ? `${installUrl(app)}?${new URLSearchParams({ state: sealed })}`
          : `${config.web}/login/oauth/authorize?${new URLSearchParams({
              client_id: app.clientId,
              redirect_uri: `${url.origin}/github/callback`,
              state: sealed,
            })}`;
        return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
      }

      if (path === "/github/callback" && request.method === "GET") {
        const state = await (await sealer()).open<StateData>("state", url.searchParams.get("state"));
        if (!state) return page("invalid");
        const code = url.searchParams.get("code");
        const app = appFor(state.purpose);
        if (!code && url.searchParams.get("installation_id")) {
          // Installed without signing in, as GitHub does when an installation was only changed: sign in now.
          const query = new URLSearchParams({
            client_id: app.clientId,
            redirect_uri: `${url.origin}/github/callback`,
            state: url.searchParams.get("state") ?? "",
          });
          return new Response(null, {
            status: 302,
            headers: { location: `${config.web}/login/oauth/authorize?${query}`, "cache-control": "no-store" },
          });
        }
        const origin = new URL(state.return).origin;
        if (state.install && state.repo) {
          // Coming back from installing: only now can the site's settings say where it may go back to.
          try {
            await checkSite(state.purpose, state.repo, origin);
          } catch (error) {
            // The return address isn't known to be the site's, so the answer is a page here, never a redirect.
            if (error instanceof Problem) return page(error.problem, error.status);
            throw error;
          }
        }
        if (!code) return backTo(state, { goodfellow_sign_in_error: "cancelled" });
        let tokens: UserTokens | undefined;
        try {
          tokens = await userTokens(config, app, { code, redirectUri: `${url.origin}/github/callback` }, now());
          const found = await githubJson<{ id: number; login: string; name?: string | null; avatar_url?: string }>(
            config,
            "/user",
            { auth: { bearer: tokens.access } },
          );
          if (state.repo) await checkAccess(state.purpose, state.repo, tokens.access);
          const grant: GrantData = {
            purpose: state.purpose,
            repo: state.repo,
            origin: new URL(state.return).origin,
            remember: state.remember,
            signedInAt: now(),
            challenge: state.challenge,
            user: {
              id: found.id,
              login: found.login,
              name: found.name ?? undefined,
              avatarUrl: found.avatar_url,
              email: `${found.id}+${found.login}@users.noreply.github.com`,
            },
            // Only the setup page needs the person's own token after this.
            ...(state.purpose === "setup" && { tokens }),
          };
          if (state.purpose !== "setup") await revokeUserToken(config, app, tokens.access);
          return backTo(state, { goodfellow_sign_in: await (await sealer()).seal("grant", grant, GRANT_LIFETIME) });
        } catch (error) {
          if (tokens && state.purpose !== "setup") await revokeUserToken(config, app, tokens.access).catch(() => {});
          if (error instanceof Problem) return backTo(state, { goodfellow_sign_in_error: error.problem });
          if (error instanceof GitHubError && error.status === 401) {
            return backTo(state, { goodfellow_sign_in_error: "invalid" });
          }
          return backTo(state, { goodfellow_sign_in_error: "unavailable" });
        }
      }

      if (request.method !== "POST") return json({ problem: "bad-request" }, 404);
      const body = await readBody();

      if (path === "/github/session") {
        const grant = await (await sealer()).open<GrantData>("grant", body.grant);
        if (!grant || typeof body.verifier !== "string") throw new Problem("invalid", 401);
        if (grant.origin !== requestOrigin) throw new Problem("wrong-address", 403);
        if ((await challengeFor(body.verifier)) !== grant.challenge) throw new Problem("invalid", 401);
        const { challenge: _, ...session } = grant;
        if (session.purpose === "setup") {
          return json({ session: await sealSession(session), user: publicUser(session.user) });
        }
        return json(await issue(session, body.code));
      }

      if (path === "/github/token") return json(await issue(await openSession(body), body.code));

      if (path.startsWith("/github/setup/")) {
        return await setupRoute(path, body).catch((error: unknown) => {
          // The person's own token is revoked once the site is created, or GitHub may have revoked it: sign in again.
          if (error instanceof GitHubError && error.status === 401) throw new Problem("invalid", 401);
          throw error;
        });
      }

      return json({ problem: "bad-request" }, 404);
    } catch (error) {
      if (error instanceof Problem) return json({ problem: error.problem, ...error.extra }, error.status);
      // GitHub couldn't be reached, or answered in a way the worker doesn't expect. Nothing about tokens is said.
      return json({ problem: "unavailable" }, 502);
    }

    /** The setup page's requests, made with the person's own token, which its session keeps for half an hour. */
    async function setupRoute(path: string, body: Record<string, unknown>): Promise<Response> {
      checkSetupOrigin(requestOrigin);
      const session = await openSession(body, "setup");
      const tokens = session.tokens;
      if (!tokens) throw new Problem("invalid", 401);
      // The session keeps its expiry: the person's token isn't kept any longer for being used.
      const renewed = body.session as string;
      const auth = { bearer: tokens.access };
      const app = appFor("setup");

      if (path === "/github/setup/owners") {
        const found = await userInstallations(tokens.access);
        const own = found.find((item) => item.account.login.toLowerCase() === session.user.login.toLowerCase());
        return json({
          session: renewed,
          user: publicUser(session.user),
          installUrl: installUrl(app),
          owners: [
            {
              path: session.user.login,
              name: session.user.name || session.user.login,
              kind: "personal",
              installed: Boolean(own),
            },
            ...found
              .filter((item) => item.account.type === "Organization")
              .map((item) => ({
                path: item.account.login,
                name: item.account.login,
                kind: "organization",
                installed: true,
              })),
          ],
        });
      }

      const owner = typeof body.owner === "string" ? body.owner : "";
      const name = typeof body.name === "string" ? body.name : "";
      if (!REPO.test(`${owner}/${name}`)) throw new Problem("name-invalid", 400);

      if (path === "/github/setup/available") {
        try {
          await github(config, `/repos/${repoPath(`${owner}/${name}`)}`, { auth });
          return json({ session: renewed, available: false });
        } catch (error) {
          if (error instanceof GitHubError && (error.status === 404 || error.status === 403)) {
            return json({ session: renewed, available: true });
          }
          throw error;
        }
      }

      if (path === "/github/setup/repository") {
        const installation = (await userInstallations(tokens.access)).find(
          (item) => item.account.login.toLowerCase() === owner.toLowerCase(),
        );
        if (!installation) throw new Problem("not-installed", 409, { installUrl: installUrl(app) });
        let repo: { id: number; full_name: string; html_url: string; default_branch: string };
        try {
          repo = await githubJson(
            config,
            owner.toLowerCase() === session.user.login.toLowerCase()
              ? "/user/repos"
              : `/orgs/${encodeURIComponent(owner)}/repos`,
            {
              method: "POST",
              auth,
              body: {
                name,
                private: body.private === true,
                description: typeof body.description === "string" ? body.description : undefined,
                // GitHub's API can't write files to an empty repository, so it starts with a README.
                auto_init: true,
              },
            },
          );
        } catch (error) {
          if (error instanceof GitHubError && error.status === 422) {
            const said = JSON.stringify(error.body);
            throw new Problem(/already exists/i.test(said) ? "name-taken" : "name-invalid", 422);
          }
          if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
            throw new Problem("not-allowed", 403);
          }
          throw error;
        }
        if (installation.repository_selection === "selected") {
          await github(config, `/user/installations/${installation.id}/repositories/${repo.id}`, {
            method: "PUT",
            auth,
          });
        }
        const jwt = await jwtFor(app);
        // An installation that hasn't accepted the Secrets permission yet gets one without: the setup page explains what to add.
        const issued = await purposeToken(jwt, installation.id, repo.full_name, "setup");
        const editApp = apps.edit;
        const editInstalled = editApp ? (await installationFor(editApp, repo.full_name)) !== undefined : true;
        // The repository exists, which is all the person's own token was kept for, unless another one follows.
        if (body.more !== true) await revokeUserToken(config, app, tokens.access).catch(() => {});
        return json({
          session: renewed,
          repo: { full_name: repo.full_name, html_url: repo.html_url, default_branch: repo.default_branch },
          token: issued.token,
          expiresAt: issued.expiresAt,
          ...(!editInstalled && editApp && { editInstallUrl: installUrl(editApp) }),
        });
      }
      return json({ problem: "bad-request" }, 404);
    }
  }

  return { fetch: handle };
}
