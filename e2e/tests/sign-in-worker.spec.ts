import { GOODFELLOW_SIGN_IN } from "@goodfellow-cms/github";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { testSignIn } from "@goodfellow-cms/worker/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";

/** The site's own address, where the built GitHub site is served, as its host would serve it. */
const SITE = "https://parish.example";

/** The starter's files, with the site's address in its settings, which the worker gives tokens to. */
function siteFiles(): Record<string, string> {
  const all = files();
  const settings = JSON.parse(all["content/site.json"] ?? "{}") as Record<string, unknown>;
  return { ...all, "content/site.json": `${JSON.stringify({ ...settings, url: `${SITE}/` }, null, 2)}\n` };
}

async function setup(page: Page, options: { installed?: boolean } = {}) {
  const kit = await testSignIn({
    edit: options.installed === false ? [] : [{ id: 11, account: "parish", repositories: ["parish/site"] }],
    owner: [{ id: 21, account: "parish", accountType: "Organization", repositories: ["parish/site"] }],
  });
  const fake = fakeGitHub({
    repo: "parish/site",
    files: siteFiles(),
    tokens: {
      maria: { login: "maria", name: "Maria", id: 4242 },
      olivia: { login: "olivia", name: "Olivia", admin: true },
    },
    accounts: ["anne"],
    deployAfterChecks: 0,
    apps: [kit.apps.edit, kit.apps.owner],
  });
  const worker = kit.worker(fake.fetch);
  let login = "maria";

  // The built site, at its own address.
  await page.route(
    (url) => url.href.startsWith(SITE),
    async (route) => {
      const url = new URL(route.request().url());
      const response = await fetch(`${GITHUB_SITE}${url.pathname}${url.search}`, { redirect: "manual" });
      const headers = Object.fromEntries(response.headers);
      delete headers["content-encoding"];
      delete headers["content-length"];
      if (headers.location) headers.location = headers.location.replace(GITHUB_SITE, SITE);
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    },
  );
  await routeToFake(page, "https://api.github.com", fake.handle);
  /** GitHub's sign-in page, where the person has already agreed: it goes straight back to the worker. */
  const authorize = (url: URL) => {
    const back = new URL(url.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("code", fake.authorize(login, url.searchParams.get("client_id") ?? ""));
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return new Response(null, { status: 302, headers: { location: back.toString() } });
  };
  const isAuthorize = (url: URL) => url.origin === "https://github.com" && url.pathname === "/login/oauth/authorize";

  // Goodfellow's sign-in worker, the same code Cloudflare runs. Browsers say which page is asking.
  await page.route(
    (url) => url.href.startsWith(GOODFELLOW_SIGN_IN) || isAuthorize(url),
    async (route) => {
      const request = route.request();
      const body = request.postDataBuffer();
      const url = new URL(request.url());
      let response = isAuthorize(url)
        ? authorize(url)
        : await worker.fetch(
            new Request(url, {
              method: request.method(),
              headers: await request.allHeaders(),
              body: body && request.method() !== "GET" ? new Uint8Array(body) : undefined,
            }),
          );
      // Playwright doesn't see where a redirect it answered goes, so the worker's and GitHub's are followed here.
      for (;;) {
        const next = response.status === 302 ? new URL(response.headers.get("location") ?? "") : undefined;
        if (!next) break;
        if (next.href.startsWith(GOODFELLOW_SIGN_IN)) response = await worker.fetch(new Request(next));
        else if (isAuthorize(next)) response = authorize(next);
        else {
          // Back to the admin panel, which the browser loads as a page of its own.
          await route.fulfill({
            contentType: "text/html",
            body: `<script>location.replace(${JSON.stringify(next.href)})</script>`,
          });
          return;
        }
      }
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    },
  );
  return {
    fake,
    signInAs: (name: string) => {
      login = name;
    },
  };
}

async function signIn(page: Page, path = "/admin/") {
  await page.goto(`${SITE}${path}`);
  await page.getByLabel("Stay signed in on this device").check();
  await page.getByRole("button", { name: "Sign in with GitHub" }).click();
}

test("editors sign in with GitHub through the sign-in worker, and publish as themselves", async ({ page }) => {
  const { fake } = await setup(page);
  await signIn(page);
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await expect(page.locator(".gfa-account")).toContainText("Maria");
  expect(page.url()).toBe(`${SITE}/admin/`);
  // What's kept in the browser is the worker's sealed session, never a GitHub token.
  const saved = await page.evaluate(() => localStorage.getItem("goodfellow:github:parish/site"));
  expect(saved).toContain('"type":"worker"');
  expect(saved).not.toMatch(/gh[usr]_/);

  await page.getByRole("link", { name: "About us", exact: true }).click();
  await page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "About us" }).click();
  await page.locator('.gfa-editor input[name="text"]:visible').fill("About our parish");
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const head = fake.repo.head();
  expect(fake.repo.files(head).get("content/pages/about.json")).toContain("About our parish");
  expect(fake.commitAuthors.get(head)).toMatchObject({ name: "Maria", email: "4242+maria@users.noreply.github.com" });
  // The admin panel's token was for this repository only, with only what editors need.
  // (Its other tokens, which only read the site's address, are revoked as soon as they've been used.)
  const editorsToken = fake.issued.find((token) => token.kind === "installation" && !token.revoked);
  expect(editorsToken).toMatchObject({
    app: "goodfellow-cms",
    repositories: ["parish/site"],
    permissions: { contents: "write", metadata: "read", deployments: "read", actions: "read", pages: "read" },
  });

  await page.reload();
  await expect(page.locator(".gfa-account")).toContainText("Maria");
});

test("an owner signs in with the owners' app for this tab to change editors", async ({ page }) => {
  const { fake, signInAs } = await setup(page);
  signInAs("olivia");
  await signIn(page, "/admin/#/settings/editors");
  const rows = page.locator(".gfa-editors tbody tr");
  await expect(rows.filter({ hasText: "olivia" })).toContainText("Owner");
  await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign in as an owner with GitHub" }).click();
  await page.getByLabel("Their GitHub username").fill("anne");
  expect(page.url()).toBe(`${SITE}/admin/#/settings/editors`);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(rows.filter({ hasText: "anne" })).toContainText("Invited, hasn't accepted yet");
  expect(fake.invitations.map((invitation) => invitation.login)).toEqual(["anne"]);
  expect(
    fake.issued.find((token) => token.kind === "installation" && token.app === "goodfellow-cms-owner"),
  ).toBeDefined();
});

test("explains when Goodfellow isn't installed on the site, and tokens still work", async ({ page }) => {
  await setup(page, { installed: false });
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("an owner of the site needs to install Goodfellow");
  await expect(page.getByRole("link", { name: "Install Goodfellow on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/apps/goodfellow-cms/installations/new",
  );
  await expect(page.getByLabel("Access token")).toBeVisible();
});
