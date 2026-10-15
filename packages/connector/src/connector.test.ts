import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blocks } from "@goodfellow-cms/blocks";
import { type FakeGitHubApp, fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import type { Screenshotter } from "@goodfellow-cms/mcp";
import { describeSite } from "@goodfellow-cms/react";
import { base64UrlEncode, challengeFor } from "@goodfellow-cms/worker/seal";
import { testKeyPair } from "@goodfellow-cms/worker/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { type ConnectorEnv, createConnector } from "./connector.js";
import { PERMISSIONS } from "./github.js";
import { memoryGrants } from "./grants.js";

const CONNECTOR = "https://claude.goodfellow.example";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const SITE = "https://parish.example";
const starter = resolve(import.meta.dirname, "../../../templates/starter");

function starterFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(join(starter, "content"), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name)
      .slice(starter.length + 1)
      .split("\\")
      .join("/");
    files[path] = readFileSync(join(starter, path), "utf8");
  }
  const site = JSON.parse(files["content/site.json"] ?? "{}");
  files["content/site.json"] = `${JSON.stringify({ ...site, url: SITE }, null, 2)}\n`;
  return files;
}

const key = await testKeyPair();
const description = describeSite({ blocks });

function setup(options: { installed?: boolean; screenshots?: Screenshotter; push?: boolean } = {}) {
  const app: FakeGitHubApp = {
    id: "301",
    slug: "goodfellow-for-claude",
    clientId: "Iv1.claude",
    clientSecret: "claude-secret",
    publicKey: key.publicKey,
    permissions: { contents: "write", pull_requests: "write", metadata: "read" },
    installations:
      options.installed === false
        ? []
        : [{ id: 31, account: "parish", accountType: "Organization", repositories: ["parish/site"] }],
  };
  const github = fakeGitHub({
    repo: "parish/site",
    files: starterFiles(),
    tokens: { maria: { login: "maria", name: "Maria", id: 4242, push: options.push } },
    orgs: ["parish"],
    apps: [app],
  });
  const gitlab = fakeGitLab({
    project: "parish/site",
    url: "https://gitlab.example",
    files: starterFiles(),
    oauth: { clientId: "gl-client", user: { username: "maria", name: "Maria" } },
  });
  const documents = new Map<string, unknown>();
  const outgoing: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const { host, pathname } = new URL(request.url);
    outgoing.push(request.url);
    if (host === "api.github.com" || host === "github.com") return github.fetch(request);
    if (host === "gitlab.example") return gitlab.fetch(request);
    if (request.url === `${SITE}/goodfellow-site.json`) return Response.json(description);
    if (documents.has(request.url)) return Response.json(documents.get(request.url));
    return new Response(`No ${host}${pathname}`, { status: 404 });
  }) as typeof fetch;
  const grants = memoryGrants();
  let clock = Date.now();
  const connector = createConnector({
    fetch: fetcher,
    now: () => clock,
    grants: () => grants,
    screenshots: async () => options.screenshots,
  });
  const env: ConnectorEnv = {
    SESSION_KEY: base64UrlEncode(crypto.getRandomValues(new Uint8Array(32))),
    GITHUB_APP_ID: app.id,
    GITHUB_APP_SLUG: app.slug,
    GITHUB_CLIENT_ID: app.clientId,
    GITHUB_CLIENT_SECRET: app.clientSecret,
    GITHUB_PRIVATE_KEY: key.pem,
    GITLAB_URL: "https://gitlab.example",
    GITLAB_CLIENT_ID: "gl-client",
    GITLAB_CLIENT_SECRET: "gl-secret",
  };

  /** A browser: it keeps the connector's cookies. */
  const jar = new Map<string, string>();
  async function visit(path: string, init: RequestInit = {}) {
    const cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await connector.fetch(
      new Request(path.startsWith("http") ? path : `${CONNECTOR}${path}`, {
        ...init,
        headers: { ...(cookie && { cookie }), ...(init.headers as Record<string, string>) },
      }),
      env,
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair = ""] = header.split(";");
      const [name = "", value = ""] = pair.split("=");
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    return response;
  }
  const post = (path: string, body: Record<string, string | string[]>) => {
    const form = new URLSearchParams();
    for (const [name, value] of Object.entries(body)) for (const item of [value].flat()) form.append(name, item);
    return visit(path, {
      method: "POST",
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  };

  async function register(redirectUri = CLAUDE) {
    const response = await visit("/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirectUri] }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { client_id: string }).client_id;
  }

  /** Claude's side of `/authorize`, up to the page asking where the site is. */
  async function startAuthorize(clientId: string, redirectUri = CLAUDE) {
    const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: "S256",
      state: "claude-state",
      resource: `${CONNECTOR}/mcp`,
    });
    const response = await visit(`/authorize?${query}`);
    const html = await response.text();
    return {
      response,
      html,
      verifier,
      link: (host: string) => html.match(new RegExp(`href="(/connect/${host}\\?request=[^"]+)"`))?.[1] ?? "",
    };
  }

  /** Signs in with GitHub as `login` and comes back to the page choosing sites. */
  async function signInWithGitHub(clientId: string, login = "maria") {
    const started = await startAuthorize(clientId);
    const toGitHub = await visit(started.link("github"));
    expect(toGitHub.status).toBe(302);
    const authorize = new URL(toGitHub.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${CONNECTOR}/connect/github/callback`);
    const code = github.authorize(login, authorize.searchParams.get("client_id") ?? "");
    const callback = await visit(
      `/connect/github/callback?${new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" })}`,
    );
    return { ...started, callback, page: await callback.text(), state: authorize.searchParams.get("state") ?? "" };
  }

  async function allow(page: string, sites: string[]) {
    const picker = page.match(/name="picker" value="([^"]+)"/)?.[1] ?? "";
    return post("/connect/confirm", { picker, site: sites });
  }

  async function exchange(clientId: string, code: string, verifier: string) {
    return post("/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE,
      client_id: clientId,
      code_verifier: verifier,
    });
  }

  async function connectGitHub() {
    const clientId = await register();
    const { page, verifier } = await signInWithGitHub(clientId);
    const back = new URL((await allow(page, ["parish/site"])).headers.get("location") ?? "");
    const response = await exchange(clientId, back.searchParams.get("code") ?? "", verifier);
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as { access_token: string; refresh_token: string; expires_in: number };
    return { clientId, tokens };
  }

  async function mcp(access: string) {
    const client = new Client({ name: "test", version: "1" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${CONNECTOR}/mcp`), {
        fetch: (input, init) => connector.fetch(new Request(input, init), env),
        requestInit: { headers: { authorization: `Bearer ${access}` } },
      }),
    );
    async function call(name: string, args: Record<string, unknown> = {}) {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      };
      const text = result.content[0]?.text ?? "";
      return { isError: result.isError === true, text, json: () => JSON.parse(text) };
    }
    return { client, call };
  }

  return {
    github,
    gitlab,
    grants,
    documents,
    outgoing,
    env,
    connector,
    jar,
    visit,
    post,
    register,
    startAuthorize,
    signInWithGitHub,
    allow,
    exchange,
    connectGitHub,
    mcp,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe("finding how to connect", () => {
  it("answers Claude's first request with where to sign in", async () => {
    const { visit } = setup();
    const response = await visit("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${CONNECTOR}/.well-known/oauth-protected-resource/mcp"`,
    );
    const resource = await (await visit("/.well-known/oauth-protected-resource/mcp")).json();
    expect(resource).toMatchObject({ resource: `${CONNECTOR}/mcp`, authorization_servers: [CONNECTOR] });
    const server = await (await visit("/.well-known/oauth-authorization-server")).json();
    expect(server).toMatchObject({
      issuer: CONNECTOR,
      authorization_endpoint: `${CONNECTOR}/authorize`,
      token_endpoint: `${CONNECTOR}/token`,
      registration_endpoint: `${CONNECTOR}/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
    });
  });

  it("registers only clients going back to https:// addresses or apps on this computer", async () => {
    const { visit } = setup();
    for (const uri of ["http://claude.example/callback", "javascript:alert(1)", "https://claude.example/#x"]) {
      const response = await visit("/register", {
        method: "POST",
        body: JSON.stringify({ redirect_uris: [uri] }),
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid_redirect_uri" });
    }
    const local = await visit("/register", {
      method: "POST",
      body: JSON.stringify({ client_name: "Claude Code", redirect_uris: ["http://localhost:3118/callback"] }),
      headers: { "content-type": "application/json" },
    });
    expect(local.status).toBe(201);
  });
});

describe("connecting with GitHub", () => {
  it("lets the person choose sites, and gives Claude tokens for those only", async () => {
    const { github, register, startAuthorize, signInWithGitHub, allow, exchange, jar } = setup();
    const clientId = await register();
    const { response, html } = await startAuthorize(clientId);
    // A page asking which host, which says where Claude will go back to.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(html).toContain("Sign in with GitHub");
    expect(html).toContain("Sign in with GitLab");
    expect(html).toContain("claude.ai");

    const { page, verifier, callback } = await signInWithGitHub(clientId);
    expect(callback.status).toBe(200);
    expect(page).toContain('value="parish/site"');
    // The form may go on to Claude's address, and nowhere else.
    expect(callback.headers.get("content-security-policy")).toContain("form-action 'self' https://claude.ai");
    // The person's own GitHub token was revoked once it had shown who they are.
    const own = github.issued.filter((item) => item.kind === "user");
    expect(own).toHaveLength(1);
    expect(own.every((item) => item.revoked)).toBe(true);

    const allowed = await allow(page, ["parish/site"]);
    expect(allowed.status).toBe(303);
    const back = new URL(allowed.headers.get("location") ?? "");
    expect(back.origin + back.pathname).toBe(CLAUDE);
    expect(back.searchParams.get("state")).toBe("claude-state");
    expect(back.searchParams.get("iss")).toBe(CONNECTOR);
    expect(jar.size).toBe(0);
    const code = back.searchParams.get("code") ?? "";

    // Only with the verifier Claude kept.
    expect((await exchange(clientId, code, "x".repeat(43))).status).toBe(400);
    const tokens = await exchange(clientId, code, verifier);
    expect(tokens.status).toBe(200);
    const body = (await tokens.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(JSON.stringify(body)).not.toContain(own[0]?.token ?? "none");
  });

  it("refuses a code used twice, and ends the connection it made", async () => {
    const { register, signInWithGitHub, allow, exchange, post } = setup();
    const clientId = await register();
    const { page, verifier } = await signInWithGitHub(clientId);
    const code =
      new URL((await allow(page, ["parish/site"])).headers.get("location") ?? "").searchParams.get("code") ?? "";
    const first = (await (await exchange(clientId, code, verifier)).json()) as { refresh_token: string };
    const again = await exchange(clientId, code, verifier);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ error: "invalid_grant" });
    const refresh = await post("/token", {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
      client_id: clientId,
    });
    expect(refresh.status).toBe(400);
  });

  it("refreshes once with each refresh token", async () => {
    const { connectGitHub, post } = setup();
    const { clientId, tokens } = await connectGitHub();
    const refresh = (token: string) =>
      post("/token", { grant_type: "refresh_token", refresh_token: token, client_id: clientId });
    const next = await refresh(tokens.refresh_token);
    expect(next.status).toBe(200);
    const renewed = (await next.json()) as { refresh_token: string; access_token: string };
    expect(renewed.refresh_token).not.toBe(tokens.refresh_token);
    // The old one again: someone else may have it, so the connection ends, and the new one stops working too.
    expect((await refresh(tokens.refresh_token)).status).toBe(400);
    expect((await refresh(renewed.refresh_token)).status).toBe(400);
    // Another client can't use it.
    expect(
      (await post("/token", { grant_type: "refresh_token", refresh_token: renewed.refresh_token, client_id: "other" }))
        .status,
    ).toBe(400);
  });

  it("only finishes in the browser that started", async () => {
    const { register, signInWithGitHub, jar, allow } = setup();
    const clientId = await register();
    const started = await signInWithGitHub(clientId);
    jar.clear();
    const allowed = await allow(started.page, ["parish/site"]);
    expect(allowed.status).toBe(400);
    expect(allowed.headers.get("location")).toBeNull();
    expect(await allowed.text()).toContain("Start again from Claude");
  });

  it("never sends the person anywhere the client didn't register", async () => {
    const { register, startAuthorize } = setup();
    const clientId = await register();
    const { response, html } = await startAuthorize(clientId, "https://evil.example/callback");
    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    expect(html).toContain("Unknown address");
    const unknown = await startAuthorize("not-a-client");
    expect(unknown.html).toContain("Unknown app");
  });

  it("asks an owner to install the app when it isn't on any site the person edits", async () => {
    const { register, signInWithGitHub } = setup({ installed: false });
    const clientId = await register();
    const { page, state } = await signInWithGitHub(clientId);
    expect(page).toContain("Install Goodfellow for Claude");
    expect(page).toContain(`https://github.com/apps/goodfellow-for-claude/installations/new?state=${state}`);
  });

  it("accepts clients that describe themselves in a document", async () => {
    const { documents, startAuthorize } = setup();
    const id = "https://client.example/oauth/client.json";
    documents.set(id, { client_id: id, client_name: "Claude", redirect_uris: [CLAUDE] });
    const { html } = await startAuthorize(id);
    expect(html).toContain("Sign in with GitHub");
    documents.set(id, { client_id: "https://elsewhere.example/client.json", redirect_uris: [CLAUDE] });
    expect((await startAuthorize(id)).html).toContain("Unknown app");
  });
});

