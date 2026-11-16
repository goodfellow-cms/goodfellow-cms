import { describe, expect, it } from "vitest";
import {
  appInstallUrl,
  appManifestFormAction,
  convertAppManifest,
  PUBLISHING_APP_PERMISSIONS,
  PublishingAppError,
  publishingAppManifest,
  publishingAppName,
  publishingAppToken,
  publishingToken,
} from "./app.js";
import { fakeGitHub } from "./testing.js";

const CONTENT = "someone/acme-content";

/** A fake GitHub with the content repository and the code's, and a publishing app made from its manifest. */
async function setUp() {
  const github = fakeGitHub({ repo: CONTENT, tokens: { "gh-token": { login: "someone" } } });
  github.addRepo("someone/acme", { files: { "package.json": "{}\n" } });
  const manifest = publishingAppManifest({
    name: publishingAppName(CONTENT),
    url: "https://www.acme.example",
    redirectUrl: "https://goodfellowcms.com/new-site/full-stack/app/",
    setupUrl: "https://goodfellowcms.com/new-site/full-stack/app/",
  });
  const { code, app } = await github.createApp(manifest, "someone");
  const created = await convertAppManifest(code, { fetch: github.fetch });
  return {
    github,
    app,
    created,
    options: { appId: created.id, privateKey: created.pem, repo: CONTENT, fetch: github.fetch },
  };
}

async function problemOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PublishingAppError) return error.problem;
    throw error;
  }
  return undefined;
}

describe("the publishing app's manifest", () => {
  it("asks for Contents only, privately, with no events", () => {
    const manifest = publishingAppManifest({
      name: "acme-content publishing",
      url: "https://www.acme.example",
      redirectUrl: "https://goodfellowcms.com/a/",
      setupUrl: "https://goodfellowcms.com/b/",
    });
    expect(manifest.default_permissions).toEqual({ contents: "write", metadata: "read" });
    expect(manifest.public).toBe(false);
    expect(manifest.default_events).toEqual([]);
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest).toMatchObject({
      redirect_url: "https://goodfellowcms.com/a/",
      setup_url: "https://goodfellowcms.com/b/",
    });
  });

  it("is named after the content repository, as long as GitHub allows", () => {
    expect(publishingAppName(CONTENT)).toBe("acme-content publishing");
    expect(publishingAppName(`someone/${"a".repeat(40)}`)).toHaveLength(34);
  });

  it("is posted to the person's settings or an organization's, and installed from its page", () => {
    expect(appManifestFormAction("s1")).toBe("https://github.com/settings/apps/new?state=s1");
    expect(appManifestFormAction("s1", "acme org")).toBe(
      "https://github.com/organizations/acme%20org/settings/apps/new?state=s1",
    );
    expect(appInstallUrl("acme-content-publishing")).toBe(
      "https://github.com/apps/acme-content-publishing/installations/new",
    );
  });
});

describe("convertAppManifest", () => {
  it("gives the app's id, slug, and key once", async () => {
    const github = fakeGitHub({ repo: CONTENT });
    const { code, app } = await github.createApp({ name: "acme-content publishing" }, "someone");
    const created = await convertAppManifest(code, { fetch: github.fetch });
    expect(created).toMatchObject({ id: Number(app.id), slug: "acme-content-publishing" });
    expect(created.pem).toContain("BEGIN RSA PRIVATE KEY");
    expect(await problemOf(convertAppManifest(code, { fetch: github.fetch }))).toBe("no-app");
  });
});

