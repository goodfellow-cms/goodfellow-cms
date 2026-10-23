import { readFileSync } from "node:fs";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";
import { editor, expect, publishInEditor, readJson, test, writeSiteFile } from "./helpers.js";

/** A JSON file in a fake's repository. */
const json = (fake: { repo: { files(): ReadonlyMap<string, unknown> } }, path: string) =>
  JSON.parse(String(fake.repo.files().get(path) ?? "{}"));

const starter = (file: string) => readFileSync(new URL(`../../templates/starter/${file}`, import.meta.url), "utf8");

// Times are the computer's until the site has a time zone of its own.
test.use({ timezoneId: "America/New_York" });

test("schedules a page on GitLab, which rebuilds the site at that time", async ({ page }) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: { ...files(), ".gitlab-ci.yml": starter(".gitlab-ci.yml") },
    tokens: { "glpat-test": { username: "maria" } },
    visibility: "public",
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await page.goto(`${GITLAB_SITE}/admin/#/pages`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await page
    .getByRole("row", { name: /About us/ })
    .getByRole("button", { name: "Schedule" })
    .click();
  const dialog = page.getByRole("dialog", { name: "When “About us” is on the site" });
  await dialog.getByLabel("Show from").fill("2099-11-29T09:00");
  await expect(dialog).toContainText(
    "Times are in your computer's time zone, America/New York, which becomes the site's time zone.",
  );
  await expect(dialog).toContainText("The site is rebuilt at each of these times");
  // The project is public, so what's scheduled can be read before it's shown.
  await expect(dialog.getByRole("note")).toContainText("Anyone can read what's scheduled before it's shown");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole("row", { name: /About us/ });
  await expect(row).toContainText("Shown from Nov 29, 2099, 9:00 AM");
  const comingUp = page.getByRole("region", { name: "Coming up" });
  await expect(comingUp.getByRole("listitem")).toHaveText(/Nov 29, 2099, 9:00 AM\s*Shown\s*About us/);

  const about = json(fake, "content/pages/about.json");
  expect(about.showFrom).toBe("2099-11-29T09:00");
  expect(json(fake, "content/site.json").timeZone).toBe("America/New_York");
  // A pipeline schedule at that time, in UTC, which only builds the site.
  await expect
    .poll(() => fake.updateSettings.schedules)
    .toEqual([
      expect.objectContaining({
        ref: "main",
        cron: "0 14 29 11 *",
        cronTimezone: "UTC",
        variables: { GOODFELLOW_SCHEDULED_CHANGE: "2099-11-29T14:00Z" },
      }),
    ]);

  // Taking the schedule away removes the pipeline schedule too.
  await row.getByRole("button", { name: "Schedule" }).click();
  await dialog.getByLabel("Show from").fill("");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(comingUp).toHaveCount(0);
  await expect.poll(() => fake.updateSettings.schedules).toEqual([]);
});

test("hides an item on GitHub after a time, within the hour of the site's hourly check", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      ...files(),
      ".github/workflows/deploy.yml": starter(".github/workflows/deploy.yml"),
      ".github/workflows/scheduled.yml": starter(".github/workflows/scheduled.yml"),
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${GITHUB_SITE}/admin/#/collections/news/edit?slug=open-house`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();

  const fields = editor(page);
  await fields.getByLabel("Hide after").filter({ visible: true }).fill("2099-01-01T00:00");
  await expect(fields.getByText("so changes go live within an hour of their time").first()).toBeVisible();
  await expect(fields.getByRole("note").first()).toContainText("since the site's files on GitHub are public");
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const item = json(fake, "content/collections/news/open-house.json");
  expect(item).toMatchObject({ hideAfter: "2099-01-01T00:00", fields: { title: "Open house this Saturday" } });

  await page.goto(`${GITHUB_SITE}/admin/#/pages`);
  await expect(page.getByRole("region", { name: "Coming up" })).toContainText("HiddenOpen house this Saturday");
  await page.goto(`${GITHUB_SITE}/admin/#/collections/news`);
  await expect(page.getByRole("row", { name: /Open house/ })).toContainText("Hidden after Jan 1, 2099, 12:00 AM");
});

test("leaves pages out of the site until they're shown, and their links out of menus", async ({ page }) => {
  const about = readJson("content/pages/about.json");
  const menu = async () =>
    /<nav aria-label="main"[\s\S]*?<\/nav>/.exec(await (await page.request.get("/")).text())?.[0];
  writeSiteFile("content/pages/about.json", `${JSON.stringify({ ...about, showFrom: "2099-11-29T09:00" }, null, 2)}\n`);
  expect((await page.request.get("/about")).status()).toBe(404);
  expect(await menu()).not.toContain('href="/about"');

  writeSiteFile("content/pages/about.json", `${JSON.stringify({ ...about, showFrom: "2000-01-01T00:00" }, null, 2)}\n`);
  expect((await page.request.get("/about")).status()).toBe(200);
  expect(await menu()).toContain('href="/about"');
});
