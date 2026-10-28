/** A fake GitHub with Goodfellow's two apps installed on a site, and the worker in front of it, for tests. */
import { type FakeGitHubApp, fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect } from "vitest";
import { base64UrlEncode, challengeFor } from "./seal.js";
import { testSignIn } from "./testing.js";
import { createWorker, type WorkerEnv } from "./worker.js";

export const WORKER = "https://sign-in.example";
export const SITE = "https://parish.example";

export function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

const kit = await testSignIn({ setupOrigins: ["https://setup.example"] });
export const editKey = kit.keys.edit;
const baseEnv: WorkerEnv = kit.env;

export function setup(
  options: {
    url?: string;
    installed?: boolean;
    env?: Partial<WorkerEnv>;
    /** More of the parish's repositories both apps are installed on, such as the site's code repository. */
    repositories?: string[];
    /** The owners' app as it was before it asked for the Secrets permission. */
    withoutSecrets?: boolean;
    /** The everyday app as it was before it asked for the Checks, Commit statuses and Pull requests permissions. */
    withoutChecks?: boolean;
    /** The admin address the site's build names, in the `goodfellow-site.json` the Site address serves. */
    admin?: string;
    /** The token broker the site's build names there. */
    broker?: string;
    /** The site's other copies, such as staging, that its build names there. */
    copies?: string[];
    /** GitHub fails to give the site's settings, as when it's having trouble. */
    settingsFail?: boolean;
  } = {},
) {
  const repositories = ["parish/site", ...(options.repositories ?? [])];
  const {
    checks: _checks,
    statuses: _statuses,
    pull_requests: _pullRequests,
    ...olderEditPermissions
  } = kit.apps.edit.permissions;
  const editApp: FakeGitHubApp = {
    ...kit.apps.edit,
    ...(options.withoutChecks && { permissions: olderEditPermissions }),
    installations: options.installed === false ? [] : [{ id: 11, account: "parish", repositories }],
  };
  const { secrets: _, ...olderPermissions } = kit.apps.owner.permissions;
  const ownerApp: FakeGitHubApp = {
    ...kit.apps.owner,
    ...(options.withoutSecrets && { permissions: olderPermissions }),
    installations: [
      { id: 21, account: "parish", accountType: "Organization", repositories },
      { id: 22, account: "maria", repositories: [] },
    ],
  };
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      "content/site.json": JSON.stringify({
        version: 1,
        title: "St. Joseph",
        ...(options.url !== "" && { url: options.url ?? `${SITE}/` }),
      }),
      "content/pages/index.json": "{}",
    },
    tokens: {
      maria: { login: "maria", name: "Maria", id: 4242 },
      reader: { login: "reader", push: false },
      olivia: { login: "olivia", admin: true },
    },
    orgs: ["parish"],
    apps: [editApp, ownerApp],
  });
  let clock = Date.now();
  // The site itself, at its address, serves its description, naming its admin address if it has one.
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (options.settingsFail && url.includes("/contents/content/site.json")) {
      return new Response("Server error", { status: 500 });
    }
    if (url === `${SITE}/goodfellow-site.json`) {
      if (!options.admin && !options.broker && !options.copies) return new Response("Not found", { status: 404 });
      return Response.json({
        version: 1,
        ...(options.admin && { admin: { url: options.admin } }),
        ...(options.broker && { broker: { url: options.broker } }),
        ...(options.copies && { copies: options.copies }),
      });
    }
    return fake.fetch(input, init);
  };
  const worker = createWorker({ fetch, now: () => clock });
  const env = { ...baseEnv, ...options.env };
  const call = (path: string, init: RequestInit & { origin?: string } = {}) =>
    worker.fetch(
      new Request(`${WORKER}${path}`, {
        ...init,
        headers: { ...(init.origin && { origin: init.origin }), ...(init.headers as Record<string, string>) },
      }),
      env,
    );
  const post = (path: string, body: unknown, origin = SITE) =>
    call(path, { method: "POST", body: JSON.stringify(body), origin, headers: { "content-type": "text/plain" } });

  /** Continues from the page an owner's sign-in shows first, as the person would, with the cookie it set. */
  async function confirmed(response: Response): Promise<Response> {
    if (response.status !== 200) return response;
    const html = await response.text();
    const next = /href="([^"]+)"/.exec(html)?.[1]?.replaceAll("&#38;", "&") ?? "";
    const set = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    return call(next.replace(WORKER, ""), { headers: { cookie: set } });
  }

  /** Goes through GitHub's sign-in as `login`, as the admin panel's redirect does, and returns the grant it comes back with. */
  async function redirect(login: string, purpose = "edit", back = `${SITE}/admin/#/pages`) {
    const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const query = new URLSearchParams({
      purpose,
      ...(purpose !== "setup" && { repo: "parish/site" }),
      return: back,
      challenge: await challengeFor(verifier),
      remember: "1",
    });
    const start = await confirmed(await call(`/github/start?${query}`));
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${WORKER}/github/callback`);
    const clientId = authorize.searchParams.get("client_id") ?? "";
    const code = fake.authorize(login, clientId);
    const callback = await call(
      `/github/callback?${new URLSearchParams({ code, state: authorize.searchParams.get("state") ?? "" })}`,
    );
    expect(callback.status).toBe(302);
    return { verifier, clientId, back: new URL(callback.headers.get("location") ?? "") };
  }

  async function signIn(login = "maria", purpose = "edit", extra: Record<string, unknown> = {}) {
    const { verifier, back } = await redirect(login, purpose);
    const grant = back.searchParams.get("goodfellow_sign_in");
    const response = await post("/github/session", { grant, verifier, ...extra });
    return { response, body: (await response.json()) as Record<string, unknown> & { session: string; token: string } };
  }

  return {
    fake,
    worker,
    env,
    call,
    post,
    redirect,
    confirmed,
    signIn,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}
