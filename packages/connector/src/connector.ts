/**
 * Goodfellow's Claude connector: an MCP server, at `/mcp`, with Goodfellow's
 * tools, and the OAuth authorization server Claude signs in with.
 *
 * 1. Claude finds the authorization server from `/mcp`'s 401 and the
 *    `.well-known` documents, and registers (`/register`) or names itself
 *    with a client ID metadata document.
 * 2. `/authorize` asks which host the site is on; `/connect/github`,
 *    `/connect/gitlab` and `/connect/bitbucket` sign the person in there, and
 *    come back to a page where they choose the sites Claude may work on
 *    (`/connect/confirm`).
 * 3. Claude exchanges the code at `/token` for an access token, lasting an
 *    hour, and a refresh token, which works once.
 *
 * Who connected and which sites are sealed inside the tokens, as the sign-in
 * worker's sessions are; the one thing stored is each connection's refresh
 * token generation (`grants.ts`), so a refresh token can't be used twice.
 */

import type { GitBackend } from "@goodfellow-cms/core";
import { createGoodfellowServer, type Screenshotter, ToolError } from "@goodfellow-cms/mcp";
import { type App, type GitHubConfig, GitHubError } from "@goodfellow-cms/worker/github";
import { base64UrlEncode, challengeFor, createSealer, type Sealer } from "@goodfellow-cms/worker/seal";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import * as bb from "./bitbucket.js";
import { ClientError, findClient, redirectMatches, registerClient } from "./clients.js";
import { type Connection, type HostTokens, MAX_SITES } from "./connection.js";
import * as gh from "./github.js";
import * as gl from "./gitlab.js";
import { type D1Like, d1Grants, type GrantStore } from "./grants.js";
import { connectPage, installPage, page, problemPage, sitesPage } from "./pages.js";

export interface ConnectorEnv {
  /** 32 random bytes, base64-encoded, which tokens are sealed with. */
  SESSION_KEY?: string;
  /** The Goodfellow for Claude GitHub App. */
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_PRIVATE_KEY?: string;
  /** For tests: a fake GitHub's addresses. */
  GITHUB_API?: string;
  GITHUB_WEB?: string;
  /** A GitLab OAuth application, for sites on GitLab. `GITLAB_URL` defaults to `https://gitlab.com`. */
  GITLAB_URL?: string;
  GITLAB_CLIENT_ID?: string;
  GITLAB_CLIENT_SECRET?: string;
  /** A private Bitbucket OAuth consumer, for sites on Bitbucket. */
  BITBUCKET_CLIENT_ID?: string;
  BITBUCKET_CLIENT_SECRET?: string;
  /** The D1 database with the `grants` table (`migrations/`). */
  DB?: D1Like;
  /** Cloudflare Browser Rendering, for screenshots. */
  BROWSER?: { fetch: typeof fetch };
}

export interface ConnectorOptions {
  /** Every request the connector makes: to GitHub, GitLab, Bitbucket, clients' documents and sites. */
  fetch?: typeof fetch;
  now?: () => number;
  /** Where refresh token generations are kept. Defaults to `env.DB`. */
  grants?: (env: ConnectorEnv) => GrantStore | undefined;
  /** Takes screenshots. Defaults to Browser Rendering through `env.BROWSER`. */
  screenshots?: (env: ConnectorEnv) => Promise<Screenshotter | undefined>;
}

/** What the connector does after answering, such as revoking tokens. */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

const REQUEST_LIFETIME = 30 * 60_000;
const CODE_LIFETIME = 2 * 60_000;
const ACCESS_LIFETIME = 3_600_000;
const REFRESH_LIFETIME = 30 * 24 * 3_600_000;
const COOKIE = "__Host-goodfellow-connect";

/** A connection on its way through `/authorize`: what Claude asked for, and the browser it started in. */
interface RequestData {
  clientId: string;
  clientName: string;
  redirectUri: string;
  challenge: string;
  state?: string;
  /** Matches the cookie set by `/authorize`, so only the browser that started can finish. */
  nonce: string;
}

