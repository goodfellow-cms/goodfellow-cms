import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { BROKER_ADDRESSES } from "../scripts/site.mjs";
import { files, routeToFake } from "./backends.js";

// A production build of the starter whose config names a token broker (`builtSites.broker`), and the built broker,
// at another address, whose broker.json names the site's repository on the fake GitHub.
const { site, broker } = BROKER_ADDRESSES;
const CONFIG = `export default defineConfig({\n  broker: { url: "${broker}" },\n  blocks,\n});\n`;

async function setup(page: Page) {
  const content = files();
  const settings = JSON.parse(content["content/site.json"] ?? "{}");
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      ...content,
      "content/site.json": `${JSON.stringify({ ...settings, url: `${site}/` }, null, 2)}\n`,
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

  await admin.getByLabel("Site name").fill("St. Joseph's");
  await admin.getByRole("button", { name: "Publish" }).click();
  await expect(admin.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/site.json")).toContain("St. Joseph's");

  // The admin panel's own address keeps nothing of the sign-in: the broker has it.
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${site}/admin/`));
  const kept = await frame?.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(kept).not.toContain("good-token");
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
