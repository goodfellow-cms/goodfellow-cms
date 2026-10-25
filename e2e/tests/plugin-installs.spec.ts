import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FakePlugin, fakeFileBytes, fakePlugins, samplePluginFiles } from "@goodfellow-cms/core/testing";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_ADDRESSES } from "../scripts/site.mjs";
import { files, routeToFake } from "./backends.js";

// Installing plugins from Site Settings' Plugins screen, which needs the admin panel out of the site's pages'
// reach: the admin address test site (`builtSites.admin`), against fakes of GitHub, npm and jsDelivr.
const { admin } = ADMIN_ADDRESSES;
const starter = join(import.meta.dirname, "../../templates/starter");
/** The test site's own config, which doesn't list installed plugins yet. */
const adminConfig = () => readFileSync(join(import.meta.dirname, "../.site-admin/goodfellow.config.tsx"), "utf8");

const GUESTBOOK: FakePlugin = {
  name: "goodfellow-plugin-guestbook",
  description: "Lets visitors sign a guestbook.",
  publisher: "guestbook-studio",
  releases: [
    {
      version: "1.0.0",
      provenance: true,
      repository: "https://github.com/guestbook-studio/goodfellow-plugin-guestbook",
      files: samplePluginFiles(),
      dependencies: { "tiny-store": "^2.0.0" },
    },
  ],
};

const TINY_STORE: FakePlugin = {
  name: "tiny-store",
  releases: [{ version: "2.0.0", files: { "index.js": "module.exports = (code) => eval(code);\n" } }],
};

/** npm's registry and jsDelivr, answering for the plugins given and the packages they need. */
async function routeToPlugins(page: Page) {
  const fake = fakePlugins({ plugins: [GUESTBOOK], packages: [TINY_STORE] });
  for (const origin of ["https://registry.npmjs.org", "https://cdn.jsdelivr.net", "https://data.jsdelivr.com"]) {
    await page.route(`${origin}/**`, (route) => {
      const answer = fake.handle(route.request().url());
      return route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
  }
}

/** The site on the fake GitHub, with the files installing a plugin changes, as the starter has them. */
async function setup(
  page: Page,
  { deploy = readFileSync(join(starter, ".github/workflows/deploy.yml"), "utf8") } = {},
) {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      ...files(),
      "package.json": readFileSync(join(starter, "package.json"), "utf8"),
      "goodfellow.config.tsx": adminConfig(),
      ".github/workflows/deploy.yml": deploy,
    },
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await routeToPlugins(page);
  await page.goto(`${admin}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await page.goto(`${admin}/admin/#/settings/plugins`);
  return fake;
}

test("installs a plugin after showing what it asks to do and what its code does, then removes it", async ({ page }) => {
  const fake = await setup(page);
  await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show Guestbook" }).click();

  const details = page.getByRole("region", { name: "Guestbook" });
  await expect(details).toContainText("Built from https://github.com/guestbook-studio/goodfellow-plugin-guestbook");
  await expect(details).toContainText("Reach these addresses from the admin panel: https://guestbook.example.com");
  await expect(details).toContainText("Read and publish these files: content/guestbook.json");
  // Its own code requests the address it asked for, and a package it needs runs code made from text.
  await expect(details).toContainText("goodfellow-plugin-guestbook 1.0.0");
  await expect(details).toContainText("makes network requests (1)");
  await expect(details).toContainText("tiny-store 2.0.0");
  await expect(details).toContainText("runs code made from text, which can't be read beforehand (1)");

  await details.getByRole("button", { name: "Install", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Install Guestbook?" });
  await expect(confirm).toContainText("goodfellow-plugin-guestbook version 1.0.0 asks to:");
  await expect(confirm).toContainText("Your site's settings file is changed too");
  await confirm.getByRole("button", { name: "Install and publish" }).click();
  await expect(page.getByText("Guestbook is installed.")).toBeVisible();

  const text = (path: string) => new TextDecoder().decode(fakeFileBytes(fake.repo.files().get(path) ?? ""));
  expect(JSON.parse(text("package.json")).dependencies["goodfellow-plugin-guestbook"]).toBe("1.0.0");
  expect(text("plugins/installed/index.ts")).toContain('import plugin0 from "goodfellow-plugin-guestbook";');
  expect(text("goodfellow.config.tsx")).toContain("plugins: installedPlugins,");
  expect(fake.repo.commitAt(fake.repo.head())?.message).toBe("Install the Guestbook plugin, version 1.0.0");

  const installed = page.locator(".gfa-theme-installed", { hasText: "Guestbook" });
  await expect(installed).toContainText("version 1.0.0");
  await installed.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove Guestbook?" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Guestbook is removed.")).toBeVisible();
  expect(JSON.parse(text("package.json")).dependencies).not.toHaveProperty("goodfellow-plugin-guestbook");
});

test("installs nothing where the site's build wouldn't write the lockfile", async ({ page }) => {
  await setup(page, { deploy: "name: Deploy\njobs:\n  build:\n    steps:\n      - run: npm ci\n" });
  await expect(page.getByText("A developer needs to update its build setup")).toBeVisible();
  await page.getByRole("button", { name: "Show Guestbook" }).click();
  await expect(page.getByRole("region", { name: "Guestbook" })).toContainText("What it asks to do");
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
});
