import { expect, type Page, test } from "@playwright/test";
import { COMPANY, COMPANY_PASSWORD, COMPANY_PEOPLE } from "../scripts/site.mjs";
import { editor } from "./helpers.js";

// The company example, built into a Cloudflare Worker with vinext and served in workerd with a local D1 database,
// as Cloudflare would: the full-stack contract `next-server.spec.ts` checks on Node, here on Workers, with the
// example's own sign-in (Better Auth) and accounts.
const SITE = `http://localhost:${COMPANY.port}`;
const GITHUB = `http://127.0.0.1:${COMPANY.github}`;

/** Asks the site's fake content repository, as only the site's server does. */
async function github<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB}${path}`, { headers: { authorization: `Bearer ${COMPANY.token}` } });
  return (await response.json()) as T;
}

/** Signs in with the site's own form, which goes on to `next`. */
async function signIn(page: Page, as: keyof typeof COMPANY_PEOPLE, next = "/admin/") {
  await page.goto(`${SITE}/sign-in/?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(COMPANY_PEOPLE[as].email);
  await page.getByLabel("Password").fill(COMPANY_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${SITE}${next}`);
}

test.beforeEach(async () => {
  await fetch(`${GITHUB}/__reset`, { method: "POST" });
});

test("serves every page from what the build rendered, rendering none for a visit", async ({ request }) => {
  for (const address of ["/", "/about/", "/news/", "/news/welcome/"]) {
    // The first visit after the Worker starts may fill a cache; every one after is served as the build rendered it.
    await request.get(`${SITE}${address}`);
    const page = await request.get(`${SITE}${address}`);
    expect(page.status(), address).toBe(200);
    expect(page.headers()["x-vinext-cache"], address).toBe("HIT");
  }
  expect((await request.get(`${SITE}/no-such-page/`)).status()).toBe(404);
});

test("keeps the members' page to people who are signed in", async ({ page, request }) => {
  const signedOut = await request.get(`${SITE}/members/`, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(new URL(signedOut.headers().location ?? "", SITE).href).toBe(`${SITE}/sign-in/?next=%2Fmembers%2F`);

  await page.goto(`${SITE}/members/`);
  await expect(page).toHaveURL(`${SITE}/sign-in/?next=%2Fmembers%2F`);
  await page.getByLabel("Email address").fill(COMPANY_PEOPLE.editor.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email address and password don't match an account here.");

  await page.getByLabel("Password").fill(COMPANY_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${SITE}/members/`);
  // The page is the same for everyone; the browser fills in who's here.
  await expect(page.getByText(`Signed in as ${COMPANY_PEOPLE.editor.name}.`)).toBeVisible();

  await page.getByRole("link", { name: "Sign out" }).click();
  await page.goto(`${SITE}/members/`);
  await expect(page).toHaveURL(`${SITE}/sign-in/?next=%2Fmembers%2F`);
});

test("publishes to the content repository through the Worker, naming the editor as the author", async ({ page }) => {
  await signIn(page, "editor");
  await expect(page.locator(".gfa-account")).toContainText(COMPANY_PEOPLE.editor.name);
  await page.getByRole("link", { name: "About us", exact: true }).click();
  const heading = editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" });
  await heading.click();
  await editor(page).locator('input[name="text"]:visible').fill("About our company");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const [commit] = await github<Array<{ commit: { author: { name: string } } }>>(
    `/repos/${COMPANY.repo}/commits?path=content/pages/about.json`,
  );
  expect(commit?.commit.author.name).toBe(COMPANY_PEOPLE.editor.name);
  const about = await github<{ content: string }>(`/repos/${COMPANY.repo}/contents/content/pages/about.json`);
  expect(Buffer.from(about.content, "base64").toString("utf8")).toContain("About our company");
  // The token the Worker publishes with never reaches the browser.
  expect(await page.content()).not.toContain(COMPANY.token);
});

test("leaves Site Settings to the site's admins, whatever an editor's browser sends", async ({ page }) => {
  await signIn(page, "editor");
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await expect(page.locator(".gfa-nav").getByRole("link", { name: "Settings" })).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const { revision } = await (
      await fetch("/api/goodfellow/revision/", { headers: { "x-goodfellow-request": "1" } })
    ).json();
    const response = await fetch("/api/goodfellow/write/", {
      method: "POST",
      headers: { "x-goodfellow-request": "1", "content-type": "application/json" },
      body: JSON.stringify({
        changes: [{ path: "content/site.json", content: "{}" }],
        message: "Retitle",
        expectedRevision: revision,
      }),
    });
    return response.status;
  });
  expect(status).toBe(403);

  await page.goto(`${SITE}/sign-out/`);
  await signIn(page, "admin");
  await page.locator(".gfa-nav").getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Site name").fill("Northwind");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const [commit] = await github<Array<{ commit: { author: { name: string } } }>>(
    `/repos/${COMPANY.repo}/commits?path=content/site.json`,
  );
  expect(commit?.commit.author.name).toBe(COMPANY_PEOPLE.admin.name);
});

test("tells the admin panel where to sign in, and refuses requests from other sites", async ({ request }) => {
  const session = await request.get(`${SITE}/api/goodfellow/session/`, {
    headers: { "x-goodfellow-request": "1", "sec-fetch-site": "same-origin" },
  });
  expect(await session.json()).toMatchObject({ signedIn: false, signIn: "/sign-in/?next=/admin/" });
  const crossSite = await request.get(`${SITE}/api/goodfellow/revision/`, {
    headers: { "x-goodfellow-request": "1", "sec-fetch-site": "cross-site" },
  });
  expect(crossSite.status()).toBe(403);
});
