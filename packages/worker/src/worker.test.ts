import { describe, expect, it } from "vitest";
import { challengeFor } from "./seal.js";
import { base64, editKey, SITE, setup } from "./test-setup.js";
import { CODE_PERMISSIONS, isLocalAddress, PERMISSIONS } from "./worker.js";

describe("signing in", () => {
  it("gives the admin panel a token for the site's repository only, with only what editors need", async () => {
    const { fake, signIn, redirect } = setup();
    const { back } = await redirect("maria");
    expect(back.origin + back.pathname + back.hash).toBe(`${SITE}/admin/#/pages`);

    const { response, body } = await signIn();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(SITE);
    expect(body.user).toEqual({
      login: "maria",
      name: "Maria",
      avatarUrl: "https://avatars.example/maria",
      email: "4242+maria@users.noreply.github.com",
    });
    expect(body.token).toMatch(/^ghs_/);
    expect(fake.issued.find((item) => item.token === body.token)).toMatchObject({
      kind: "installation",
      app: "goodfellow-cms",
      repositories: ["parish/site"],
      permissions: PERMISSIONS.edit,
    });
    // The person's own GitHub token never leaves the worker.
    const own = fake.issued.filter((item) => item.kind === "user").map((item) => item.token);
    expect(own).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(new RegExp(own.join("|")));
    expect(back.toString()).not.toMatch(new RegExp(own.join("|")));
    // And it's revoked as soon as the person has signed in: the worker keeps nothing.
    expect(fake.issued.filter((item) => item.kind === "user").every((item) => item.revoked)).toBe(true);
  });

  it("still signs in where the app hasn't been given the permissions it asked for later", async () => {
    const { fake, signIn, redirect } = setup({ withoutChecks: true });
    await redirect("maria");
    const { response, body } = await signIn();
    expect(response.status).toBe(200);
    const { checks: _, statuses: __, pull_requests: ___, ...older } = PERMISSIONS.edit;
    expect(fake.issued.find((item) => item.token === body.token)?.permissions).toEqual(older);
  });

  it("gives tokens only to the address in the site's settings, never to this computer", async () => {
    const { call } = setup();
    const challenge = await challengeFor("x".repeat(43));
    for (const [back, status] of [
      ["https://evil.example/admin/", 403],
      ["http://parish.example/admin/", 400],
      ["https://localhost:4321/admin/", 403],
    ] as const) {
      const query = new URLSearchParams({ purpose: "edit", repo: "parish/site", return: back, challenge });
      const response = await call(`/github/start?${query}`);
      expect(response.status).toBe(status);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("content-type")).toMatch(/text\/html/);
    }
    expect(await (await call("/github/check?repo=parish/site", { origin: "https://evil.example" })).json()).toEqual({
      problem: "wrong-address",
    });
    expect(await (await call("/github/check?repo=parish/site", { origin: "http://127.0.0.1:4321" })).json()).toEqual({
      problem: "local-address",
    });
    expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({ ok: true });
    expect(isLocalAddress("https://site.localhost")).toBe(true);
    expect(isLocalAddress("https://parish.example")).toBe(false);
  });

  it("reads a site's addresses for checks anyone can ask for at most every couple of minutes", async () => {
    const { call, fake, tick } = setup();
    const reads = () => fake.requests.filter((request) => request.url.includes("/contents/content/site.json")).length;
    for (let i = 0; i < 5; i++) {
      expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({ ok: true });
    }
    expect(await (await call("/github/check?repo=parish/site", { origin: "https://evil.example" })).json()).toEqual({
      problem: "wrong-address",
    });
    expect(reads()).toBe(1);
    tick(3 * 60_000);
    await call("/github/check?repo=parish/site", { origin: SITE });
    expect(reads()).toBe(2);
  });

  it("gives tokens to the site's admin address too, which its build names", async () => {
    const admin = "https://admin.parish.example";
    const { call, post, redirect } = setup({ admin });
    expect(await (await call("/github/check?repo=parish/site", { origin: admin })).json()).toEqual({ ok: true });
    expect(await (await call("/github/check?repo=parish/site", { origin: "https://evil.example" })).json()).toEqual({
      problem: "wrong-address",
    });

    const { back, verifier } = await redirect("maria", "edit", `${admin}/admin/`);
    expect(back.origin).toBe(admin);
    const grant = back.searchParams.get("goodfellow_sign_in");
    const response = await post("/github/session", { grant, verifier }, admin);
    expect(response.status).toBe(200);
    const { session } = (await response.json()) as { session: string };
    expect((await post("/github/token", { session }, admin)).status).toBe(200);

    // Without an admin address, it's only the Site address.
    expect(await (await setup().call("/github/check?repo=parish/site", { origin: admin })).json()).toEqual({
      problem: "wrong-address",
    });
  });

  it("gives tokens to the site's other copies too, such as staging, which its build names", async () => {
    const staging = "https://staging.parish.example";
    const { call } = setup({
      copies: [`${staging}/`, "https://localhost:4321", "http://plain.parish.example", "not an address"],
    });
    expect(await (await call("/github/check?repo=parish/site", { origin: staging })).json()).toEqual({ ok: true });
    expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({ ok: true });
    // Never this computer, or an address without HTTPS.
    for (const origin of ["https://localhost:4321", "http://plain.parish.example"]) {
      expect((await (await call("/github/check?repo=parish/site", { origin })).json()).problem).not.toBe(undefined);
    }
    // A token broker still takes them over.
    const withBroker = setup({ broker: "https://broker.parish.example", copies: [staging] });
    expect(await (await withBroker.call("/github/check?repo=parish/site", { origin: staging })).json()).toEqual({
      problem: "wrong-address",
    });
  });

  it("gives tokens only to the site's token broker, where its build names one", async () => {
    const broker = "https://broker.parish.example";
    const { call } = setup({ broker });
    expect(await (await call("/github/check?repo=parish/site", { origin: broker })).json()).toEqual({ ok: true });
    expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({
      problem: "wrong-address",
    });
  });

  it("says when the app isn't installed, or the site has no address yet", async () => {
    const notInstalled = setup({ installed: false });
    const response = await notInstalled.call("/github/check?repo=parish/site", { origin: SITE });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      problem: "not-installed",
      installUrl: "https://github.com/apps/goodfellow-cms/installations/new",
    });
    const noAddress = setup({ url: "" });
    expect(await (await noAddress.call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({
      problem: "no-address",
    });
  });

  it("says the app isn't installed as soon as it's uninstalled, though it remembers installations", async () => {
    const { apps, post, signIn } = setup();
    const { body } = await signIn();
    // Installed again, which gives it a new installation: renewing finds it.
    apps.edit.installations = [{ id: 12, account: "parish", repositories: ["parish/site"] }];
    const renewed = await post("/github/token", { session: body.session });
    expect(renewed.status).toBe(200);
    const { session } = (await renewed.json()) as { session: string };

    apps.edit.installations = [];
    const response = await post("/github/token", { session });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      problem: "not-installed",
      installUrl: "https://github.com/apps/goodfellow-cms/installations/new",
    });
    // Or the repository taken out of it.
    apps.edit.installations = [{ id: 12, account: "parish", repositories: ["parish/other"] }];
    expect(await (await post("/github/token", { session })).json()).toMatchObject({ problem: "not-installed" });
  });

  it("needs the verifier only the tab that started signing in knows, from the same address", async () => {
    const { redirect, post } = setup();
    const { back, verifier } = await redirect("maria");
    const grant = back.searchParams.get("goodfellow_sign_in");
    expect((await post("/github/session", { grant, verifier: "y".repeat(43) })).status).toBe(401);
    expect((await post("/github/session", { grant, verifier }, "https://evil.example")).status).toBe(403);
    expect((await post("/github/session", { grant: `${grant}x`, verifier })).status).toBe(401);
    expect((await post("/github/session", { grant, verifier })).status).toBe(200);
  });

  it("goes back with the reason when the person can't publish, or cancelled", async () => {
    const { redirect, call } = setup();
    expect((await redirect("reader")).back.searchParams.get("goodfellow_sign_in_error")).toBe("cant-publish");
    expect((await redirect("maria", "owner")).back.searchParams.get("goodfellow_sign_in_error")).toBe("not-owner");

    const challenge = await challengeFor("x".repeat(43));
    const start = await call(
      `/github/start?${new URLSearchParams({ repo: "parish/site", return: `${SITE}/admin/`, challenge })}`,
    );
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const cancelled = await call(`/github/callback?${new URLSearchParams({ error: "access_denied", state })}`);
    expect(new URL(cancelled.headers.get("location") ?? "").searchParams.get("goodfellow_sign_in_error")).toBe(
      "cancelled",
    );
    expect((await call("/github/callback?code=1&state=forged")).status).toBe(400);
  });
});

