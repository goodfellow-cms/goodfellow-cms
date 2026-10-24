import { readFileSync } from "node:fs";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";

const starter = new URL("../../templates/starter/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, starter), "utf8");

/** The starter's files, with its setup for a host, as a site made from published packages has them. */
function siteFiles(setup: ".github/workflows/deploy.yml" | ".gitlab-ci.yml") {
  return {
    ...files(),
    "package.json": JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.4.1" } }),
    [setup]: read(setup),
  };
}

/** npm's registry, with fixes for 0.4 and a newer release. */
async function fakeNpm(page: Page) {
  await page.route("https://registry.npmjs.org/**", (route) =>
    route.fulfill({
      json: { versions: { "0.4.1": {}, "0.4.3": {}, "0.5.0": {} } },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
}

test("an owner installs fixes on a GitHub site with an owner token", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: siteFiles(".github/workflows/deploy.yml"),
    tokens: {
      "test-token": { login: "maria", admin: true },
      "owner-token": { login: "maria", admin: true, administration: true },
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await fakeNpm(page);

  await page.goto(`${GITHUB_SITE}/admin/#/settings/updates`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("This site uses Goodfellow 0.4.1.")).toBeVisible();
  await expect(page.getByText("Fixes up to Goodfellow 0.4.3 are ready.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Goodfellow 0.5.0 is out" })).toBeVisible();
  await expect(page.getByText("No update has run yet.")).toBeVisible();

  // Running the site's workflow needs the owner token.
  await page.getByRole("button", { name: "Install fixes now" }).click();
  await page.getByLabel("Owner token").fill("owner-token");
  await page.getByRole("button", { name: "Use this token" }).click();
  await page.getByRole("button", { name: "Install fixes now" }).click();
  await expect(page.getByText("An update is running now.", { exact: false })).toBeVisible();
  expect(fake.runs.at(-1)).toMatchObject({ event: "workflow_dispatch", inputs: { update: "fixes" } });
});

test("an owner chooses when a GitHub site rebuilds overnight, and rebuilds it now", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: siteFiles(".github/workflows/deploy.yml"),
    tokens: {
      "test-token": { login: "maria", admin: true },
      "owner-token": { login: "maria", admin: true, administration: true },
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await fakeNpm(page);

  await page.goto(`${GITHUB_SITE}/admin/#/settings/updates`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Rebuilding overnight" })).toBeVisible();
  // Signing in can't read the setting, which lives in a repository variable.
  await expect(page.getByText("Sign in as an owner to see or change this.")).toBeVisible();

  // Without it, changing the setting asks for the owner token.
  await page.getByLabel("Never").click();
  await page.getByLabel("Owner token").fill("owner-token");
  await page.getByRole("button", { name: "Use this token" }).click();
  await expect(page.getByLabel("Only when something changed (recommended)")).toBeChecked();
  await page.getByLabel("Never").check();
  await expect(page.getByText("Without rebuilding overnight", { exact: false })).toBeVisible();
  // The screen shows the choice at once, before GitHub has it.
  await expect.poll(() => fake.variables.get("GOODFELLOW_NIGHTLY")).toBe("off");
  await page.getByLabel("Every night").check();
  await expect(page.getByLabel("Every night")).toBeChecked();
  await expect.poll(() => fake.variables.get("GOODFELLOW_NIGHTLY")).toBe("always");

  // Rebuilding runs the workflow without an update.
  await page.getByRole("button", { name: "Rebuild now" }).click();
  await expect(page.getByText("The site is rebuilding.", { exact: false })).toBeVisible();
  expect(fake.runs.at(-1)).toMatchObject({ event: "workflow_dispatch", inputs: {} });
});

test("a GitLab site turns on automatic updates, and shows why the last one wasn't installed", async ({ page }) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: siteFiles(".gitlab-ci.yml"),
    tokens: { "glpat-test": { username: "maria", accessLevel: 40 } },
  });
  fake.addUpdateRun({
    trace: [
      "$ npx goodfellow update --publish --to fixes",
      'goodfellow-update {"state":"failed","from":"0.4.1","to":"0.4.3","step":"build","cause":{"kind":"code","file":"blocks/installed/shadcn-faq/block.tsx","message":"Unexpected token"}}',
      "$ npx goodfellow build",
    ].join("\n"),
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await fakeNpm(page);

  await page.goto(`${GITLAB_SITE}/admin/#/settings/updates`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByText(/^Automatic updates aren't turned on yet/)).toBeVisible();
  await page.getByRole("button", { name: "Turn on automatic updates" }).click();
  await expect(page.getByText(/^Automatic updates aren't turned on yet/)).toHaveCount(0);
  expect(fake.updateSettings).toMatchObject({ jobTokenPush: true, schedules: [{ cron: "17 4 * * *" }] });

  await expect(page.getByText(/the update didn't work, so nothing changed/)).toBeVisible();
  await expect(page.getByText("The site didn't build with Goodfellow 0.4.3", { exact: false })).toBeVisible();
  await page.getByText("Details", { exact: true }).click();
  await expect(page.getByText("blocks/installed/shadcn-faq/block.tsx")).toBeVisible();
});

test("an owner turns automatic fixes off, goes back to the previous release, and allows a skipped one again", async ({
  page,
}) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: siteFiles(".gitlab-ci.yml"),
    tokens: { "glpat-test": { username: "maria", accessLevel: 40 } },
  });
  fake.repo.write("package.json", JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.4.3" } }));
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await fakeNpm(page);

  await page.goto(`${GITLAB_SITE}/admin/#/settings/updates`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("This site uses Goodfellow 0.4.3.")).toBeVisible();

  // Turning automatic fixes off publishes the site's update settings.
  const automatic = page.getByLabel("Install fixes automatically each night");
  await expect(automatic).toBeChecked();
  await automatic.click();
  await expect(automatic).not.toBeChecked();
  await expect
    .poll(() => fake.repo.files().get("content/updates.json"))
    .toBe('{\n  "version": 1,\n  "automatic": false,\n  "skip": []\n}\n');

  // Going back runs the update job with the release before this one.
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Go back to 0.4.1" }).click();
  await expect(page.getByText("An update is running now.", { exact: false })).toBeVisible();
  expect(fake.updateRuns.at(-1)?.variables).toEqual([
    { key: "GOODFELLOW_UPDATE", variable_type: "env_var", value: "0.4.1" },
  ]);

  // Once it's done, the release it went back from isn't offered again until an owner allows it.
  const run = fake.updateRuns.at(-1);
  if (run) {
    run.status = "success";
    run.trace = 'goodfellow-update {"state":"updated","from":"0.4.3","to":"0.4.1","kept":[],"rollback":true}';
  }
  fake.repo.write("package.json", JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.4.1" } }));
  fake.repo.write("content/updates.json", '{\n  "version": 1,\n  "automatic": true,\n  "skip": ["0.4.3"]\n}\n');
  await page.reload();
  await expect(page.getByText("the site went back to Goodfellow 0.4.1.", { exact: false })).toBeVisible();
  await expect(page.getByText("The site has every fix for its release.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Releases that won't be installed" })).toBeVisible();
  await page.getByRole("button", { name: "Allow 0.4.3 again" }).click();
  await expect(page.getByText("Fixes up to Goodfellow 0.4.3 are ready.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Releases that won't be installed" })).toHaveCount(0);
});
