import { cloudflareSetupFiles } from "@goodfellow-cms/core";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";
import { editor } from "./helpers.js";

/** The starter as a site Cloudflare Pages builds: its setup files in place of the other hosts', and a video. */
function cloudflareFiles(git: "github" | "gitlab"): Record<string, string> {
  const all = files();
  for (const path of [
    ".github/workflows/deploy.yml",
    ".github/workflows/scheduled.yml",
    ".gitlab-ci.yml",
    "vercel.ts",
  ]) {
    delete all[path];
  }
  return {
    ...all,
    ...Object.fromEntries(cloudflareSetupFiles({ git, next: false })),
    "public/media/welcome.mp4": "video",
  };
}

async function publishAbout(page: Page) {
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" }).click();
  await editor(page).locator('input[name="text"]:visible').fill("About our parish");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
}

/** What every Cloudflare site's admin panel shows: Cloudflare's way of connecting a domain, and the note on videos. */
async function expectCloudflareScreens(page: Page, site: string) {
  await page.goto(`${site}/admin/#/settings/domain`);
  await expect(page.getByText("On Cloudflare Pages: open the site's project")).toBeVisible();
  await expect(page.getByText("On Vercel")).toHaveCount(0);

  await page.goto(`${site}/admin/#/media`);
  const note = page.getByRole("note").filter({ hasText: "published with Cloudflare Pages" });
  await expect(note).toBeVisible();
  await expect(note.getByRole("link", { name: "Cloudflare's terms" })).toHaveAttribute(
    "href",
    "https://www.cloudflare.com/service-specific-terms-application-services/",
  );
}

test("follows Cloudflare Pages' build of a site kept on GitHub, and explains its domain and videos", async ({
  page,
}) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: cloudflareFiles("github"),
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    cloudflare: { afterChecks: 1 },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${GITHUB_SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();

  await publishAbout(page);
  await expect(page.locator(".gfa-deploy")).toHaveText("Updating the live site…");
  await expect(page.locator(".gfa-deploy")).toHaveText("The live site is up to date", { timeout: 15_000 });
  await expectCloudflareScreens(page, GITHUB_SITE);
});

test("follows Cloudflare Pages' build of a site kept on GitLab, and explains its domain and videos", async ({
  page,
}) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: cloudflareFiles("gitlab"),
    tokens: { "glpat-test": { username: "maria" } },
    deployAfterChecks: 1,
    deployJob: "Cloudflare Pages",
    external: true,
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await page.goto(`${GITLAB_SITE}/admin/`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await publishAbout(page);
  await expect(page.locator(".gfa-deploy")).toHaveText("The live site is up to date", { timeout: 15_000 });
  await expectCloudflareScreens(page, GITLAB_SITE);
});
