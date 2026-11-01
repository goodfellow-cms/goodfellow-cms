import { describe, expect, it } from "vitest";
import { appName, isConfigured, parseAddresses, TOKEN_TEMPLATE_URL } from "./self-setup.js";
import { createWorker, type WorkerEnv } from "./worker.js";

const WORKER = "https://sign-in.parish.workers.dev";
const ACCOUNT = "a".repeat(32);
const OTHER = "b".repeat(32);
const TOKEN = "cf-token-for-maria";

/** A fake Cloudflare account holding the worker, and GitHub's manifest conversions, behind one `fetch`. */
function fakes() {
  const secrets: Record<string, string> = {};
  const requests: string[] = [];
  let made = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.hostname === "api.cloudflare.com") {
      if (auth !== `Bearer ${TOKEN}`)
        return Response.json({ success: false, errors: [{ code: 1000 }] }, { status: 403 });
      if (url.pathname === "/client/v4/accounts") {
        return Response.json({ success: true, result: [{ id: OTHER }, { id: ACCOUNT }] });
      }
      if (url.pathname === `/client/v4/accounts/${ACCOUNT}/workers/scripts/sign-in/settings`) {
        return Response.json({ success: true, result: {} });
      }
      if (url.pathname === `/client/v4/accounts/${ACCOUNT}/workers/scripts/sign-in/secrets` && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { name: string; text: string; type: string };
        expect(body.type).toBe("secret_text");
        secrets[body.name] = body.text;
        return Response.json({ success: true, result: { name: body.name } });
      }
      return Response.json({ success: false }, { status: 404 });
    }
    if (url.hostname === "api.github.com" && url.pathname.startsWith("/app-manifests/")) {
      made += 1;
      return Response.json(
        {
          id: 100 + made,
          slug: `goodfellow-parish-${made}`,
          client_id: `Iv1.${made}`,
          client_secret: `secret-${made}`,
          pem: `-----BEGIN RSA PRIVATE KEY-----${made}`,
          owner: { login: "maria", type: "User" },
        },
        { status: 201 },
      );
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, secrets, requests };
}

function cookieOf(response: Response): string | undefined {
  const header = response.headers.get("set-cookie") ?? "";
  return /__Host-goodfellow_setup=([^;]*)/.exec(header)?.[1];
}

