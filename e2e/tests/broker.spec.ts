import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { BROKER_ADDRESSES } from "../scripts/site.mjs";
import { files, routeToFake } from "./backends.js";

// A production build of the starter whose config names a token broker (`builtSites.broker`), and the built broker,
// at another address, whose broker.json names the site's repository on the fake GitHub.
const { site, broker } = BROKER_ADDRESSES;
const CONFIG = `export default defineConfig({\n  broker: { url: "${broker}" },\n  blocks,\n});\n`;

async function setup(page: Page, siteUrl = `${site}/`) {
  const content = files();
  const settings = JSON.parse(content["content/site.json"] ?? "{}");
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      ...content,
      "content/site.json": `${JSON.stringify({ ...settings, url: siteUrl }, null, 2)}\n`,
      "goodfellow.config.tsx": CONFIG,
    },
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  return fake;
}

async function signIn(page: Page, route = "") {
  await page.goto(`${broker}/${route}`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  return page.frameLocator(".broker-frame");
}

test("signs in at the broker, which shows the admin panel and publishes for it", async ({ page }) => {
  const fake = await setup(page);
  await page.goto(`${broker}/`);
  await expect(page.getByRole("heading", { name: "Sign in to edit parish/site" })).toBeVisible();
  const admin = await signIn(page, "#/settings/general");
  await expect(page.locator(".broker-bar")).toContainText("Signed in as Maria");
  await expect(page.locator(".broker-bar")).toContainText(`Showing ${new URL(site).origin}`);

  await admin.getByLabel("Site name").fill("St. Joseph's");
  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(admin.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/site.json")).toContain("St. Joseph's");

  // The admin panel's own address keeps nothing of the sign-in: the broker has it.
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${site}/admin/`));
  const kept = await frame?.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(kept).not.toContain("good-token");
});

test("answers only the admin panel in its own frame, never another window or frame", async ({ page }) => {
  await setup(page);
  const admin = await signIn(page);
  await expect(admin.getByRole("link", { name: "About us", exact: true }).first()).toBeVisible();
  // Asks as the admin panel does, and says whether the broker answered.
  const ask = async () => {
    let answered = false;
    window.addEventListener("message", (event) => {
      if ((event.data as { type?: unknown } | null)?.type === "goodfellow:broker-connect") answered = true;
    });
    (window.parent === window ? window : window.parent).postMessage({ type: "goodfellow:broker-ready" }, "*");
    await new Promise((done) => setTimeout(done, 1000));
    return answered;
  };
  // The broker's own page.
  expect(await page.evaluate(ask)).toBe(false);
  // Another frame at the admin panel's own address.
  await page.evaluate((src) => {
    const other = document.createElement("iframe");
    other.src = src;
    document.body.append(other);
  }, `${site}/`);
  await expect.poll(() => page.frames().some((frame) => frame.url() === `${site}/`)).toBe(true);
  const other = page.frames().find((frame) => frame.url() === `${site}/`);
  expect(await other?.evaluate(ask)).toBe(false);
});

test("won't show an admin panel at its own address, where it could read the sign-in", async ({ page }) => {
  // An editor who can change the site's settings points its address at another site on the broker's host.
  await setup(page, `${broker}/elsewhere/`);
  await signIn(page);
  await expect(page.getByRole("alert")).toContainText("The admin panel is at this page's own address");
  await expect(page.locator(".broker-frame")).toHaveCount(0);
});

test("edits a page in the editor's frame, inside the admin panel's", async ({ page }) => {
  const fake = await setup(page);
  const admin = await signIn(page);
  await admin.getByRole("link", { name: "About us", exact: true }).click();
  const editor = admin.frameLocator("iframe.gfa-editor-frame");
  await editor.locator(".gf-canvas").first().getByRole("heading", { name: "About us" }).click();
  await editor.locator('input[name="text"]:visible').fill("About our parish");
  await admin.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
  await expect(admin.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/pages/about.json")).toContain('"text": "About our parish"');
});

test("asks in its own part of the page before publishing the site's code", async ({ page }) => {
  const fake = await setup(page);
  const admin = await signIn(page, "#/settings/security");
  await expect(admin.getByText(`Editors sign in at ${broker}`)).toBeVisible();

  // Stopping the broker changes goodfellow.config.tsx, which is the site's code.
  await admin.getByRole("button", { name: "Stop using the sign-in page" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Stop using the sign-in page" }).click();
  const ask = page.locator("dialog.broker-dialog");
  await expect(ask).toContainText("goodfellow.config.tsx");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(admin.getByText("The sign-in page's address couldn't be published.")).toBeVisible();
  expect(fake.repo.files().get("goodfellow.config.tsx")).toBe(CONFIG);

  await admin.getByRole("dialog").getByRole("button", { name: "Stop using the sign-in page" }).click();
  await ask.getByRole("button", { name: "Publish" }).click();
  await expect.poll(() => fake.repo.files().get("goodfellow.config.tsx")).not.toContain("broker:");
});

test("the admin panel doesn't sign in at its own address, and says where to", async ({ page }) => {
  await setup(page);
  await page.goto(`${site}/admin/`);
  await expect(page.getByRole("link", { name: "Go to the sign-in page" })).toHaveAttribute("href", `${broker}/`);
  await expect(page.getByLabel("Access token")).toHaveCount(0);
});

test("the broker refuses to be shown inside another page", async ({ page }) => {
  await page.goto(`${site}/`);
  await page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.src = src;
    document.body.append(frame);
  }, `${broker}/`);
  const frame = page.frameLocator("iframe").last();
  await expect(frame.getByText("This page can't be shown inside another page.")).toBeVisible();
  await expect(frame.getByLabel("Access token")).toHaveCount(0);
});