describe("publishingToken", () => {
  it("gives a token for the content repository alone, with Contents only, once the installation checks out", async () => {
    const { github, app, options } = await setUp();
    github.install(app.slug, "someone", [CONTENT]);
    const { token, expiresAt } = await publishingToken(options);
    expect(expiresAt).toBeGreaterThan(Date.now() + 50 * 60_000);
    const made = github.issued.filter((issued) => issued.app === app.slug);
    // The one that looked at the installation's repositories, revoked, then the one given.
    expect(made).toEqual([
      expect.objectContaining({ permissions: { metadata: "read" }, revoked: true }),
      expect.objectContaining({ token, repositories: [CONTENT], permissions: { contents: "write" } }),
    ]);
    expect(made[1]?.revoked).toBeUndefined();
    // Asked for by name, so a repository added to the installation after the check isn't in it either.
    const asked = await Promise.all(
      github.requests
        .filter((request) => request.url.endsWith("/access_tokens"))
        .map((request) => request.clone().json()),
    );
    expect(asked.at(-1)).toEqual({ repositories: ["acme-content"], permissions: { contents: "write" } });
    // It can publish to the content, and can't see the code.
    const read = (repo: string) =>
      github.fetch(`https://api.github.com/repos/${repo}`, { headers: { authorization: `Bearer ${token}` } });
    expect((await read(CONTENT)).status).toBe(200);
    expect((await read("someone/acme")).status).toBe(404);
  });

  it("refuses an app that isn't installed on the content repository", async () => {
    const { options } = await setUp();
    expect(await problemOf(publishingToken(options))).toBe("not-installed");
  });

  it("refuses an installation on all of the account's repositories, which would reach the code", async () => {
    const { github, app, options } = await setUp();
    app.installations.push({ id: 77, account: "someone", repositories: "all" });
    expect(await problemOf(publishingToken(options))).toBe("all-repositories");
    expect(github.issued.filter((issued) => issued.app === app.slug)).toEqual([]);
  });

  it("refuses an installation on other repositories besides the content's", async () => {
    const { github, app, options } = await setUp();
    github.install(app.slug, "someone", [CONTENT, "someone/acme"]);
    expect(await problemOf(publishingToken(options))).toBe("other-repositories");
    // Only the token that looked was made, and it's revoked.
    expect(github.issued.filter((issued) => issued.app === app.slug)).toEqual([
      expect.objectContaining({ permissions: { metadata: "read" }, revoked: true }),
    ]);
  });

  it("refuses an app given more permissions than Contents", async () => {
    const { github, app, options } = await setUp();
    github.install(app.slug, "someone", [CONTENT]);
    app.permissions = { ...app.permissions, actions: "write" };
    expect(await problemOf(publishingToken(options))).toBe("permissions");
    app.permissions = { ...PUBLISHING_APP_PERMISSIONS, contents: "read" };
    // Less is fine, though it can't publish with it.
    await expect(publishingToken(options)).rejects.toThrow(/didn't give the app a token/);
  });

  it("says when the key isn't the app's", async () => {
    const { github, app, options } = await setUp();
    github.install(app.slug, "someone", [CONTENT]);
    const other = await setUp();
    expect(await problemOf(publishingToken({ ...options, privateKey: other.created.pem }))).toBe("unavailable");
    expect(await problemOf(publishingToken({ ...options, privateKey: "not a key" }))).toBe("unavailable");
  });
});

describe("publishingAppToken", () => {
  it("keeps a token until it's nearly an hour old, then makes and checks another", async () => {
    const { github, app, options } = await setUp();
    github.install(app.slug, "someone", [CONTENT]);
    let now = Date.now();
    const token = publishingAppToken({ ...options, now: () => now });
    const [first, again] = await Promise.all([token(), token()]);
    expect(again).toBe(first);
    expect(await token()).toBe(first);
    const given = () => github.issued.filter((issued) => issued.app === app.slug && issued.permissions.contents);
    expect(given()).toHaveLength(1);
    now += 55 * 60_000;
    const renewed = await token();
    expect(renewed).not.toBe(first);
    expect(given()).toHaveLength(2);
    // Installed on more since: no new token.
    github.install(app.slug, "someone", ["someone/acme"]);
    now += 55 * 60_000;
    expect(await problemOf(token())).toBe("other-repositories");
  });
});