interface PickerData {
  request: RequestData;
  connection: Connection;
  /** The person's GitLab or Bitbucket tokens. */
  tokens?: HostTokens;
}

interface CodeData {
  clientId: string;
  redirectUri: string;
  challenge: string;
  connection: Connection;
  tokens?: HostTokens;
}

interface AccessData {
  grant: string;
  connection: Connection;
  /** The person's GitLab or Bitbucket access token. */
  token?: string;
  /** What `token` was called before Bitbucket, in tokens sealed then. */
  gitlab?: string;
}

interface RefreshData {
  grant: string;
  generation: number;
  clientId: string;
  connection: Connection;
  /** The person's GitLab or Bitbucket refresh token. */
  token?: string;
  /** What `token` was called before Bitbucket, in tokens sealed then. */
  gitlab?: string;
}

class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function cookies(request: Request): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name) found.set(name, value.join("="));
  }
  return found;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/** Where a form on the connector's pages may end up: the client's address, which `/connect/confirm` redirects to. */
function formActionFor(redirectUri: string): string {
  const url = new URL(redirectUri);
  return isLoopback(url.hostname) ? `${url.protocol}//${url.hostname}:*` : url.origin;
}

function redirect(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", ...headers } });
}

async function sha256(text: string): Promise<string> {
  return base64UrlEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

export function createConnector(options: ConnectorOptions = {}) {
  const now = options.now ?? Date.now;
  const fetcher: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const sealers = new Map<string, Promise<Sealer>>();

  async function handle(request: Request, env: ConnectorEnv, context?: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = url.pathname.replace(/(.)\/$/, "$1");
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, DELETE",
      "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
      "access-control-expose-headers": "www-authenticate, mcp-session-id",
    };
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", "cache-control": "no-store", ...cors, ...headers },
      });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const github: GitHubConfig = {
      api: (env.GITHUB_API ?? "https://api.github.com").replace(/\/$/, ""),
      web: (env.GITHUB_WEB ?? "https://github.com").replace(/\/$/, ""),
      fetch: fetcher,
    };
    const app: App | undefined =
      env.GITHUB_APP_ID && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.GITHUB_PRIVATE_KEY
        ? {
            id: env.GITHUB_APP_ID,
            slug: env.GITHUB_APP_SLUG ?? "",
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
            privateKey: env.GITHUB_PRIVATE_KEY,
          }
        : undefined;
    const gitlab: gl.GitLabConfig | undefined =
      env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET
        ? {
            url: (env.GITLAB_URL ?? "https://gitlab.com").replace(/\/$/, ""),
            clientId: env.GITLAB_CLIENT_ID,
            clientSecret: env.GITLAB_CLIENT_SECRET,
            fetch: fetcher,
          }
        : undefined;
    const bitbucket: bb.BitbucketConfig | undefined =
      env.BITBUCKET_CLIENT_ID && env.BITBUCKET_CLIENT_SECRET
        ? { clientId: env.BITBUCKET_CLIENT_ID, clientSecret: env.BITBUCKET_CLIENT_SECRET, fetch: fetcher }
        : undefined;
    const grants = options.grants ? options.grants(env) : env.DB && d1Grants(env.DB);
    const githubCallback = `${origin}/connect/github/callback`;
    const gitlabCallback = `${origin}/connect/gitlab/callback`;
    const resourceMetadata = `${origin}/.well-known/oauth-protected-resource/mcp`;

    function sealer(): Promise<Sealer> {
      const key = env.SESSION_KEY ?? "";
      let found = sealers.get(key);
      if (!found) {
        found = createSealer(key, now);
        found.catch(() => sealers.delete(key));
        sealers.set(key, found);
      }
      return found;
    }

    async function form(): Promise<URLSearchParams> {
      const type = request.headers.get("content-type") ?? "";
      if (!type.startsWith("application/x-www-form-urlencoded")) {
        throw new OAuthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
      }
      return new URLSearchParams(await request.text());
    }

    /** Back to the client with an error, once its address is known to be its own. */
    function backWithError(data: { redirectUri: string; state?: string }, error: string, description: string) {
      const target = new URL(data.redirectUri);
      target.searchParams.set("error", error);
      target.searchParams.set("error_description", description);
      if (data.state) target.searchParams.set("state", data.state);
      target.searchParams.set("iss", origin);
      return redirect(target.toString());
    }

    /** The connection in progress, if this browser started it. */
    async function openRequest(sealed: string | null): Promise<RequestData | undefined> {
      const data = await (await sealer()).open<RequestData>("request", sealed);
      if (!data || cookies(request).get(COOKIE) !== data.nonce) return undefined;
      return data;
    }

    const expired = () =>
      problemPage(
        "Start again from Claude",
        "This page has expired, or was opened in another browser. Go back to Claude and connect Goodfellow again.",
      );

    async function authorize(): Promise<Response> {
      const params = url.searchParams;
      const client = await findClient(await sealer(), params.get("client_id") ?? "", fetcher);
      if (!client) return problemPage("Unknown app", "The app connecting to Goodfellow didn't say who it is.");
      const redirectUri =
        params.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
      if (!redirectUri || !redirectMatches(client, redirectUri)) {
        return problemPage(
          "Unknown address",
          "The app connecting to Goodfellow asked to go back to an address it hasn't registered.",
        );
      }
      const state = params.get("state") ?? undefined;
      // Problems before the person has seen anything are shown here, never sent on to the app's address,
      // so a link to this page can't send someone to an address of the link's choosing.
      const badRequest = (description: string) =>
        problemPage(
          "Can't connect",
          `The app connecting to Goodfellow sent a request it can't use: ${description}`,
          400,
        );
      if (params.get("response_type") !== "code") return badRequest("only response_type=code is supported.");
      const challenge = params.get("code_challenge") ?? "";
      if (params.get("code_challenge_method") !== "S256" || !/^[\w-]{43}$/.test(challenge)) {
        return badRequest("PKCE with S256 is required.");
      }
      const resource = params.get("resource");
      if (resource && resource.replace(/\/$/, "") !== `${origin}/mcp` && resource.replace(/\/$/, "") !== origin) {
        return badRequest(`this server's resource is ${origin}/mcp.`);
      }
      if (!app && !gitlab && !bitbucket)
        return problemPage("Not set up yet", "This connector isn't set up to sign in anywhere yet.", 503);
      const nonce = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
      const data: RequestData = { clientId: client.id, clientName: client.name, redirectUri, challenge, state, nonce };
      const sealed = encodeURIComponent(await (await sealer()).seal("request", data, REQUEST_LIFETIME));
      const links: Array<[string, string]> = [];
      if (app) links.push(["Sign in with GitHub", `/connect/github?request=${sealed}`]);
      if (gitlab) links.push(["Sign in with GitLab", `/connect/gitlab?request=${sealed}`]);
      if (bitbucket) links.push(["Sign in with Bitbucket", `/connect/bitbucket?request=${sealed}`]);
      links.push(["Cancel", `/connect/cancel?request=${sealed}`]);
      const response = connectPage({ client: client.name, redirectUri, links });
      response.headers.append(
        "set-cookie",
        `${COOKIE}=${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${REQUEST_LIFETIME / 1000}`,
      );
      return response;
    }

    async function pickSites(data: RequestData, connection: Connection, tokens?: HostTokens): Promise<Response> {
      const picker = await (await sealer()).seal(
        "picker",
        { request: data, connection, ...(tokens && { tokens }) } satisfies PickerData,
        REQUEST_LIFETIME,
      );
      return sitesPage({
        client: data.clientName,
        redirectUri: data.redirectUri,
        sites: connection.sites.map((site) => site.repo),
        picker,
        formAction: formActionFor(data.redirectUri),
      });
    }

    async function githubCallbackRoute(): Promise<Response> {
      if (!app) return problemPage("Not set up", "This connector doesn't sign in with GitHub.", 404);
      const state = url.searchParams.get("state");
      const data = await openRequest(state);
      if (!data) return expired();
      const code = url.searchParams.get("code");
      if (!code) return backWithError(data, "access_denied", "GitHub didn't sign the person in.");
      let found: Awaited<ReturnType<typeof gh.signedInSites>>;
      try {
        found = await gh.signedInSites(github, app, { code, redirectUri: githubCallback }, now());
      } catch (error) {
        if (error instanceof GitHubError) {
          return problemPage("GitHub didn't sign you in", "Go back to Claude and connect Goodfellow again.", 502);
        }
        throw error;
      }
      if (!found.sites.length) {
        return installPage({
          installUrl: gh.installUrl(github, app, state ?? ""),
          again: `/connect/github?request=${encodeURIComponent(state ?? "")}`,
        });
      }
      return pickSites(data, { host: "github", user: found.user, sites: found.sites });
    }

    async function gitlabCallbackRoute(): Promise<Response> {
      if (!gitlab) return problemPage("Not set up", "This connector doesn't sign in with GitLab.", 404);
      const state = await (await sealer()).open<{ request: string; verifier: string }>(
        "gitlab-state",
        url.searchParams.get("state"),
      );
      const data = state && (await openRequest(state.request));
      if (!state || !data) return expired();
      const code = url.searchParams.get("code");
      if (!code) return backWithError(data, "access_denied", "GitLab didn't sign the person in.");
      try {
        const tokens = await gl.exchangeCode(
          gitlab,
          { code, redirectUri: gitlabCallback, verifier: state.verifier },
          now(),
        );
        const found = await gl.signedInSites(gitlab, tokens.access);
        if (!found.sites.length) {
          return problemPage(
            "No sites to work on",
            `The GitLab account ${found.user.login} can't publish to any project. Ask the site's owner to make you a Developer or Maintainer, then connect again.`,
          );
        }
        return pickSites(data, { host: "gitlab", user: found.user, sites: found.sites }, tokens);
      } catch (error) {
        if (error instanceof gl.GitLabError) {
          return problemPage("GitLab didn't sign you in", "Go back to Claude and connect Goodfellow again.", 502);
        }
        throw error;
      }
    }

    async function bitbucketCallbackRoute(): Promise<Response> {
      if (!bitbucket) return problemPage("Not set up", "This connector doesn't sign in with Bitbucket.", 404);
      const state = await (await sealer()).open<{ request: string }>("bitbucket-state", url.searchParams.get("state"));
      const data = state && (await openRequest(state.request));
      if (!state || !data) return expired();
      const code = url.searchParams.get("code");
      if (!code) return backWithError(data, "access_denied", "Bitbucket didn't sign the person in.");
      try {
        const tokens = await bb.exchangeCode(bitbucket, code, now());
        const found = await bb.signedInSites(bitbucket, tokens.access);
        if (!found.sites.length) {
          return problemPage(
            "No sites to work on",
            `The Bitbucket account ${found.user.login} can't publish to any repository. Ask the site's owner to give you Write or Admin, then connect again.`,
          );
        }
        return pickSites(data, { host: "bitbucket", user: found.user, sites: found.sites }, tokens);
      } catch (error) {
        if (error instanceof bb.BitbucketError) {
          return problemPage("Bitbucket didn't sign you in", "Go back to Claude and connect Goodfellow again.", 502);
        }
        throw error;
      }
    }

    async function confirm(): Promise<Response> {
      const body = await form().catch(() => new URLSearchParams());
      const picker = await (await sealer()).open<PickerData>("picker", body.get("picker"));
      if (!picker || cookies(request).get(COOKIE) !== picker.request.nonce) return expired();
      const chosen = new Set(body.getAll("site"));
      const { connection, request: data } = picker;
      const sites = connection.sites.filter((site) => chosen.has(site.repo)).slice(0, MAX_SITES);
      if (!sites.length) {
        return page("Which sites?", `<p>Choose at least one site. Go back to choose again.</p>`, { status: 400 });
      }
      const code = await (await sealer()).seal(
        "code",
        {
          clientId: data.clientId,
          redirectUri: data.redirectUri,
          challenge: data.challenge,
          connection: { ...connection, sites } as Connection,
          ...(picker.tokens && { tokens: picker.tokens }),
        } satisfies CodeData,
        CODE_LIFETIME,
      );
      const target = new URL(data.redirectUri);
      target.searchParams.set("code", code);
      if (data.state) target.searchParams.set("state", data.state);
      target.searchParams.set("iss", origin);
      return new Response(null, {
        status: 303,
        headers: {
          location: target.toString(),
          "cache-control": "no-store",
          "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    async function issueTokens(
      grant: string,
      generation: number,
      clientId: string,
      connection: Connection,
      tokens?: HostTokens,
    ) {
      const lifetime = tokens ? Math.min(ACCESS_LIFETIME, tokens.expiresAt - now() - 60_000) : ACCESS_LIFETIME;
      const seal = await sealer();
      const access = await seal.seal(
        "access",
        { grant, connection, ...(tokens && { token: tokens.access }) } satisfies AccessData,
        Math.max(lifetime, 60_000),
      );
      const refresh = await seal.seal(
        "refresh",
        { grant, generation, clientId, connection, ...(tokens && { token: tokens.refresh }) } satisfies RefreshData,
        REFRESH_LIFETIME,
      );
      return json({
        access_token: access,
        token_type: "Bearer",
        expires_in: Math.floor(Math.max(lifetime, 60_000) / 1000),
        refresh_token: refresh,
        scope: "sites",
      });
    }

    async function token(): Promise<Response> {
      if (!grants) throw new OAuthError("temporarily_unavailable", "The connector has no database.", 503);
      const body = await form();
      const clientId = body.get("client_id") ?? "";
      const grantType = body.get("grant_type");
      if (grantType === "authorization_code") {
        const data = await (await sealer()).open<CodeData>("code", body.get("code"));
        if (!data || data.clientId !== clientId || data.redirectUri !== body.get("redirect_uri")) {
          throw new OAuthError("invalid_grant", "The code isn't valid, or has expired.");
        }
        if ((await challengeFor(body.get("code_verifier") ?? "")) !== data.challenge) {
          throw new OAuthError("invalid_grant", "The code verifier doesn't match.");
        }
        const grant = await sha256(body.get("code") ?? "");
        if (!(await grants.create(grant, now() + REFRESH_LIFETIME, now()))) {
          // A code used twice: whoever has the first tokens loses them too, as OAuth asks.
          await grants.revoke(grant);
          throw new OAuthError("invalid_grant", "The code has been used already.");
        }
        return issueTokens(grant, 1, clientId, data.connection, data.tokens);
      }
      if (grantType === "refresh_token") {
        const data = await (await sealer()).open<RefreshData>("refresh", body.get("refresh_token"));
        if (!data || data.clientId !== clientId) {
          throw new OAuthError("invalid_grant", "The refresh token isn't valid, or has expired.");
        }
        const rotation = await grants.rotate(data.grant, data.generation, now() + REFRESH_LIFETIME, now());
        if (!rotation) {
          // An old refresh token: someone else may have it, so the connection ends.
          await grants.revoke(data.grant);
          throw new OAuthError(
            "invalid_grant",
            "The refresh token has been used already, or the connection has ended.",
          );
        }
        let tokens: HostTokens | undefined;
        const { host } = data.connection;
        if (host !== "github") {
          const refresh = data.token ?? data.gitlab;
          const name = host === "gitlab" ? "GitLab" : "Bitbucket";
          if (!refresh || !(host === "gitlab" ? gitlab : bitbucket)) {
            throw new OAuthError("invalid_grant", `This connector doesn't sign in with ${name}.`);
          }
          try {
            tokens =
              host === "gitlab" && gitlab
                ? await gl.refreshTokens(gitlab, refresh, gitlabCallback, now())
                : await bb.refreshTokens(bitbucket as bb.BitbucketConfig, refresh, now());
          } catch (error) {
            if ((error instanceof gl.GitLabError || error instanceof bb.BitbucketError) && error.status === 0) {
              throw new OAuthError("temporarily_unavailable", `${name} couldn't be reached.`, 503);
            }
            // Asked again with the refresh token before the current one: the tokens already given still work.
            if (rotation === "rotated") await grants.revoke(data.grant);
            throw new OAuthError("invalid_grant", `${name} didn't renew the sign-in. Connect again.`);
          }
        }
        return issueTokens(data.grant, data.generation + 1, clientId, data.connection, tokens);
      }
      throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }

    async function revokeRoute(): Promise<Response> {
      const body = await form();
      const given = body.get("token");
      // Either of a connection's tokens ends it (RFC 7009 lets the client send either).
      const data =
        (await (await sealer()).open<RefreshData>("refresh", given)) ??
        (await (await sealer()).open<AccessData>("access", given));
      if (data && grants) await grants.revoke(data.grant);
      // RFC 7009: the same answer whatever the token was.
      return json({});
    }

    async function mcp(): Promise<Response> {
      if (request.method !== "POST") {
        return json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }, 405, {
          allow: "POST",
        });
      }
      const header = request.headers.get("authorization") ?? "";
      const given = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
      const access = given ? await (await sealer()).open<AccessData>("access", given) : undefined;
      if (!access) {
        return json({ error: "invalid_token", error_description: "Connect Goodfellow again." }, 401, {
          "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"${given ? ', error="invalid_token"' : ""}`,
        });
      }
      const { connection } = access;
      const reconnect = () =>
        json({ error: "invalid_token", error_description: "Connect Goodfellow again." }, 401, {
          "www-authenticate": `Bearer resource_metadata="${resourceMetadata}", error="invalid_token"`,
        });
      // A connection that's been revoked, or whose code or refresh token was used twice, ends at once, not when its access token lapses.
      if (!grants || !(await grants.active(access.grant, now()))) return reconnect();
      let end = async () => {};
      let backend: (site: string) => Promise<GitBackend>;
      if (connection.host === "github") {
        if (!app) return reconnect();
        const opened = gh.githubSites(github, app, connection.user, now());
        end = opened.end;
        backend = async (id) => {
          const site = connection.sites.find((candidate) => candidate.id === id);
          if (!site) throw new ToolError(`Claude wasn't connected to ${id}. Connect again to choose it.`);
          return opened.backend(site);
        };
      } else if (connection.host === "gitlab") {
        const config = gitlab;
        const token = access.token ?? access.gitlab;
        if (!config || !token) return reconnect();
        backend = async (id) => {
          const site = connection.sites.find((candidate) => candidate.id === id);
          if (!site) throw new ToolError(`Claude wasn't connected to ${id}. Connect again to choose it.`);
          return gl.gitlabBackend(config, site, connection.user, token);
        };
      } else {
        const config = bitbucket;
        const token = access.token;
        if (!config || !token) return reconnect();
        backend = async (id) => {
          const site = connection.sites.find((candidate) => candidate.id === id);
          if (!site) throw new ToolError(`Claude wasn't connected to ${id}. Connect again to choose it.`);
          return bb.bitbucketBackend(config, site, connection.user, token);
        };
      }
      const screenshots = options.screenshots
        ? await options.screenshots(env)
        : env.BROWSER
          ? (await import("./screenshots.js")).browserScreenshots(env.BROWSER)
          : undefined;
      const server = createGoodfellowServer({
        sites: async () => connection.sites.map((site) => ({ id: site.id })),
        backend,
        fetch: fetcher,
        ...(screenshots && { screenshots }),
      });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        const response = await transport.handleRequest(request);
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(cors)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      } finally {
        const done = end().finally(() => server.close());
        if (context) context.waitUntil(done);
        else await done;
      }
    }

    try {
      if (path === "/health") {
        return json({
          ok: true,
          github: Boolean(app),
          gitlab: Boolean(gitlab),
          bitbucket: Boolean(bitbucket),
          database: Boolean(grants),
          screenshots: Boolean(env.BROWSER),
        });
      }
      if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") {
        return json({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          bearer_methods_supported: ["header"],
          scopes_supported: ["sites"],
          resource_name: "Goodfellow",
        });
      }
      if (path === "/.well-known/oauth-authorization-server") {
        return json({
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          revocation_endpoint: `${origin}/revoke`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          revocation_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["sites"],
          client_id_metadata_document_supported: true,
          authorization_response_iss_parameter_supported: true,
        });
      }
      if (path === "/mcp") return await mcp();
      if (path === "/register" && request.method === "POST") {
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(await request.text()) as Record<string, unknown>;
        } catch {
          return json(
            { error: "invalid_client_metadata", error_description: "Send the client's details as JSON." },
            400,
          );
        }
        try {
          return json(await registerClient(await sealer(), body ?? {}, now()), 201);
        } catch (error) {
          if (error instanceof ClientError) {
            const code = /redirect/i.test(error.message) ? "invalid_redirect_uri" : "invalid_client_metadata";
            return json({ error: code, error_description: error.message }, 400);
          }
          throw error;
        }
      }
      if (path === "/token" && request.method === "POST") return await token();
      if (path === "/revoke" && request.method === "POST") return await revokeRoute();
      if (path === "/authorize" && request.method === "GET") return await authorize();
      if (path === "/connect/github" && request.method === "GET") {
        const sealed = url.searchParams.get("request");
        if (!app || !(await openRequest(sealed))) return expired();
        return redirect(gh.authorizeUrl(github, app, githubCallback, sealed ?? ""));
      }
      if (path === "/connect/gitlab" && request.method === "GET") {
        const sealed = url.searchParams.get("request");
        if (!gitlab || !(await openRequest(sealed))) return expired();
        const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
        const state = await (await sealer()).seal("gitlab-state", { request: sealed, verifier }, REQUEST_LIFETIME);
        return redirect(gl.authorizeUrl(gitlab, gitlabCallback, state, await challengeFor(verifier)));
      }
      if (path === "/connect/bitbucket" && request.method === "GET") {
        const sealed = url.searchParams.get("request");
        if (!bitbucket || !(await openRequest(sealed))) return expired();
        const state = await (await sealer()).seal("bitbucket-state", { request: sealed }, REQUEST_LIFETIME);
        return redirect(bb.authorizeUrl(bitbucket, state));
      }
      if (path === "/connect/cancel" && request.method === "GET") {
        const data = await openRequest(url.searchParams.get("request"));
        if (!data) return expired();
        return backWithError(data, "access_denied", "The person didn't connect Goodfellow.");
      }
      if (path === "/connect/github/callback" && request.method === "GET") return await githubCallbackRoute();
      if (path === "/connect/gitlab/callback" && request.method === "GET") return await gitlabCallbackRoute();
      if (path === "/connect/bitbucket/callback" && request.method === "GET") return await bitbucketCallbackRoute();
      if (path === "/connect/confirm" && request.method === "POST") return await confirm();
      if (path === "/" && request.method === "GET") {
        return page(
          "Goodfellow for Claude",
          `<p>This is Goodfellow's connector for Claude. To use it, add <strong>${origin}/mcp</strong> to Claude as a custom connector.</p>`,
        );
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof OAuthError) {
        return json({ error: error.code, error_description: error.message }, error.status);
      }
      if (error instanceof Error && error.message.startsWith("SESSION_KEY")) {
        return json({ error: "temporarily_unavailable", error_description: "The connector isn't set up yet." }, 503);
      }
      // Never the error itself, which could name a token.
      console.error("The connector couldn't answer:", error instanceof Error ? error.name : "unknown error");
      return json({ error: "server_error", error_description: "Something went wrong. Try again." }, 500);
    }
  }

  return { fetch: handle };
}