describe("staying signed in", () => {
  it("renews the token from the session, checking each time that the person still edits the site", async () => {
    const { fake, signIn, post } = setup();
    const { body } = await signIn();
    const renewed = (await (await post("/github/token", { session: body.session })).json()) as typeof body;
    expect(renewed.token).toMatch(/^ghs_/);
    expect(renewed.token).not.toBe(body.token);
    expect((await post("/github/token", { session: renewed.session }, "https://evil.example")).status).toBe(403);

    fake.collaborators.set("maria", "read");
    const removed = await post("/github/token", { session: renewed.session });
    expect(removed.status).toBe(403);
    expect(await removed.json()).toEqual({ problem: "cant-publish" });
    // The token made before the check was revoked straight away.
    expect(fake.issued.at(-1)).toMatchObject({ kind: "installation", revoked: true });
  });

  it("stops giving tokens once the site's address changes", async () => {
    const { fake, signIn, post } = setup();
    const { body } = await signIn();
    fake.repo.write("content/site.json", JSON.stringify({ version: 1, url: "https://new.example/" }));
    const moved = await post("/github/token", { session: body.session });
    expect(moved.status).toBe(403);
    expect(await moved.json()).toEqual({ problem: "wrong-address" });
    expect(fake.issued.at(-1)).toMatchObject({ kind: "installation", revoked: true });
  });
});

