import { describe, expect, it } from "vitest";
import { appJwt, pkcs8FromPkcs1, privateKeyBytes } from "./jwt.js";
import { challengeFor } from "./seal.js";
import { base64, editKey, SITE, setup } from "./test-setup.js";
import { isLocalAddress, PERMISSIONS } from "./worker.js";

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
  it("renews the token from the session, and renews the person's own token when it's about to expire", async () => {
    const { fake, signIn, post, tick } = setup();
    const { body } = await signIn();
    const renewed = (await (await post("/github/token", { session: body.session })).json()) as typeof body;
    expect(renewed.token).toMatch(/^ghs_/);
    expect(renewed.token).not.toBe(body.token);

    tick(8 * 3_600_000);
    const later = await post("/github/token", { session: renewed.session });
    expect(later.status).toBe(200);
    expect(fake.issued.filter((item) => item.kind === "user")).toHaveLength(2);
    expect((await post("/github/token", { session: renewed.session }, "https://evil.example")).status).toBe(403);
  });

  it("stops giving tokens once the site's address changes, and once the person signs out", async () => {
    const { fake, signIn, post } = setup();
    const { body } = await signIn();
    fake.repo.write("content/site.json", JSON.stringify({ version: 1, url: "https://new.example/" }));
    const moved = await post("/github/token", { session: body.session });
    expect(moved.status).toBe(403);
    expect(await moved.json()).toEqual({ problem: "wrong-address" });
    // The token made before the address was checked was revoked straight away.
    expect(fake.issued.at(-1)).toMatchObject({ kind: "installation", revoked: true });

    fake.repo.write("content/site.json", JSON.stringify({ version: 1, url: `${SITE}/` }));
    expect((await post("/github/sign-out", { session: body.session })).status).toBe(204);
    expect(fake.issued.find((item) => item.kind === "user")?.revoked).toBe(true);
    expect(await (await post("/github/token", { session: body.session })).json()).toEqual({ problem: "invalid" });
  });

  it("keeps to the daily limits for each editor and site", async () => {
    const { signIn, post } = setup({ env: { LIMIT_EDITOR: "2" } });
    const { body } = await signIn();
    expect((await post("/github/token", { session: body.session })).status).toBe(200);
    const busy = await post("/github/token", { session: body.session });
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ problem: "busy" });
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
    const taken = await post(
      "/github/setup/repository",
      { session, owner: "maria", name: "new-site", private: false },
      "https://setup.example",
    );
    expect(await taken.json()).toEqual({ problem: "name-taken" });
  });
});

describe("keys", () => {
  it("reads GitHub's PKCS #1 private keys as well as PKCS #8 ones", async () => {
    // A PKCS #8 key is the PKCS #1 key inside an OCTET STRING, after the version and algorithm.
    const { pkcs8 } = editKey;
    const lengthBytes = (pkcs8[1] ?? 0) & 0x7f;
    let offset = 2 + lengthBytes + 3 + 15;
    expect(pkcs8[offset]).toBe(0x04);
    const octetLengthBytes = (pkcs8[offset + 1] ?? 0) & 0x7f;
    offset += 2 + octetLengthBytes;
    const pkcs1 = pkcs8.subarray(offset);
    expect(pkcs8FromPkcs1(pkcs1)).toEqual(pkcs8);
    const pem = `-----BEGIN RSA PRIVATE KEY-----\n${base64(pkcs1)}\n-----END RSA PRIVATE KEY-----`;
    expect(privateKeyBytes(pem)).toEqual(pkcs8);
    expect(await appJwt("101", pem)).toMatch(/^ey[\w-]+\.ey[\w-]+\.[\w-]+$/);
  });
});
