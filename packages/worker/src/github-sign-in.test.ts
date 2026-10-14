import { ConflictError, SignInError, type StorageLike } from "@goodfellow-cms/core";
import { github, githubSetup } from "@goodfellow-cms/github";
import { describe, expect, it, vi } from "vitest";
import { SITE, setup, WORKER } from "./test-setup.js";

function memoryStorage(): StorageLike & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

/** The admin panel in a browser at `start`, signing in through the worker, which the browser's requests reach as a site's would. */
function browser(site: ReturnType<typeof setup>, start = `${SITE}/admin/#/pages`) {
  let href = start;
  const location = {
    href: () => href,
    assign: (url: string) => {
      href = url;
    },
    replace: (url: string) => {
      href = url;
    },
  };
  const storage = { local: memoryStorage(), session: memoryStorage() };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (!request.url.startsWith(WORKER)) return site.fake.fetch(request);
    // Browsers say which page is asking, which is how the worker knows where tokens go.
    const headers = new Headers(request.headers);
    headers.set("origin", new URL(href).origin);
    return site.worker.fetch(new Request(request, { headers }), site.env);
  }) as typeof globalThis.fetch;

  /** Follows GitHub's sign-in, as `login`, from where the admin panel sent the browser back to the admin panel. */
  async function signInOnGitHub(login: string) {
    const started = await site.worker.fetch(new Request(href), site.env);
    const authorize = new URL(started.headers.get("location") ?? "");
    const code = site.fake.authorize(login, authorize.searchParams.get("client_id") ?? "");
    const state = authorize.searchParams.get("state") ?? "";
    const back = await site.worker.fetch(
      new Request(`${WORKER}/github/callback?${new URLSearchParams({ code, state })}`),
      site.env,
    );
    href = back.headers.get("location") ?? "";
  }

  /** The admin panel's GitHub sign-in, as a page load makes it. */
  const host = () => github({ repo: "parish/site", signIn: WORKER, fetch, storage, location });
  /** The setup page's GitHub sign-in. */
  const setupHost = () => githubSetup({ signIn: WORKER, fetch, storage, location });
  return { host, setupHost, storage, signInOnGitHub, href: () => href };
}