describe("sessions", () => {
  it("end their lifetime after signing in, however often they're renewed", async () => {
    const { signIn, post, tick } = setup();
    let { body } = await signIn();
    for (let day = 0; day < 29; day++) {
      tick(24 * 3_600_000);
      const renewed = await post("/github/token", { session: body.session });
      expect(renewed.status).toBe(200);
      body = (await renewed.json()) as typeof body;
    }
    tick(2 * 24 * 3_600_000);
    const expired = await post("/github/token", { session: body.session });
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ problem: "invalid" });
  });
});

describe("checking an address", () => {
  it("revokes the token it reads the site with, even when reading fails", async () => {
    const { fake, call } = setup({ settingsFail: true });
    const response = await call("/github/check?repo=parish/site", { origin: SITE });
    expect(response.status).toBe(502);
    const readers = fake.issued.filter((item) => item.kind === "installation");
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.every((item) => item.revoked)).toBe(true);
  });

  it("gives tokens only to addresses the worker's own settings list, where they list any", async () => {
    const staging = "https://staging.parish.example";
    const { call } = setup({ copies: [staging], env: { ALLOWED_ORIGINS: `${SITE}/` } });
    expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({ ok: true });
    // An editor can add a copy to the site's config; the worker's settings can't be changed from the site.
    expect(await (await call("/github/check?repo=parish/site", { origin: staging })).json()).toEqual({
      problem: "wrong-address",
    });
  });
});