describe("working on sites", () => {
  it("works on the chosen sites with tokens that last only as long as each request", async () => {
    const { github, connectGitHub, mcp } = setup();
    const { tokens } = await connectGitHub();
    const { client, call } = await mcp(tokens.access_token);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["get_site", "save_page", "publish"]));
    expect(tools.map((tool) => tool.name)).not.toContain("screenshot");

    expect((await call("list_sites")).json()).toEqual([{ site: "github:parish/site" }]);
    const site = (await call("get_site", { site: "github:parish/site" })).json();
    expect(site).toMatchObject({ address: SITE });

    const saved = (
      await call("save_page", {
        site: "github:parish/site",
        address: "/about",
        blocks: [
          {
            type: "Heading",
            id: "b1",
            parent: null,
            slot: null,
            props: { text: "About St. Joseph", level: "h1", align: "left" },
          },
        ],
      })
    ).json();
    expect((await call("publish", { site: "github:parish/site", draft: saved.draft, message: "About" })).isError).toBe(
      false,
    );
    // Commits name the person, not the app.
    expect([...github.commitAuthors.values()]).toContainEqual(
      expect.objectContaining({ name: "Maria", email: "4242+maria@users.noreply.github.com" }),
    );

    const installation = github.issued.filter((item) => item.kind === "installation");
    expect(installation.length).toBeGreaterThan(0);
    for (const item of installation) {
      expect(item).toMatchObject({
        app: "goodfellow-for-claude",
        repositories: ["parish/site"],
        permissions: PERMISSIONS,
      });
      expect(item.revoked).toBe(true);
    }

    expect((await call("get_site", { site: "github:parish/other" })).text).toContain(
      "wasn't connected to github:parish/other",
    );
  });

  it("stops when the person can't edit the site any more", async () => {
    const { github, connectGitHub, mcp } = setup();
    const { tokens } = await connectGitHub();
    github.collaborators.set("maria", "read");
    const { call } = await mcp(tokens.access_token);
    const result = await call("get_site", { site: "github:parish/site" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("can't edit parish/site any more");
  });

  it("refuses tokens that have expired", async () => {
    const { connectGitHub, visit, tick } = setup();
    const { tokens } = await connectGitHub();
    tick(3_601_000);
    const response = await visit("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("takes screenshots where it can", async () => {
    const taken: string[] = [];
    const { connectGitHub, mcp } = setup({
      screenshots: {
        async take({ url }) {
          taken.push(url);
          return new Uint8Array([137, 80, 78, 71]);
        },
      },
    });
    const { tokens } = await connectGitHub();
    const { client } = await mcp(tokens.access_token);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("screenshot");
  });
});

describe("connecting with GitLab", () => {
  it("keeps the person's GitLab tokens sealed in Claude's, and renews them with Claude's", async () => {
    const { gitlab, register, startAuthorize, visit, allow, exchange, post, mcp } = setup();
    const clientId = await register();
    const started = await startAuthorize(clientId);
    const toGitLab = await visit(started.link("gitlab"));
    const authorize = new URL(toGitLab.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://gitlab.example/oauth/authorize");
    expect(authorize.searchParams.get("scope")).toBe("api");
    const callback = await visit(gitlab.authorize(authorize.toString()));
    const page = await callback.text();
    expect(page).toContain('value="parish/site"');
    const code =
      new URL((await allow(page, ["parish/site"])).headers.get("location") ?? "").searchParams.get("code") ?? "";
    const tokens = (await (await exchange(clientId, code, started.verifier)).json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.access_token).not.toMatch(/oauth-access/);

    const { call } = await mcp(tokens.access_token);
    expect((await call("get_site", { site: "gitlab:parish/site" })).json()).toMatchObject({ address: SITE });

    const renewed = await post("/token", {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });
    expect(renewed.status).toBe(200);
    const next = (await renewed.json()) as { access_token: string };
    expect((await (await mcp(next.access_token)).call("get_site", { site: "gitlab:parish/site" })).isError).toBe(false);
  });
});
