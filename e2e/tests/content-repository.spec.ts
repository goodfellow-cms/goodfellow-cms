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
  // The code repository, where the site's updates run.
  fake.addRepo("parish/site", {
    files: {
      "package.json": JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.3.0" } }),
      ".github/workflows/update.yml": "run: npx goodfellow update --publish\n",
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();

  const nav = page.locator(".gfa-nav");
  await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Blocks", exact: true })).toHaveCount(0);
  await page.goto(`${SITE}/admin/#/blocks`);
  await expect(page.getByRole("heading", { name: "This site's blocks are added by its developer." })).toBeVisible();
  await page.goto(`${SITE}/admin/#/settings/updates`);
  // The Updates screen follows the code repository's updates.
  await expect(page.getByText("This site's code is kept apart from its content, at parish/site")).toBeVisible();
  await expect(page.getByRole("link", { name: "See it on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/parish/site",
  );
  await expect(page.getByText("This site uses Goodfellow 0.3.0.")).toBeVisible();
  await expect(page.getByText("No update has run yet.")).toBeVisible();

  await page.goto(`${SITE}/admin/#/settings/general`);
  await page.getByLabel("Site name").fill("St. Joseph's");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/site.json")).toContain("St. Joseph's");
});

test("sets up an admin address in the code's config, with what a developer runs", async ({ page }) => {
  const contentFiles = files();
  const settings = JSON.parse(contentFiles["content/site.json"] ?? "{}");
  contentFiles["content/site.json"] =
    `${JSON.stringify({ ...settings, url: "https://parish.example.org" }, null, 2)}\n`;
  // Vercel builds the site from the content repository.
  contentFiles["vercel.ts"] = "export const config = {\n  framework: null,\n  headers: [],\n};\n";
  const fake = fakeGitHub({
    repo: "parish/site-content",
    files: contentFiles,
    tokens: { "good-token": { login: "maria", name: "Maria" } },
  });
  const config = "export default defineConfig({\n  blocks,\n});\n";
  fake.addRepo("parish/site", { files: { "goodfellow.config.tsx": config, "package.json": "{}" } });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();

  await page.goto(`${SITE}/admin/#/settings/domain`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Admin address" }) });
  await expect(section.getByText("so a developer finishes setting it up there")).toBeVisible();
  await section.getByLabel("Admin address").fill("admin.example.org");
  await section.getByRole("button", { name: "Give the admin panel this address" }).click();
  // Nothing is published: the config is in the code's repository, which a developer changes.
  await expect(section.getByText("npx goodfellow admin add admin.example.org")).toBeVisible();
  await expect(section.getByText("npx goodfellow admin check")).toBeVisible();
  expect(fake.repo.files().has("goodfellow.config.tsx")).toBe(false);

  // Once a developer has run the commands and published the code, the screen reads it from there.
  fake.addRepo("parish/site", {
    files: {
      "goodfellow.config.tsx": config.replace(
        "defineConfig({\n",
        'defineConfig({\n  admin: { url: "https://admin.example.org", checked: true },\n',
      ),
      "package.json": "{}",
    },
  });
  await page.reload();
  await expect(section.getByText("The admin panel's address is https://admin.example.org.")).toBeVisible();
  await expect(section.getByText("npx goodfellow admin remove")).toBeVisible();
});