describe("owners' sign-ins", () => {
  async function start(call: ReturnType<typeof setup>["call"], extra: Record<string, string> = {}, cookie?: string) {
    const query = new URLSearchParams({
      purpose: "owner",
      repo: "parish/site",
      return: `${SITE}/admin/#/settings/editors`,
      challenge: await challengeFor("x".repeat(43)),
      ...extra,
    });
    return call(`/github/start?${query}`, { headers: cookie ? { cookie } : {} });
  }

  it("say where the token goes before going to GitHub, and continue only from that page", async () => {
    const { call, confirmed } = setup();
    const shown = await start(call);
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const cookie = shown.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-goodfellow_confirm=[\w-]+; Path=\/; Secure; HttpOnly; SameSite=Strict/);
    const html = await shown.clone().text();
    expect(html).toContain(SITE);
    expect(html).toContain("parish/site");

    // A link made elsewhere, even with a value copied from the page, comes back to the page.
    const nonce = /confirm=([\w-]+)/.exec(html)?.[1] ?? "";
    expect((await start(call, { confirm: nonce })).status).toBe(200);
    expect((await start(call, { confirm: "made-up" }, cookie.split(";")[0])).status).toBe(200);

    const continued = await confirmed(shown);
    expect(continued.status).toBe(302);
    expect(continued.headers.get("location")).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  });

  it("go straight to GitHub for an address the worker's own settings list", async () => {
    const { call } = setup({ env: { ALLOWED_ORIGINS: SITE } });
    expect((await start(call)).status).toBe(302);
  });

  it("aren't asked about on the way to the editors' sign-in", async () => {
    const { redirect } = setup();
    expect((await redirect("maria")).back.searchParams.get("goodfellow_sign_in")).toBeTruthy();
  });
});

describe("installing while signing in", () => {
  it("sends the person to GitHub's install page, and checks where to come back to once Goodfellow can read the site", async () => {
    const { fake, call, post } = setup({ installed: false });
    const verifier = "v".repeat(43);
    const query = new URLSearchParams({
      purpose: "edit",
      repo: "parish/site",
      return: `${SITE}/admin/`,
      challenge: await challengeFor(verifier),
      install: "1",
    });
    const start = await call(`/github/start?${query}`);
    const install = new URL(start.headers.get("location") ?? "");
    expect(install.origin + install.pathname).toBe("https://github.com/apps/goodfellow-cms/installations/new");
    const state = install.searchParams.get("state") ?? "";

    const { code, installation } = fake.install("goodfellow-cms", "olivia", ["parish/site"]);
    const back = await call(
      `/github/callback?${new URLSearchParams({ code, installation_id: String(installation), setup_action: "install", state })}`,
    );
    const grant = new URL(back.headers.get("location") ?? "").searchParams.get("goodfellow_sign_in");
    const signedIn = await post("/github/session", { grant, verifier });
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { user: { login: string } }).user.login).toBe("olivia");
  });

  it("never goes back to an address the site's settings don't give, nor without the site chosen", async () => {
    const { fake, call } = setup({ installed: false });
    const callback = async (back: string, repositories: string[]) => {
      const query = new URLSearchParams({
        repo: "parish/site",
        return: back,
        challenge: await challengeFor("v".repeat(43)),
        install: "1",
      });
      const state = new URL((await call(`/github/start?${query}`)).headers.get("location") ?? "").searchParams.get(
        "state",
      );
      const { code } = fake.install("goodfellow-cms", "olivia", repositories);
      return call(`/github/callback?${new URLSearchParams({ code, state: state ?? "" })}`);
    };
    const other = await callback(`${SITE}/admin/`, ["parish/other"]);
    expect(other.headers.get("location")).toBeNull();
    expect(await other.text()).toMatch(/isn't installed on the site's repository/);
    const elsewhere = await callback("https://evil.example/admin/", ["parish/site"]);
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.headers.get("location")).toBeNull();
  });
});

