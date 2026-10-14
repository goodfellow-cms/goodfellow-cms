/** A fake GitHub with Goodfellow's two apps installed on a site, and the worker in front of it, for tests. */
import { type FakeGitHubApp, fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect } from "vitest";
import { memoryLimiter } from "./limits.js";
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

export function setup(options: { url?: string; installed?: boolean; env?: Partial<WorkerEnv> } = {}) {
  const editApp: FakeGitHubApp = {
    ...kit.apps.edit,
    installations: options.installed === false ? [] : [{ id: 11, account: "parish", repositories: ["parish/site"] }],
  };
  const ownerApp: FakeGitHubApp = {
    ...kit.apps.owner,
    installations: [
      { id: 21, account: "parish", accountType: "Organization", repositories: ["parish/site"] },
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
  const worker = createWorker({ fetch: fake.fetch, limiter: memoryLimiter(() => clock), now: () => clock });
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
    const start = await call(`/github/start?${query}`);
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

  async function signIn(login = "maria", purpose = "edit") {
    const { verifier, back } = await redirect(login, purpose);
    const grant = back.searchParams.get("goodfellow_sign_in");
    const response = await post("/github/session", { grant, verifier });
    return { response, body: (await response.json()) as Record<string, unknown> & { session: string; token: string } };
  }

  return {
    fake,
    worker,
    env,
    call,
    post,
    redirect,
    signIn,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}
