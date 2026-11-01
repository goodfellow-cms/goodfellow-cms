/**
 * The sign-in worker's own setup page, at `/setup`, for owners who deployed it
 * with Cloudflare's Deploy to Cloudflare button rather than from a computer.
 *
 * Its settings are secrets in Cloudflare, which a running worker can't change
 * by itself, so the owner pastes a Cloudflare API token once, made from a link
 * that fills in its permissions. The worker uses it to find itself in the
 * owner's account (the name it was deployed under, `WORKER_NAME`, which its
 * deploy script passes), and writes its secrets there: a new `SESSION_KEY`,
 * `ALLOWED_ORIGINS` (the sites' addresses, always set this way), then each
 * GitHub App's keys as GitHub's app manifest flow gives them. A token reaches
 * only workers in its own account, so someone else's can't change this one,
 * which is what keeps a stranger who finds an unconfigured worker from taking
 * it over.
 *
 * Nothing is stored: between steps the token travels sealed in a cookie only
 * this browser has, under the new `SESSION_KEY`, for half an hour at most, as
 * the setup page's sign-in keeps the person's GitHub token. Once both apps are
 * made the cookie is cleared, and the page only offers to change the sites'
 * addresses, which needs a token again.
 */

import { base64UrlEncode, createSealer } from "./seal.js";
import {
  type AppKind,
  appManifest,
  appSecrets,
  convertManifest,
  manifestAction,
  newSessionKey,
  slugVar,
} from "./setup.js";
import type { WorkerEnv } from "./worker.js";

/** Cloudflare's API, which tests point elsewhere. */
export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/**
 * The page in Cloudflare's dashboard that makes the token, with its
 * permissions filled in: editing Workers, which writes the worker's secrets,
 * and reading the account's settings, which finds the account it's in.
 */
export const TOKEN_TEMPLATE_URL = `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({
  permissionGroupKeys: JSON.stringify([
    { key: "workers_scripts", type: "edit" },
    { key: "account_settings", type: "read" },
  ]),
  accountId: "*",
  zoneId: "all",
  name: "Goodfellow sign-in setup",
})}`;

const SETUP_COOKIE = "__Host-goodfellow_setup";
const SETUP_KIND = "self-setup";
const SETUP_LIFETIME = 30 * 60_000;
/** How soon a page waiting for Cloudflare to start the worker's new version looks again, in seconds. */
const RELOAD_SECONDS = 4;
/** The most addresses `ALLOWED_ORIGINS` takes from the page. */
const MAX_ADDRESSES = 20;

/** What the setup cookie holds, sealed. */
interface SetupState {
  token: string;
  account: string;
  /** The GitHub organization that owns the apps, or none for the person's own account. */
  organization?: string;
  public: boolean;
  /** The `state` sent to GitHub with the manifest, which the callback must bring back. */
  nonce: string;
  /** The apps already made and saved, which the worker's settings may not show yet. */
  made: AppKind[];
}

export interface SelfSetupOptions {
  fetch: typeof fetch;
  github: { api: string; web: string };
  now: () => number;
}

class SetupProblem extends Error {}

/** Whether the worker has everything it needs to sign people in. */
export function isConfigured(env: WorkerEnv): boolean {
  return Boolean(
    env.SESSION_KEY && env.EDIT_APP_ID && env.EDIT_PRIVATE_KEY && env.OWNER_APP_ID && env.OWNER_PRIVATE_KEY,
  );
}

/**
 * The sites' addresses from what the owner typed: origins only, `https://`,
 * one per line or separated by commas. Throws for anything else.
 */
export function parseAddresses(text: string): string[] {
  const found: string[] = [];
  for (const part of text.split(/[\s,]+/)) {
    if (!part) continue;
    let url: URL;
    try {
      url = new URL(part.includes("://") ? part : `https://${part}`);
    } catch {
      throw new SetupProblem(`${part} isn't an address.`);
    }
    if (url.protocol !== "https:") throw new SetupProblem(`${part} needs to start with https://.`);
    if (!found.includes(url.origin)) found.push(url.origin);
  }
  if (found.length === 0)
    throw new SetupProblem("Give at least one address: the site's own, such as https://example.org.");
  if (found.length > MAX_ADDRESSES) throw new SetupProblem(`Give at most ${MAX_ADDRESSES} addresses.`);
  return found;
}

