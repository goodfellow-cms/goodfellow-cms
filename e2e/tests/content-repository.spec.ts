import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, test } from "@playwright/test";
import { builtSites } from "../scripts/site.mjs";
import { files, routeToFake } from "./backends.js";

const SITE = `http://localhost:${builtSites.content.port}`;

test("builds the site with content linked from a repository of its own", async ({ page, request }) => {
  await page.goto(`${SITE}/about/`);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  expect((await request.get(`${SITE}/media/logo.svg`)).status()).toBe(200);
});

test("publishes to the content repository, and leaves blocks and updates to the code's", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site-content",
    files: files(),
    tokens: { "good-token": { login: "maria", name: "Maria" } },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();

  const nav = page.locator(".gfa-nav");
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Blocks" })).toHaveCount(0);
  await page.goto(`${SITE}/admin/#/blocks`);
  await expect(page.getByRole("heading", { name: "This site's blocks are added by its developer." })).toBeVisible();
  await page.goto(`${SITE}/admin/#/settings/updates`);
  await expect(page.getByText("This site's code is kept apart from its content")).toBeVisible();

  await page.goto(`${SITE}/admin/#/settings/general`);
  await page.getByLabel("Site name").fill("St. Joseph's");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/site.json")).toContain("St. Joseph's");
});
