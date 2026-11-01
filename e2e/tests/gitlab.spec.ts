import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, test } from "@playwright/test";
import { files, GITLAB_SITE, routeToFake } from "./backends.js";

test("signs in with GitLab without a token, and publishes", async ({ page }) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: files(),
    oauth: { clientId: "test-client", user: { username: "maria", name: "Maria" } },
  });
  // GitLab's sign-in page: approve at once and send the browser back with a code.
  await page.route("https://gitlab.com/oauth/authorize**", (route) =>
    route.fulfill({ status: 302, headers: { location: fake.authorize(route.request().url()) } }),
  );
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await routeToFake(page, "https://gitlab.com/oauth/token", fake.handle);

  await page.goto(`${GITLAB_SITE}/admin/#/settings/general`);
  await page.getByRole("button", { name: "Sign in with GitLab" }).click();

  // Back on the screen sign-in started from, with the code removed from the address.
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  expect(page.url()).toBe(`${GITLAB_SITE}/admin/#/settings/general`);
  await expect(page.locator(".gfa-account")).toContainText("Maria");

  await page.getByLabel("Site name").fill("St. Joseph Parish");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(JSON.parse(String(fake.repo.files().get("content/site.json") ?? "{}"))).toMatchObject({
    title: "St. Joseph Parish",
  });
});

test("offers a token instead of GitLab sign-in", async ({ page }) => {
  const fake = fakeGitLab({ project: "parish/site", files: files(), tokens: { "glpat-test": { username: "maria" } } });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await page.goto(`${GITLAB_SITE}/admin/`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
});

test("walks an owner through registering the admin panel with GitLab, then turns on Sign in with GitLab", async ({
  page,
}) => {
  const site = { ...JSON.parse(files()["content/site.json"] ?? "{}"), url: "https://parish.example" };
  const fake = fakeGitLab({
    project: "parish/site",
    files: {
      ...files(),
      "content/site.json": `${JSON.stringify(site, null, 2)}\n`,
      "goodfellow.config.tsx":
        'import { gitlab } from "@goodfellow-cms/gitlab";\nexport default defineConfig({\n  backend: gitlab({ project: "parish/site" }),\n});\n',
    },
    tokens: { "glpat-test": { username: "maria" } },
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);
  await page.goto(`${GITLAB_SITE}/admin/`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();

  await page.goto(`${GITLAB_SITE}/admin/#/settings/security`);
  await expect(page.getByRole("heading", { name: "Sign in with GitLab" })).toBeVisible();
  // Every value GitLab's form needs, with a link to the form in the project's group.
  await expect(page.locator(".gfa-copy-value").filter({ hasText: "Redirect URI" })).toContainText(
    "https://parish.example/admin/",
  );
  await expect(page.getByRole("link", { name: "in the parish group" })).toHaveAttribute(
    "href",
    "https://gitlab.com/groups/parish/-/settings/applications",
  );

  await page.getByLabel("Application ID").fill("not an id");
  await page.getByRole("button", { name: "Turn on Sign in with GitLab" }).click();
  await expect(page.getByText("doesn't look like what GitLab shows")).toBeVisible();
  await page.getByLabel("Application ID").fill("5832fc6e14300a0d962240a8144466ee");
  await page.getByRole("button", { name: "Turn on Sign in with GitLab" }).click();
  await expect
    .poll(() => fake.repo.files().get("goodfellow.config.tsx"))
    .toContain('backend: gitlab({ project: "parish/site", clientId: "5832fc6e14300a0d962240a8144466ee" }),');
  await expect(page.getByText("Editors can choose Sign in with GitLab")).toBeVisible();
});