/** A GitHub App name, which GitHub takes up to 34 characters of, from the first site's address. */
export function appName(kind: AppKind, addresses: readonly string[]): string {
  const host = addresses[0] ? new URL(addresses[0]).hostname.replace(/^www\./, "") : "";
  const base = kind === "edit" ? "Goodfellow" : "Goodfellow owners";
  return `${base} ${host}`.trim().slice(0, 34).trim();
}

export function createSelfSetup(options: SelfSetupOptions) {
  const githubOrigin = new URL(options.github.web).origin;
  const htmlPage = (title: string, body: string, headers: Record<string, string> = {}, status = 200) =>
    page(title, body, headers, status, githubOrigin);
  const waitingPage = (headers: Record<string, string> = {}, seconds = RELOAD_SECONDS) =>
    htmlPage(
      "Set up the sign-in service",
      `<p role="status">Saved. Cloudflare is starting the service with its new settings, which takes a few seconds; this page goes on by itself.</p>
<p><a href="/setup">Go on now</a></p>`,
      { ...headers, refresh: `${seconds}; url=/setup` },
    );
  /** The apps made so far: those the worker's settings have, and those this setup saved, which they may not show yet. */
  const madeApps = (env: WorkerEnv, state: SetupState): AppKind[] =>
    (["edit", "owner"] as const).filter(
      (kind) => state.made.includes(kind) || Boolean(kind === "edit" ? env.EDIT_APP_ID : env.OWNER_APP_ID),
    );
  const addressesOf = (env: WorkerEnv) => (env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  const cloudflare = async (env: WorkerEnv, token: string, path: string, init: RequestInit = {}) => {
    const base = (env.CLOUDFLARE_API ?? CLOUDFLARE_API).replace(/\/$/, "");
    const response = await options.fetch(`${base}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    });
    const body = (await response.json().catch(() => undefined)) as
      | { success?: boolean; result?: unknown; errors?: { code?: number }[] }
      | undefined;
    return { ok: response.ok && body?.success !== false, status: response.status, result: body?.result };
  };

  /** The account the worker is in, as far as this token can see, or a problem to show. */
  async function findWorker(env: WorkerEnv, token: string): Promise<string> {
    const name = env.WORKER_NAME ?? "";
    const accounts = await cloudflare(env, token, "/accounts?per_page=50");
    if (accounts.status === 401 || accounts.status === 403 || !accounts.ok) {
      throw new SetupProblem("Cloudflare didn't accept that token. Make a new one from the link, and paste all of it.");
    }
    const list = Array.isArray(accounts.result) ? (accounts.result as { id?: unknown }[]) : [];
    for (const account of list) {
      if (typeof account.id !== "string" || !/^[0-9a-f]{32}$/.test(account.id)) continue;
      const found = await cloudflare(
        env,
        token,
        `/accounts/${account.id}/workers/scripts/${encodeURIComponent(name)}/settings`,
      );
      if (found.ok) return account.id;
    }
    throw new SetupProblem(
      `That token can't reach this sign-in service (${name}). Make the token in the Cloudflare account the service was deployed to.`,
    );
  }

  async function writeSecrets(
    env: WorkerEnv,
    state: Pick<SetupState, "token" | "account">,
    secrets: Record<string, string>,
  ) {
    const name = encodeURIComponent(env.WORKER_NAME ?? "");
    for (const [key, value] of Object.entries(secrets)) {
      const written = await cloudflare(env, state.token, `/accounts/${state.account}/workers/scripts/${name}/secrets`, {
        method: "PUT",
        body: JSON.stringify({ name: key, text: value, type: "secret_text" }),
      });
      if (!written.ok) {
        throw new SetupProblem(
          "Cloudflare didn't save the service's settings. Check the token can edit Workers, then try again.",
        );
      }
    }
  }

  async function sealState(key: string, state: SetupState): Promise<string> {
    return (await createSealer(key, options.now)).seal(SETUP_KIND, state, SETUP_LIFETIME);
  }

  async function openState(request: Request, env: WorkerEnv): Promise<SetupState | undefined> {
    const sealed = cookie(request, SETUP_COOKIE);
    if (!sealed || !env.SESSION_KEY) return undefined;
    try {
      return await (await createSealer(env.SESSION_KEY, options.now)).open<SetupState>(SETUP_KIND, sealed);
    } catch {
      return undefined;
    }
  }

  async function form(request: Request): Promise<URLSearchParams> {
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("application/x-www-form-urlencoded")) throw new SetupProblem("Send the form from this page.");
    return new URLSearchParams(await request.text());
  }

  /** The page for the next app to make, or the end. */
  function appPage(url: URL, state: SetupState, made: AppKind[], addresses: string[]): Response {
    const next = (["edit", "owner"] as const).find((kind) => !made.includes(kind));
    if (!next) {
      return htmlPage(
        "The sign-in service is set up",
        `<p>Both GitHub Apps are made, and the service has everything it needs.</p>
<p>Its address is <strong>${escapeHtml(url.origin)}</strong>. In your site's admin panel, open <strong>Site Settings → Security</strong>, put that address under <strong>Sign-in service</strong> and publish. The first time you sign in after the site has rebuilt, it offers to install the app on the site's repository.</p>
<p>You can now delete the Cloudflare token you made for this page, in Cloudflare's <strong>My Profile → API Tokens</strong>: the service doesn't keep it.</p>`,
        { "set-cookie": clearCookie() },
      );
    }
    const manifest = appManifest({
      kind: next,
      name: appName(next, addresses),
      worker: url.origin,
      redirect: `${url.origin}/setup/github/callback`,
      public: state.public,
    });
    const action = manifestAction(`${next}.${state.nonce}`, state.organization, options.github.web);
    const what =
      next === "edit"
        ? "the editors' app, which signs editors in"
        : "the owners' app, which owners use to change who edits a site, its domain and its updates";
    return htmlPage(
      "Set up the sign-in service",
      `${made.includes("edit") ? "<p>Made the editors' app.</p>" : "<p>Saved the sites' addresses.</p>"}
<p>Next, make ${what}. GitHub shows its settings, filled in already: check the name, which people see when they sign in (GitHub needs it to be unused), and choose <strong>Create GitHub App</strong>.</p>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Make ${next === "edit" ? "the editors' app" : "the owners' app"} on GitHub</button>
</form>`,
    );
  }

  function firstPage(problem?: string, values: Record<string, string> = {}): Response {
    return htmlPage(
      "Set up the sign-in service",
      `<p>This sign-in service lets your sites' editors sign in with GitHub. It needs a few settings, which this page saves in Cloudflare for you.</p>
<ol>
<li><a href="${escapeHtml(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener noreferrer">Make a Cloudflare API token</a>, in the account you deployed the service to. The link fills in what it needs: choose <strong>Continue to summary</strong>, then <strong>Create Token</strong>, and copy it.</li>
<li>Paste it here, with your sites' addresses, and choose <strong>Save and continue</strong>. The token is used only while you set the service up, and never kept.</li>
</ol>
${problem ? `<p class="problem" role="alert">${escapeHtml(problem)}</p>` : ""}
<form method="post" action="/setup/token">
<label>Cloudflare API token<input name="token" type="password" autocomplete="off" required value="${escapeHtml(values.token ?? "")}"></label>
<label>Your sites' addresses<textarea name="addresses" rows="3" required placeholder="https://example.org">${escapeHtml(values.addresses ?? "")}</textarea>
<span class="hint">Each site's address, and its admin address or token broker's if it has one, one per line. Tokens only ever go to these.</span></label>
<label>GitHub organization that owns the apps (optional)<input name="organization" autocomplete="off" value="${escapeHtml(values.organization ?? "")}">
<span class="hint">Leave it empty to make them in your own GitHub account. Only an organization's owners can make apps in it.</span></label>
<label class="check"><input type="checkbox" name="public" value="1"${values.public ? " checked" : ""}> Sites in other GitHub accounts will use this service too</label>
<button type="submit">Save and continue</button>
</form>`,
    );
  }

  function configuredPage(problem?: string, done?: boolean): Response {
    return htmlPage(
      "This sign-in service is set up",
      `<p>It has its GitHub Apps and its settings.</p>
${done ? '<p role="status"><strong>Saved the new addresses.</strong> They take effect within a minute.</p>' : ""}
<h2>Change your sites' addresses</h2>
<p>Paste a Cloudflare API token from the account the service is in (<a href="${escapeHtml(TOKEN_TEMPLATE_URL)}" target="_blank" rel="noopener noreferrer">make one</a>) and the full list of addresses. It replaces the list.</p>
${problem ? `<p class="problem" role="alert">${escapeHtml(problem)}</p>` : ""}
<form method="post" action="/setup/addresses">
<label>Cloudflare API token<input name="token" type="password" autocomplete="off" required></label>
<label>Your sites' addresses<textarea name="addresses" rows="3" required placeholder="https://example.org"></textarea></label>
<button type="submit">Save the addresses</button>
</form>
<p class="hint">To make new GitHub Apps, delete the service's secrets in Cloudflare (the worker's <strong>Settings → Variables and Secrets</strong>), then open this page again.</p>`,
    );
  }

  async function handle(request: Request, env: WorkerEnv): Promise<Response | undefined> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    // Only a worker deployed with its deploy script, which names it, sets itself up here.
    if (!env.WORKER_NAME) return undefined;
    // Its own address leads to the setup page until it's set up.
    if (path === "" && request.method === "GET" && !isConfigured(env)) {
      return new Response(null, { status: 302, headers: { location: "/setup", "cache-control": "no-store" } });
    }
    if (path !== "/setup" && !path.startsWith("/setup/")) return undefined;

    try {
      if (path === "/setup" && request.method === "GET") {
        if (isConfigured(env)) return configuredPage();
        const state = await openState(request, env);
        if (state) return appPage(url, state, madeApps(env, state), addressesOf(env));
        // A cookie this version can't open yet: Cloudflare is still starting the version with the new key.
        if (cookie(request, SETUP_COOKIE) && !env.SESSION_KEY) return waitingPage();
        return firstPage();
      }

      if (path === "/setup/token" && request.method === "POST") {
        if (isConfigured(env)) return configuredPage();
        const fields = await form(request);
        const values = Object.fromEntries(fields);
        const token = (fields.get("token") ?? "").trim();
        const organization = (fields.get("organization") ?? "").trim() || undefined;
        try {
          if (!token) throw new SetupProblem("Paste the Cloudflare API token.");
          if (organization && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(organization)) {
            throw new SetupProblem(`${organization} isn't a GitHub organization's name.`);
          }
          const addresses = parseAddresses(fields.get("addresses") ?? "");
          const account = await findWorker(env, token);
          const key = env.SESSION_KEY ?? newSessionKey();
          await writeSecrets(
            env,
            { token, account },
            {
              ...(!env.SESSION_KEY && { SESSION_KEY: key }),
              ALLOWED_ORIGINS: addresses.join(","),
            },
          );
          const state: SetupState = {
            token,
            account,
            ...(organization && { organization }),
            public: fields.get("public") === "1",
            nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
            made: [],
          };
          const sealed = await sealState(key, state);
          // The new key is in the version Cloudflare is starting, so wait for it before going on.
          return waitingPage({ "set-cookie": setCookie(sealed) }, env.SESSION_KEY ? 0 : RELOAD_SECONDS);
        } catch (error) {
          if (error instanceof SetupProblem) return firstPage(error.message, { ...values, token: "" });
          throw error;
        }
      }

      if (path === "/setup/github/callback" && request.method === "GET") {
        if (isConfigured(env)) return configuredPage();
        const state = await openState(request, env);
        if (!state)
          return firstPage("This setup took longer than half an hour, or started in another browser. Start again.");
        const [kind, nonce] = (url.searchParams.get("state") ?? "").split(".");
        const code = url.searchParams.get("code") ?? "";
        if ((kind !== "edit" && kind !== "owner") || nonce !== state.nonce || !code) {
          return htmlPage(
            "Set up the sign-in service",
            '<p class="problem" role="alert">GitHub came back without the app. <a href="/setup">Try again</a>.</p>',
            {},
            400,
          );
        }
        if (madeApps(env, state).includes(kind)) return appPage(url, state, madeApps(env, state), addressesOf(env));
        const app = await convertManifest(code, options.fetch, options.github.api).catch((error: unknown) => {
          throw new SetupProblem(error instanceof Error ? error.message : "GitHub didn't give the app's details.");
        });
        await writeSecrets(env, state, { ...appSecrets(kind, app), [slugVar(kind)]: app.slug });
        const next: SetupState = {
          ...state,
          made: [...state.made, kind],
          nonce: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
        };
        const made = madeApps(env, next);
        const sealed = await sealState(env.SESSION_KEY ?? "", next);
        const response = appPage(url, next, made, addressesOf(env));
        if (made.length < 2) response.headers.append("set-cookie", setCookie(sealed));
        return response;
      }

      if (path === "/setup/addresses" && request.method === "POST") {
        if (!isConfigured(env)) return firstPage();
        const fields = await form(request);
        try {
          const token = (fields.get("token") ?? "").trim();
          if (!token) throw new SetupProblem("Paste the Cloudflare API token.");
          const addresses = parseAddresses(fields.get("addresses") ?? "");
          const account = await findWorker(env, token);
          await writeSecrets(env, { token, account }, { ALLOWED_ORIGINS: addresses.join(",") });
          return configuredPage(undefined, true);
        } catch (error) {
          if (error instanceof SetupProblem) return configuredPage(error.message);
          throw error;
        }
      }

      return htmlPage("Not found", "<p>There's nothing here.</p>", {}, 404);
    } catch (error) {
      if (error instanceof SetupProblem) {
        return htmlPage(
          "Set up the sign-in service",
          `<p class="problem" role="alert">${escapeHtml(error.message)}</p><p><a href="/setup">Back</a></p>`,
          {},
          400,
        );
      }
      // Never show what Cloudflare or GitHub answered: it could hold the token or a key.
      return htmlPage(
        "Set up the sign-in service",
        '<p class="problem" role="alert">Something went wrong while setting the service up. Try again in a minute.</p><p><a href="/setup">Back</a></p>',
        {},
        500,
      );
    }
  }

  return { handle };
}

