import type { FakeRepo } from "@goodfellow-cms/core/testing";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";

const ABOUT = "content/pages/about.json";

function text(file: string | Uint8Array | undefined): string {
  return typeof file === "string" ? file : new TextDecoder().decode(file);
}

/** The starter's files, with the About page's heading changed by someone else since. */
function edited(repo: { write(path: string, content: string, message?: string, author?: string): string }) {
  const about = files()[ABOUT] ?? "";
  repo.write(ABOUT, about.replace('"text": "About us"', '"text": "Who we are"'), 'Update page "About"', "Maria");
}

async function restoreFirstVersion(page: Page) {
  await page.getByRole("link", { name: "Version history" }).click();
  await expect(page.getByRole("heading", { name: /^Version history: / })).toBeVisible();

  const versions = page.locator(".gfa-version");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText('Update page "About"');
  await expect(versions.nth(0)).toContainText("Maria");
  await expect(versions.nth(0)).toContainText("Current version");
  // The current version can't be restored, since it's what the site has.
  await expect(page.getByRole("button", { name: "Restore this version" })).toHaveCount(0);
  const preview = page.frameLocator(".gfa-version-preview iframe");
  await expect(preview.getByRole("heading", { name: "Who we are" })).toBeVisible();

  await versions.nth(1).click();
  await expect(preview.getByRole("heading", { name: "About us" })).toBeVisible();
  await page.getByRole("button", { name: "Restore this version" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore this version" }).click();
  await expect(page.getByText(/^Restored the version from /)).toBeVisible();
  // The restore is a version of its own, so it can be undone the same way.
  await expect(versions).toHaveCount(3);
  await expect(versions.nth(0)).toContainText(/^Restore "About.*" to the version from /);
}

test("restores an earlier version of a page on a GitHub site", async ({ page }) => {
  const fake = fakeGitHub({ repo: "parish/site", files: files() });
  edited(fake.repo);
  await routeToFake(page, "https://api.github.com", fake.handle);

  await page.goto(`${GITHUB_SITE}/admin/#/pages/edit?path=%2Fabout`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await restoreFirstVersion(page);
  expect(text(fake.repo.files().get(ABOUT))).toContain('"text": "About us"');
});

test("restores an earlier version of a page on a GitLab site", async ({ page }) => {
  const fake = fakeGitLab({ project: "parish/site", files: files(), tokens: { "glpat-test": { username: "maria" } } });
  edited(fake.repo);
  await routeToFake(page, "https://gitlab.com/api", fake.handle);

  await page.goto(`${GITLAB_SITE}/admin/#/pages/edit?path=%2Fabout`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await restoreFirstVersion(page);
  expect(text(fake.repo.files().get(ABOUT))).toContain('"text": "About us"');
});

const NEW_PAGE = "content/pages/new-page.json";
const PLACEHOLDER = "public/media/placeholder.svg";

/** A bulk change by someone else that went wrong: About rewritten, a page added and a picture deleted, in one publish. */
function bulkChange(repo: FakeRepo) {
  const about = files()[ABOUT] ?? "";
  repo.commit(
    [
      { path: ABOUT, content: about.replace('"text": "About us"', '"text": "Oops"') },
      {
        path: NEW_PAGE,
        content:
          '{\n  "version": 1,\n  "data": {\n    "root": {\n      "props": {\n        "title": "New page"\n      }\n    },\n    "content": []\n  }\n}\n',
      },
      { path: PLACEHOLDER, delete: true },
    ],
    "Bulk change",
    { author: "Maria" },
  );
}

async function restoreWholeSite(page: Page) {
  await expect(page.getByRole("link", { name: "Site history" })).toHaveAttribute("aria-current", "page");
  const publishes = page.locator(".gfa-version");
  await expect(publishes).toHaveCount(2);
  await expect(publishes.nth(0)).toContainText("Bulk change");
  await expect(publishes.nth(0)).toContainText("The site now");
  // The publish before the current one is chosen first, with what has changed since.
  await expect(publishes.nth(1)).toHaveAttribute("aria-pressed", "true");
  const since = page.locator(".gfa-site-changes");
  await expect(since).toContainText("Changed since");
  await expect(since).toContainText("(/about)");
  await expect(since).toContainText("New page (/new-page)");
  await expect(since).toContainText("placeholder.svg");

  await page.getByLabel("Page to look at").selectOption("/about");
  const preview = page.frameLocator(".gfa-version-preview iframe");
  await expect(preview.getByRole("heading", { name: "About us" })).toBeVisible();

  await page.getByRole("button", { name: "Restore the site as it was" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore the site as it was" }).click();
  const checks = page.getByRole("dialog", { name: "Publish anyway?" });
  const done = page.getByText(/^Restored the site as it was on /);
  await expect(checks.or(done)).toBeVisible();
  if (await checks.isVisible()) await checks.getByRole("button", { name: "Publish anyway" }).click();
  await expect(done).toBeVisible();
  // The restore is a publish of its own, so it can be undone the same way.
  await expect(publishes).toHaveCount(3);
  await expect(publishes.nth(0)).toContainText(/^Restore the site as it was on /);
}

function expectRestored(repo: FakeRepo) {
  expect(text(repo.files().get(ABOUT))).toContain('"text": "About us"');
  expect(repo.files().has(NEW_PAGE)).toBe(false);
  expect(text(repo.files().get(PLACEHOLDER))).toBe(files()[PLACEHOLDER]);
}

test("restores the whole site as it was on a GitHub site", async ({ page }) => {
  const fake = fakeGitHub({ repo: "parish/site", files: files() });
  bulkChange(fake.repo);
  await routeToFake(page, "https://api.github.com", fake.handle);

  await page.goto(`${GITHUB_SITE}/admin/#/settings/history`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await restoreWholeSite(page);
  expectRestored(fake.repo);
});

test("restores the whole site as it was on a GitLab site", async ({ page }) => {
  const fake = fakeGitLab({ project: "parish/site", files: files(), tokens: { "glpat-test": { username: "maria" } } });
  bulkChange(fake.repo);
  await routeToFake(page, "https://gitlab.com/api", fake.handle);

  await page.goto(`${GITLAB_SITE}/admin/#/settings/history`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await restoreWholeSite(page);
  expectRestored(fake.repo);
});
