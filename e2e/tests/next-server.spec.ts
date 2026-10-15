import { expect, type Page, test } from "@playwright/test";
import { NEXT_SERVER } from "../scripts/site.mjs";

const SITE = `http://localhost:${NEXT_SERVER.port}`;
const GITHUB = `http://127.0.0.1:${NEXT_SERVER.github}`;

/** Asks the site's fake GitHub, as only the site's server does. */
async function github<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB}${path}`, { headers: { authorization: `Bearer ${NEXT_SERVER.token}` } });
  return (await response.json()) as T;
}

/** Signs in with the test site's own sign-in, which comes back to the admin panel. */
async function signIn(page: Page, as: "alice" | "owen" | "nora") {
  await page.goto(`${SITE}/sign-in/?as=${as}`);
}

test.beforeEach(async () => {
  await fetch(`${GITHUB}/__reset`, { method: "POST" });
});

test("signs in with the site's own sign-in, and never sends the browser to GitHub", async ({ page }) => {
  const asked: string[] = [];
  page.on("request", (request) => asked.push(request.url()));
  await page.goto(`${SITE}/admin/`);
  await expect(page.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();
  await expect(page.getByText("Sign in with your account on this site to edit it.")).toBeVisible();
  // No token form: the site's server has the only token.
  await expect(page.getByLabel("Access token")).toHaveCount(0);

  await page.getByRole("link", { name: "Sign in" }).click();
  await page.getByRole("link", { name: "Sign in as alice" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await expect(page.locator(".gfa-account")).toContainText("Alice Editor");

  expect(asked.some((url) => url.startsWith(GITHUB) || url.includes("api.github.com"))).toBe(false);
  expect(await page.content()).not.toContain(NEXT_SERVER.token);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.goto(`${SITE}/admin/`);
  await expect(page.getByText("Sign in with your account on this site to edit it.")).toBeVisible();
});

test("publishes through the site's server, naming the editor as the author", async ({ page }) => {
  await signIn(page, "alice");
  await page.getByRole("link", { name: "About us", exact: true }).click();
  const heading = page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "About us" });
  await heading.click();
  await page.locator('.gfa-editor input[name="text"]:visible').fill("About our parish");
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const [commit] = await github<Array<{ commit: { message: string; author: { name: string; email?: string } } }>>(
    "/repos/parish/site/commits?path=content/pages/about.json",
  );
  expect(commit?.commit.author.name).toBe("Alice Editor");
  const about = await github<{ content: string }>("/repos/parish/site/contents/content/pages/about.json");
  expect(Buffer.from(about.content, "base64").toString("utf8")).toContain("About our parish");
});

test("leaves Site Settings, blocks and collections' settings to owners", async ({ page }) => {
  await signIn(page, "alice");
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  const nav = page.locator(".gfa-nav");
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Blocks" })).toHaveCount(0);
  await page.goto(`${SITE}/admin/#/settings/general`);
  await expect(page.getByRole("heading", { name: "Only the site's owners can change this." })).toBeVisible();
  await page.goto(`${SITE}/admin/#/collections`);
  await expect(page.getByRole("button", { name: "New collection" })).toHaveCount(0);

  // The server refuses, whatever the browser sends.
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

  await signIn(page, "owen");
  await expect(page.locator(".gfa-nav").getByRole("link", { name: "Settings" })).toBeVisible();
  await page.goto(`${SITE}/admin/#/settings/general`);
  await page.getByLabel("Site name").fill("St. Joseph's");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const [commit] = await github<Array<{ commit: { author: { name: string } } }>>(
    "/repos/parish/site/commits?path=content/site.json",
  );
  expect(commit?.commit.author.name).toBe("Owen Owner");
});

test("says so when the site's sign-in doesn't let someone edit", async ({ page }) => {
  await signIn(page, "nora");
  await expect(page.getByText("You're signed in, but your account isn't allowed to edit this site.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out" })).toHaveAttribute("href", "/sign-out/");
});

test("refuses requests from other sites", async ({ request }) => {
  const forged = await request.get(`${SITE}/api/goodfellow/revision/`, {
    headers: { cookie: "test-session=alice", origin: "https://evil.example" },
  });
  expect(forged.status()).toBe(403);
  const crossSite = await request.get(`${SITE}/api/goodfellow/revision/`, {
    headers: { cookie: "test-session=alice", "x-goodfellow-request": "1", "sec-fetch-site": "cross-site" },
  });
  expect(crossSite.status()).toBe(403);
});

test("writes with the site's AI service and key, which the browser never has", async ({ page }) => {
  await signIn(page, "alice");
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await expect(page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "About us" })).toBeVisible();
  await page.locator(".gfa-editor").getByText("AI", { exact: true }).first().click();
  const panel = page.locator(".gfa-ai");
  await expect(panel.getByRole("heading", { name: "Write with AI" })).toBeVisible();

  const provider = panel.getByLabel("AI service");
  await expect(provider.locator("option").first()).toHaveText("OpenAI (provided by this site)");
  await expect(panel.getByText("This site provides OpenAI, so you don't need a key of your own.")).toBeVisible();
  await expect(panel.getByLabel("API key")).toHaveCount(0);
  await panel.getByLabel("Model").fill("test-model");
  await panel.getByLabel("What should it write?").fill("A heading");
  await panel.getByRole("button", { name: "Write it" }).click();
  await expect(
    page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "Written by the site's AI" }),
  ).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    NEXT_SERVER.aiKey,
  );
});

test("searches the pages its build rendered, from the index it made after", async ({ page }) => {
  await page.goto(`${SITE}/search/`);
  // The search box starts working once the page's scripts have loaded.
  await page.waitForLoadState("networkidle");
  await page.getByRole("searchbox", { name: "Search the site" }).fill("about");
  const result = page.getByRole("search").getByRole("link", { name: /^About us/ });
  await expect(result).toHaveAttribute("href", "/about/");
  await result.click();
  await expect(page).toHaveURL(`${SITE}/about/`);
});

test("serves calendar files written after its build, as static files", async ({ request }) => {
  const calendar = await request.get(`${SITE}/calendars/events.ics`);
  expect(calendar.status()).toBe(200);
  expect(calendar.headers()["content-type"]).toContain("text/calendar");
  expect(await calendar.text()).toContain("SUMMARY:Open house");
  expect((await request.get(`${SITE}/calendars/events/open-house.ics`)).status()).toBe(200);
});