function setCookie(sealed: string): string {
  return `${SETUP_COOKIE}=${sealed}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SETUP_LIFETIME / 1000}`;
}

function clearCookie(): string {
  return `${SETUP_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The setup page's own headers: nothing may frame it, and it loads nothing but its own style. */
function page(title: string, body: string, headers: Record<string, string>, status: number, github: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body { font: 16px/1.5 system-ui, sans-serif; max-width: 38rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
label { display: block; margin: 1rem 0; font-weight: 600; }
label.check { font-weight: 400; }
input:not([type=checkbox]), textarea { display: block; width: 100%; box-sizing: border-box; margin-top: 0.25rem; font: inherit; padding: 0.4rem; }
.hint { display: block; font-weight: 400; font-size: 0.9rem; color: #59636e; }
button { font: inherit; padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid #1f883d; background: #1f883d; color: #fff; cursor: pointer; }
.problem { color: #b42318; }
a { color: #0969da; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } .hint { color: #9198a1; } .problem { color: #ff7b72; } a { color: #4493f8; } input, textarea { background: #161b22; color: inherit; border: 1px solid #3d444d; } }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // Its forms post to itself, and the app's manifest to GitHub.
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${github}; frame-ancestors 'none'; base-uri 'none'`,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      ...headers,
    },
  });
}