describe("signing in with GitHub through the worker", () => {
  it("signs editors in, names them as the author of what they publish, and keeps them signed in", async () => {
    const site = setup();
    const page = browser(site);
    const host = page.host();
    expect(host.canRedirect).toBe(true);
    await host.startRedirect(true);
    expect(page.href()).toMatch(new RegExp(`^${WORKER}/github/start\\?`));
    await page.signInOnGitHub("maria");

    const backend = await page.host().restore();
    expect(page.href()).toBe(`${SITE}/admin/#/pages`);
    expect(backend?.user).toEqual({ login: "maria", name: "Maria", avatarUrl: "https://avatars.example/maria" });
    // What's kept is the sealed session, never a GitHub token.
    const saved = page.storage.local.values.get("goodfellow:github:parish/site") ?? "";
    expect(JSON.parse(saved)).toMatchObject({ type: "worker" });
    expect(saved).not.toMatch(/gh[usr]_/);

    const expectedRevision = await backend?.revision();
    const { revision } = (await backend?.write([{ path: "content/pages/about.json", content: "{}\n" }], {
      message: "Add About",
      expectedRevision: expectedRevision ?? "",
    })) ?? { revision: "" };
    expect(site.fake.repo.files(revision).get("content/pages/about.json")).toBe("{}\n");
    expect(site.fake.commitAuthors.get(revision)).toMatchObject({
      name: "Maria",
      email: "4242+maria@users.noreply.github.com",
    });
    site.fake.repo.write("content/pages/about.json", "{ }\n");
    await expect(
      backend?.write([{ path: "content/pages/about.json", content: "[]\n" }], {
        message: "Edit",
        expectedRevision: revision,
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    const again = await page.host().restore();
    expect(again?.user.login).toBe("maria");
    again?.signOut();
    expect(page.storage.local.values.size).toBe(0);
    // Signing out revokes the person's GitHub token in the background.
    await vi.waitFor(() =>
      expect(site.fake.issued.filter((item) => item.kind === "user").every((item) => item.revoked)).toBe(true),
    );
  });

  it("is offered only on the site's own address, never on this computer", async () => {
    const site = setup();
    expect(browser(site, "http://localhost:4321/admin/").host().canRedirect).toBe(false);
    const elsewhere = browser(site, "https://elsewhere.example/admin/").host();
    expect(elsewhere.canRedirect).toBe(true);
    await expect(elsewhere.startRedirect(false)).rejects.toMatchObject({ problem: "wrong-address" });
    expect(github({ repo: "parish/site", signIn: false }).canRedirect).toBe(false);
  });

  it("says where to install Goodfellow when it isn't installed, and why someone can't sign in", async () => {
    const notInstalled = browser(setup({ installed: false })).host();
    const error = await notInstalled.startRedirect(false).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SignInError);
    expect(error).toMatchObject({
      problem: "not-installed",
      link: "https://github.com/apps/goodfellow-cms/installations/new",
    });

    const page = browser(setup());
    await page.host().startRedirect(false);
    await page.signInOnGitHub("reader");
    await expect(page.host().restore()).rejects.toMatchObject({ problem: "cant-publish" });
  });

  it("lets owners sign in with the owners' app for this tab only, to change editors", async () => {
    const site = setup();
    const page = browser(site);
    await page.host().startRedirect(false);
    await page.signInOnGitHub("olivia");
    const signedIn = await page.host().restore();
    expect(signedIn?.ownerAccess?.startRedirect).toBeDefined();
    await signedIn?.ownerAccess?.startRedirect?.();
    await page.signInOnGitHub("olivia");

    const backend = await page.host().restore();
    expect(page.href()).toBe(`${SITE}/admin/#/pages`);
    expect(backend?.ownerAccess?.active).toBe(true);
    await backend?.editors?.setRole({ id: "reader", login: "reader", role: "editor" }, "owner");
    expect(site.fake.collaborators.get("reader")).toBe("admin");
    // Nothing of the owner's sign-in is saved.
    expect(page.storage.local.values.size + page.storage.session.values.size).toBe(1);

    const editor = browser(site);
    await editor.host().startRedirect(false);
    await editor.signInOnGitHub("maria");
    const maria = await editor.host().restore();
    await maria?.ownerAccess?.startRedirect?.();
    await editor.signInOnGitHub("maria");
    const notOwner = await editor.host().restore();
    expect(notOwner?.ownerAccess?.active).toBe(false);
    expect(notOwner?.ownerAccess?.problem).toMatchObject({ problem: "not-owner" });
  });

  it("creates a site's repository for the setup page, with its first commit by the person", async () => {
    const site = setup();
    const page = browser(site, "https://setup.example/new-site/");
    expect(page.setupHost().canRedirect).toBe(true);
    await page.setupHost().startRedirect();
    await page.signInOnGitHub("maria");
    const account = await page.setupHost().restore();
    expect(page.href()).toBe("https://setup.example/new-site/");
    expect(account?.user.login).toBe("maria");
    const owners = (await account?.owners()) ?? [];
    expect(owners.map((owner) => [owner.path, owner.installUrl])).toEqual([
      ["maria", undefined],
      ["parish", undefined],
    ]);
    const [mine] = owners;
    if (!mine || !account) throw new Error("Not signed in");
    expect(await account.isAvailable(mine, "new-site")).toBe(true);

    const created = await account.createSite({
      owner: mine,
      name: "new-site",
      private: false,
      pages: true,
      files: [
        { path: "index.md", content: "Hello\n" },
        { path: ".github/workflows/deploy.yml", content: "on: push\n" },
      ],
      message: "Create the site",
    });
    expect(created).toMatchObject({
      repo: "maria/new-site",
      siteUrl: "https://maria.github.io/new-site/",
      signInInstallUrl: "https://github.com/apps/goodfellow-cms/installations/new",
      warnings: ["sign-in-not-installed"],
    });
    const repo = site.fake.created.get("maria/new-site");
    expect(repo?.repo.files("main").get(".github/workflows/deploy.yml")).toBe("on: push\n");
    expect(repo?.rulesets).toHaveLength(1);
    expect(site.fake.commitAuthors.get(repo?.repo.head("main") ?? "")).toMatchObject({ name: "Maria" });
    expect(await account.isAvailable(mine, "new-site")).toBe(false);

    const other = browser(site, "https://setup.example/new-site/");
    await other.setupHost().startRedirect();
    await other.signInOnGitHub("olivia");
    const olivia = await other.setupHost().restore();
    const [own] = (await olivia?.owners()) ?? [];
    expect(own?.installUrl).toBe("https://github.com/apps/goodfellow-cms-owner/installations/new");
    await expect(
      olivia?.createSite({ owner: own as never, name: "x", private: false, pages: false, files: [], message: "x" }),
    ).rejects.toMatchObject({ problem: "not-installed" });
  });
});