function post(path: string, fields: Record<string, string>, cookie?: string) {
  return new Request(`${WORKER}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie && { cookie: `__Host-goodfellow_setup=${cookie}` }),
    },
    body: new URLSearchParams(fields),
  });
}

function get(path: string, cookie?: string) {
  return new Request(`${WORKER}${path}`, cookie ? { headers: { cookie: `__Host-goodfellow_setup=${cookie}` } } : {});
}

describe("the setup page", () => {
  it("sets up a worker from the Deploy to Cloudflare button with one Cloudflare token, keeping none of it", async () => {
    const { fetch, secrets, requests } = fakes();
    const worker = createWorker({ fetch });
    // Each step's settings take effect in the version Cloudflare starts next.
    const env = (): WorkerEnv => ({ WORKER_NAME: "sign-in", ...secrets });

    const first = await worker.fetch(get("/setup"), env());
    const firstPage = await first.text();
    expect(first.status).toBe(200);
    expect(first.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(firstPage).toContain("Make a Cloudflare API token");
    expect(firstPage).toContain("permissionGroupKeys");

    const saved = await worker.fetch(
      post("/setup/token", {
        token: TOKEN,
        addresses: "parish.example\nhttps://admin.parish.example/admin/",
        organization: "",
      }),
      env(),
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get("refresh")).toMatch(/url=\/setup/);
    const cookie = cookieOf(saved);
    expect(cookie).toBeTruthy();
    expect(secrets.ALLOWED_ORIGINS).toBe("https://parish.example,https://admin.parish.example");
    expect(atob(secrets.SESSION_KEY ?? "")).toHaveLength(32);
    // The browser's cookie is sealed, so it shows nothing of the token.
    expect(cookie).not.toContain(TOKEN);

    // Before the new version starts, the page waits rather than starting again.
    const waiting = await worker.fetch(get("/setup", cookie), { WORKER_NAME: "sign-in" });
    expect(await waiting.text()).toContain("Cloudflare is starting the service");

    const editStep = await (await worker.fetch(get("/setup", cookie), env())).text();
    expect(editStep).toContain("https://github.com/settings/apps/new?state=edit.");
    const manifest = JSON.parse(
      (/name="manifest" value="([^"]*)"/.exec(editStep)?.[1] ?? "").replace(/&#(\d+);/g, (_, code) =>
        String.fromCharCode(Number(code)),
      ),
    ) as { name: string; redirect_url: string; callback_urls: string[]; public: boolean };
    expect(manifest).toMatchObject({
      name: "Goodfellow parish.example",
      redirect_url: `${WORKER}/setup/github/callback`,
      callback_urls: [`${WORKER}/github/callback`],
      public: false,
    });
    const editState = /state=(edit\.[\w-]+)/.exec(editStep)?.[1] ?? "";

    const editMade = await worker.fetch(get(`/setup/github/callback?code=one&state=${editState}`, cookie), env());
    const ownerStep = await editMade.text();
    expect(secrets).toMatchObject({
      EDIT_APP_ID: "101",
      EDIT_APP_SLUG: "goodfellow-parish-1",
      EDIT_CLIENT_ID: "Iv1.1",
      EDIT_CLIENT_SECRET: "secret-1",
      EDIT_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----1",
    });
    expect(ownerStep).toContain("state=owner.");
    const nextCookie = cookieOf(editMade) ?? "";
    // GitHub's code for the first app can't be brought back again to make it twice, nor the old state reused.
    const ownerState = /state=(owner\.[\w-]+)/.exec(ownerStep)?.[1] ?? "";

    const done = await worker.fetch(get(`/setup/github/callback?code=two&state=${ownerState}`, nextCookie), env());
    expect(await done.text()).toContain("The sign-in service is set up");
    expect(done.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(secrets).toMatchObject({ OWNER_APP_ID: "102", OWNER_APP_SLUG: "goodfellow-parish-2" });
    expect(isConfigured(env())).toBe(true);
    expect(Object.values(secrets)).not.toContain(TOKEN);

    // Set up, the page only offers to change the addresses.
    expect(await (await worker.fetch(get("/setup"), env())).text()).toContain("Change your sites' addresses");
    expect(requests.filter((request) => request.startsWith("PUT")).length).toBe(2 + 5 + 5);
  });

  it("refuses a token that can't reach this worker, and never takes it over for someone else", async () => {
    const { fetch, secrets } = fakes();
    const worker = createWorker({ fetch });
    const wrong = await worker.fetch(post("/setup/token", { token: "someone-elses", addresses: "parish.example" }), {
      WORKER_NAME: "sign-in",
    });
    expect(await wrong.text()).toContain("accept that token");
    expect(secrets).toEqual({});

    const elsewhere = await worker.fetch(post("/setup/token", { token: TOKEN, addresses: "parish.example" }), {
      WORKER_NAME: "renamed",
    });
    expect(await elsewhere.text()).toContain("reach this sign-in service (renamed)");
    expect(secrets).toEqual({});

    // A callback without the setup's own cookie makes nothing.
    const forged = await worker.fetch(get("/setup/github/callback?code=x&state=edit.abc"), {
      WORKER_NAME: "sign-in",
      SESSION_KEY: btoa("k".repeat(32)),
    });
    expect(await forged.text()).toContain("Start again");
    expect(secrets).toEqual({});
  });

  it("changes the addresses of a set-up worker only with a token, and checks them", async () => {
    const { fetch, secrets } = fakes();
    const worker = createWorker({ fetch });
    const env: WorkerEnv = {
      WORKER_NAME: "sign-in",
      SESSION_KEY: btoa("k".repeat(32)),
      EDIT_APP_ID: "1",
      EDIT_PRIVATE_KEY: "pem",
      OWNER_APP_ID: "2",
      OWNER_PRIVATE_KEY: "pem",
    };
    const bad = await worker.fetch(post("/setup/addresses", { token: TOKEN, addresses: "http://parish.example" }), env);
    expect(await bad.text()).toContain("needs to start with https://");
    const good = await worker.fetch(post("/setup/addresses", { token: TOKEN, addresses: "https://new.example" }), env);
    expect(await good.text()).toContain("Saved the new addresses");
    expect(secrets).toEqual({ ALLOWED_ORIGINS: "https://new.example" });
    // Setting it up again needs its secrets cleared first.
    const again = await worker.fetch(post("/setup/token", { token: TOKEN, addresses: "https://x.example" }), env);
    expect(await again.text()).toContain("This sign-in service is set up");
  });

  it("isn't there on a worker set up from a computer", async () => {
    const worker = createWorker({ fetch: fakes().fetch });
    const response = await worker.fetch(get("/setup"), {});
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("parseAddresses", () => {
  it("takes origins, one per line or separated by commas, https:// only", () => {
    expect(parseAddresses("example.org, https://www.example.org/admin/\nhttps://example.org")).toEqual([
      "https://example.org",
      "https://www.example.org",
    ]);
    expect(() => parseAddresses("")).toThrow("at least one address");
    expect(() => parseAddresses("http://example.org")).toThrow("https://");
  });
});

describe("appName", () => {
  it("names each app after the first site, within GitHub's 34 characters", () => {
    expect(appName("edit", ["https://www.parish.example"])).toBe("Goodfellow parish.example");
    expect(appName("owner", ["https://a-very-long-parish-name.example.org"]).length).toBeLessThanOrEqual(34);
  });
});

describe("TOKEN_TEMPLATE_URL", () => {
  it("fills in Cloudflare's token page with editing Workers", () => {
    const url = new URL(TOKEN_TEMPLATE_URL);
    expect(url.origin + url.pathname).toBe("https://dash.cloudflare.com/profile/api-tokens");
    expect(JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "[]")).toContainEqual({
      key: "workers_scripts",
      type: "edit",
    });
  });
});

describe("the worker's own address", () => {
  it("leads to the setup page until it's set up", async () => {
    const worker = createWorker({ fetch: fakes().fetch });
    const response = await worker.fetch(get("/"), { WORKER_NAME: "sign-in" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/setup");
  });
});
