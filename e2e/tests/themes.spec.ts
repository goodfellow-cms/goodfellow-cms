import { existsSync } from "node:fs";
import { join } from "node:path";
import { type FakeTheme, fakeThemes, sampleThemeFiles } from "@goodfellow-cms/core/testing";
import type { Page } from "@playwright/test";
import { site } from "../scripts/site.mjs";
import { expect, readJson, readSiteFile, test, writeSiteFile } from "./helpers.js";

/** npm's registry and jsDelivr, answering for the themes given. */
async function routeToThemes(page: Page, themes: FakeTheme[]) {
  const fake = fakeThemes({ themes });
  for (const origin of ["https://registry.npmjs.org", "https://cdn.jsdelivr.net"]) {
    await page.route(`${origin}/**`, (route) => {
      const answer = fake.handle(route.request().url());
      return route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
  }
  return fake;
}

/** Publishes, past the site checks' warnings if there are any. */
async function publishPast(page: Page, button: string, done: RegExp) {
  await page.getByRole("button", { name: button, exact: true }).click();
  const checks = page.getByRole("dialog", { name: "Publish anyway?" });
  const notice = page.getByText(done);
  await expect(checks.or(notice)).toBeVisible({ timeout: 30_000 });
  if (await checks.isVisible()) await checks.getByRole("button", { name: "Publish anyway" }).click();
  await expect(notice).toBeVisible({ timeout: 30_000 });
}

function harbor(): FakeTheme {
  return {
    name: "goodfellow-theme-harbor",
    description: "Navy and cream, with rounded cards.",
    publisher: "harbor-studio",
    releases: [
      {
        version: "1.0.0",
        provenance: true,
        repository: "https://github.com/harbor-studio/goodfellow-theme-harbor",
        files: sampleThemeFiles({
          header: true,
          css: ".gf-section { background-image: url(https://images.example/paper.png); }\n",
        }),
      },
      { version: "1.1.0", age: 1, files: sampleThemeFiles({ header: true, primary: "#14324f" }) },
    ],
  };
}

test("installs a theme, updates it keeping what the owner changed, and removes it", async ({ page }) => {
  test.setTimeout(120_000);
  const theme = harbor();
  await routeToThemes(page, [theme, { name: "unrelated-theme", releases: [] }]);

  await page.goto("/admin#/settings/themes");
  await expect(page.getByText("No theme is installed.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Harbor" })).toBeVisible();
  await page.getByRole("button", { name: "Show Harbor" }).click();

  const details = page.getByRole("region", { name: "Harbor" });
  await expect(details.getByText("Navy and cream, with rounded cards.")).toBeVisible();
  await expect(
    details.getByText("Built from https://github.com/harbor-studio/goodfellow-theme-harbor", { exact: false }),
  ).toBeVisible();
  // 1.1.0 is a day old, so 1.0.0 is offered.
  await expect(
    details.getByText("Version 1.1.0 can be installed once it's 3 days old", { exact: false }),
  ).toBeVisible();
  await expect(details.getByText("https://images.example/paper.png")).toBeVisible();

  // The preview shows the site with the theme before anything is published.
  const preview = details.frameLocator("iframe");
  await expect(preview.getByRole("heading", { name: "Welcome to my site" })).toBeVisible();
  await expect(preview.locator("main section").first()).toHaveCSS("background-color", "rgb(30, 58, 95)");
  await details.getByRole("checkbox", { name: "Use the theme's header and footer", exact: false }).check();
  await expect(preview.locator("header section").first()).toHaveCSS("background-color", "rgb(238, 241, 244)");

  await publishPast(page, "Install and publish", /^Harbor is installed\./);
  const settings = readJson("content/site.json") as { theme: Record<string, Record<string, string>> };
  expect(settings.theme.colors?.primary).toBe("#1e3a5f");
  expect(settings.theme.parts).toEqual({ "gf-button": "rounded-full", "gf-heading": "tracking-tight" });
  expect(readSiteFile("content/styles/custom.css")).toMatch(/^\/\* Theme CSS: goodfellow-theme-harbor 1\.0\.0\./);
  expect(readSiteFile("content/layout/header.json")).toContain("Section-harbor-header");
  expect(readJson("content/styles/theme.json")).toMatchObject({ name: "goodfellow-theme-harbor", release: "1.0.0" });
  await expect(page.locator(".gfa-theme-installed")).toContainText("Harbor");

  // The owner changes the main color, then 1.1.0 is old enough to install.
  settings.theme.colors = { ...settings.theme.colors, primary: "#7c2d12" };
  writeSiteFile("content/site.json", `${JSON.stringify(settings, null, 2)}\n`);
  const newer = theme.releases[1];
  if (newer) newer.age = 10;
  await page.reload();
  await page.getByRole("button", { name: "Update to 1.1.0" }).click();
  await expect(
    details.getByText("You changed these since the version before, so they stay as you set them: Colors."),
  ).toBeVisible();
  await publishPast(page, "Update to 1.1.0", /^Harbor is updated to version 1\.1\.0\./);
  expect((readJson("content/site.json") as typeof settings).theme.colors?.primary).toBe("#7c2d12");
  expect(readJson("content/styles/theme.json")).toMatchObject({ release: "1.1.0" });

  await page.locator(".gfa-theme-installed").getByRole("button", { name: "Remove" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove Harbor?" });
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Harbor is removed.")).toBeVisible({ timeout: 30_000 });
  expect(existsSync(join(site as string, "content/styles/theme.json"))).toBe(false);
  expect(readSiteFile("content/styles/custom.css")).not.toContain("Theme CSS");
  // The owner's own color stays; the theme's background goes back to the default.
  const removed = readJson("content/site.json") as typeof settings;
  expect(removed.theme.colors?.primary).toBe("#7c2d12");
  expect(removed.theme.colors?.background).toBeUndefined();
});

test("says when no release of a theme works with this Goodfellow release", async ({ page }) => {
  await routeToThemes(page, [
    {
      name: "goodfellow-theme-old",
      releases: [{ version: "1.0.0", goodfellow: "^0.0.1", files: sampleThemeFiles({ title: "Old" }) }],
    },
  ]);
  await page.goto("/admin#/settings/themes");
  await page.getByRole("button", { name: "Show Old" }).click();
  await expect(
    page.getByText("No version of this theme says it works with Goodfellow", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Install and publish" })).toHaveCount(0);
});