describe("a site whose code is in a repository of its own", () => {
  const CONFIG = 'export default defineConfig({ backend: github({ repo: "parish/site", contentOnly: true }) });\n';

  function withCode(
    code: { config?: string; private?: boolean; collaborators?: Record<string, "admin" | "write" | "read"> } = {},
  ) {
    const context = setup({ repositories: ["parish/site-code"] });
    context.fake.addRepo("parish/site-code", {
      files: { "goodfellow.config.tsx": code.config ?? CONFIG },
      private: code.private ?? true,
      collaborators: code.collaborators ?? { maria: "read", olivia: "write" },
    });
    return context;
  }

  it("gives a token that can only read the code repository's updates, and renews it with the site's", async () => {
    const { fake, signIn, post } = withCode();
    const { body } = await signIn("maria", "edit", { code: "parish/site-code" });
    const code = body.code as { token: string; expiresAt: string };
    expect(fake.issued.find((item) => item.token === code.token)).toMatchObject({
      app: "goodfellow-cms",
      repositories: ["parish/site-code"],
      permissions: CODE_PERMISSIONS.edit,
    });
    expect(fake.issued.find((item) => item.token === body.token)?.repositories).toEqual(["parish/site"]);

    const renewed = (await (
      await post("/github/token", { session: body.session, code: "parish/site-code" })
    ).json()) as {
      code?: { token: string };
    };
    expect(renewed.code?.token).toMatch(/^ghs_/);
    expect(renewed.code?.token).not.toBe(code.token);
    // Without asking, there's none.
    expect(await (await post("/github/token", { session: body.session })).json()).not.toHaveProperty("code");
  });

  it("gives owners one that can run its workflows, once they can publish to it", async () => {
    const { fake, signIn } = withCode();
    const { body } = await signIn("olivia", "owner", { code: "parish/site-code" });
    const code = body.code as { token: string };
    expect(fake.issued.find((item) => item.token === code.token)).toMatchObject({
      app: "goodfellow-cms-owner",
      permissions: CODE_PERMISSIONS.owner,
    });
    const reader = withCode({ collaborators: { olivia: "read" } });
    expect((await reader.signIn("olivia", "owner", { code: "parish/site-code" })).body).not.toHaveProperty("code");
  });

  it("gives none for a repository that isn't the site's code, or that the person can't see", async () => {
    const elsewhere = withCode({ config: 'backend: github({ repo: "parish/other" })' });
    const { body } = await elsewhere.signIn("maria", "edit", { code: "parish/site-code" });
    expect(body.token).toMatch(/^ghs_/);
    expect(body).not.toHaveProperty("code");
    // The token made to look was revoked straight away.
    expect(elsewhere.fake.issued.filter((item) => item.repositories?.includes("parish/site-code"))).toEqual([
      expect.objectContaining({ revoked: true }),
    ]);

    const hidden = withCode({ collaborators: {} });
    expect((await hidden.signIn("maria", "edit", { code: "parish/site-code" })).body).not.toHaveProperty("code");
    // Anyone may follow a public repository's updates.
    const open = withCode({ collaborators: {}, private: false });
    expect((await open.signIn("maria", "edit", { code: "parish/site-code" })).body).toHaveProperty("code");
    // Nor for repositories Goodfellow isn't installed on, or the site's own.
    const { signIn } = setup();
    expect((await signIn("maria", "edit", { code: "parish/site-code" })).body).not.toHaveProperty("code");
    expect((await signIn("maria", "edit", { code: "parish/site" })).body).not.toHaveProperty("code");
  });
});

