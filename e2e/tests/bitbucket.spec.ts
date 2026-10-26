import { readFileSync } from "node:fs";
import { fakeBitbucket } from "@goodfellow-cms/bitbucket/testing";
import { bitbucketPipelines } from "@goodfellow-cms/core";
import { expect, type Page, test } from "@playwright/test";
import { BITBUCKET_SITE, files, routeToFake } from "./backends.js";

const starter = new URL("../../templates/starter/", import.meta.url);

/** The starter's files, with the Pipelines setup `create-goodfellow` gives a site stored on Bitbucket. */
function siteFiles() {
  return {
    ...files(),
    "package.json": JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.4.3" } }),
    "vercel.ts": readFileSync(new URL("vercel.ts", starter), "utf8"),
    "bitbucket-pipelines.yml": bitbucketPipelines("goodfellow"),
  };
}

async function signInWithToken(page: Page, screen: string, token = "maria@example.org:api-token") {
  await page.goto(`${BITBUCKET_SITE}/admin/#/${screen}`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("signs in with Bitbucket without a token, and publishes in one commit", async ({ page }) => {
  const fake = fakeBitbucket({
    repo: "parish/site",
    files: siteFiles(),
    oauth: {
      clientId: "test-consumer",
      callback: `${BITBUCKET_SITE}/admin/`,
      user: { nickname: "maria", displayName: "Maria" },
    },
  });
  // Bitbucket's sign-in page: approve at once and send the browser back with a token in the address.
  await routeToFake(page, "https://bitbucket.org/site/oauth2/authorize", fake.handle);
  await routeToFake(page, "https://api.bitbucket.org", fake.handle);

  await page.goto(`${BITBUCKET_SITE}/admin/#/settings/general`);
  await page.getByRole("button", { name: "Sign in with Bitbucket" }).click();

  // Back on the screen sign-in started from, with the token taken out of the address.
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  expect(page.url()).toBe(`${BITBUCKET_SITE}/admin/#/settings/general`);
  await expect(page.locator(".gfa-account")).toContainText("Maria");

  const before = fake.repo.head();
  await page.getByLabel("Site name").fill("St. Joseph Parish");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(JSON.parse(String(fake.repo.files().get("content/site.json") ?? "{}"))).toMatchObject({
    title: "St. Joseph Parish",
  });
  expect(fake.repo.commitAt(fake.repo.head())?.parent).toBe(before);
});

test("signs in with a repository access token, and shows a page's versions", async ({ page }) => {
  const fake = fakeBitbucket({
    repo: "parish/site",
    files: siteFiles(),
    tokens: { "repo-token": { nickname: "site", access: true } },
  });
  const about = files()["content/pages/about.json"] ?? "";
  fake.repo.write(
    "content/pages/about.json",
    about.replace('"text": "About us"', '"text": "Who we are"'),
    'Update page "About"',
    "Maria <maria@example.org>",
  );
  await routeToFake(page, "https://api.bitbucket.org", fake.handle);
  await signInWithToken(page, "pages", "repo-token");
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await page.getByRole("link", { name: "Version history" }).click();
  const versions = page.locator(".gfa-version");
  await expect(versions).toHaveCount(2);
  await expect(versions.nth(0)).toContainText('Update page "About"');
  await expect(versions.nth(0)).toContainText("Maria");
});

test("an owner turns on updates, which adds the nightly schedule, and rebuilds the site", async ({ page }) => {
  const fake = fakeBitbucket({
    repo: "parish/site",
    files: siteFiles(),
    tokens: { "maria@example.org:api-token": { nickname: "maria", displayName: "Maria" } },
  });
  await routeToFake(page, "https://api.bitbucket.org", fake.handle);
  await page.route("https://registry.npmjs.org/**", (route) =>
    route.fulfill({
      json: { versions: { "0.4.1": {}, "0.4.3": {}, "0.5.0": {} } },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await signInWithToken(page, "settings/updates");

  await expect(page.getByText("This site uses Goodfellow 0.4.3.")).toBeVisible();
  await expect(page.getByText(/^Automatic updates aren't turned on yet/)).toBeVisible();
  await page.getByRole("button", { name: "Turn on automatic updates" }).click();
  await expect(page.getByText(/^Automatic updates aren't turned on yet/)).toHaveCount(0);
  expect(fake.settings.pipelines).toBe(true);
  expect(fake.schedules.map((schedule) => schedule.pattern)).toEqual(["update"]);

  await page.getByRole("button", { name: "Rebuild now" }).click();
  await expect.poll(() => fake.pipelines.at(-1)?.variables).toEqual({ GOODFELLOW_REBUILD: "true" });
});

test("an owner gives someone in the workspace permission to edit", async ({ page }) => {
  const fake = fakeBitbucket({
    repo: "parish/site",
    files: siteFiles(),
    tokens: { "maria@example.org:api-token": { nickname: "maria", displayName: "Maria" } },
    members: ["joseph"],
  });
  await routeToFake(page, "https://api.bitbucket.org", fake.handle);
  await signInWithToken(page, "settings/editors");

  const rows = page.locator(".gfa-editors tbody tr");
  await expect(rows.filter({ hasText: "Maria" })).toContainText("Owner");
  await page.getByLabel("Their Bitbucket username").fill("joseph");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(rows.filter({ hasText: "joseph" })).toContainText("Editor");
  expect(fake.permissions.get("{joseph}")?.permission).toBe("write");
});