describe("owners and site setup", () => {
  it("gives owners a token from the owners' app, for the Editors and Domain screens", async () => {
    const { fake, signIn } = setup();
    const { body } = await signIn("olivia", "owner");
    expect(fake.issued.find((item) => item.token === body.token)).toMatchObject({
      app: "goodfellow-cms-owner",
      permissions: PERMISSIONS.owner,
    });
    const invitations = await fake.fetch("https://api.github.com/repos/parish/site/invitations", {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(invitations.status).toBe(200);
  });

  it("creates a site's repository for the setup page, and gives a token for it", async () => {
    const { fake, redirect, post } = setup();
    const { back, verifier } = await redirect("maria", "setup", "https://setup.example/new-site/");
    const signedIn = await post(
      "/github/session",
      { grant: back.searchParams.get("goodfellow_sign_in"), verifier },
      "https://setup.example",
    );
    const { session } = (await signedIn.json()) as { session: string };
    const owners = (await (await post("/github/setup/owners", { session }, "https://setup.example")).json()) as {
      owners: unknown[];
    };
    expect(owners.owners).toEqual([
      { path: "maria", name: "Maria", kind: "personal", installed: true },
      { path: "parish", name: "parish", kind: "organization", installed: true },
    ]);
    expect((await post("/github/setup/owners", { session }, SITE)).status).toBe(403);

    const created = (await (
      await post(
        "/github/setup/repository",
        { session, owner: "maria", name: "new-site", private: false },
        "https://setup.example",
      )
    ).json()) as { token: string; repo: { full_name: string }; editInstallUrl?: string };
    expect(created.repo.full_name).toBe("maria/new-site");
    expect(created.editInstallUrl).toBe("https://github.com/apps/goodfellow-cms/installations/new");
    expect(fake.issued.find((item) => item.token === created.token)).toMatchObject({
      repositories: ["maria/new-site"],
      permissions: PERMISSIONS.setup,
    });
    // The person's own token was kept only until the repository existed.
    expect(fake.issued.filter((item) => item.kind === "user").every((item) => item.revoked)).toBe(true);
    const again = await post(
      "/github/setup/repository",
      { session, owner: "maria", name: "other-site", private: false },
      "https://setup.example",
    );
    expect(await again.json()).toEqual({ problem: "invalid" });

    const { back: secondBack, verifier: secondVerifier } = await redirect(
      "maria",
      "setup",
      "https://setup.example/new-site/",
    );
    const second = (await (
      await post(
        "/github/session",
        { grant: secondBack.searchParams.get("goodfellow_sign_in"), verifier: secondVerifier },
        "https://setup.example",
      )
    ).json()) as { session: string };
    const taken = await post(
      "/github/setup/repository",
      { session: second.session, owner: "maria", name: "new-site", private: false },
      "https://setup.example",
    );
    expect(await taken.json()).toEqual({ problem: "name-taken" });
  });
});

describe("setting up a site in two repositories", () => {
  async function setupSession(context: ReturnType<typeof setup>) {
    const { back, verifier } = await context.redirect("maria", "setup", "https://setup.example/new-site/");
    const signedIn = await context.post(
      "/github/session",
      { grant: back.searchParams.get("goodfellow_sign_in"), verifier },
      "https://setup.example",
    );
    return ((await signedIn.json()) as { session: string }).session;
  }

  it("keeps the person's token until the last repository is created", async () => {
    const context = setup();
    const session = await setupSession(context);
    const create = async (name: string, more?: boolean) =>
      (await (
        await context.post(
          "/github/setup/repository",
          { session, owner: "maria", name, private: true, ...(more && { more }) },
          "https://setup.example",
        )
      ).json()) as { token?: string };
    const userTokens = () => context.fake.issued.filter((item) => item.kind === "user");
    expect((await create("site", true)).token).toMatch(/^ghs_/);
    expect(userTokens().some((item) => !item.revoked)).toBe(true);
    const content = await create("site-content");
    expect(context.fake.issued.find((item) => item.token === content.token)?.permissions).toEqual(PERMISSIONS.setup);
    expect(userTokens().every((item) => item.revoked)).toBe(true);
  });

  it("still creates the repository where the owners' app hasn't been given the Secrets permission", async () => {
    const context = setup({ withoutSecrets: true });
    const session = await setupSession(context);
    const created = (await (
      await context.post(
        "/github/setup/repository",
        { session, owner: "maria", name: "site", private: true },
        "https://setup.example",
      )
    ).json()) as { token: string };
    const { secrets: _, ...withoutSecrets } = PERMISSIONS.setup;
    expect(context.fake.issued.find((item) => item.token === created.token)?.permissions).toEqual(withoutSecrets);
  });
});

describe("keys", () => {
  it("signs in with GitHub's PKCS #1 private keys as well as PKCS #8 ones", async () => {
    // A PKCS #8 key is the PKCS #1 key inside an OCTET STRING, after the version and algorithm.
    const { pkcs8 } = editKey;
    const lengthBytes = (pkcs8[1] ?? 0) & 0x7f;
    let offset = 2 + lengthBytes + 3 + 15;
    expect(pkcs8[offset]).toBe(0x04);
    offset += 2 + ((pkcs8[offset + 1] ?? 0) & 0x7f);
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${base64(pkcs8.subarray(offset))}\n-----END RSA PRIVATE KEY-----`;
    const { call } = setup({ env: { EDIT_PRIVATE_KEY: pem } });
    expect(await (await call("/github/check?repo=parish/site", { origin: SITE })).json()).toEqual({ ok: true });
  });
});
