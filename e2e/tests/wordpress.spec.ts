import { fakeWordPress, SAMPLE_WORDPRESS_URL, sampleWordPressExport } from "@goodfellow-cms/core/testing";
import type { Page } from "@playwright/test";
import { expect, readJson, readSiteFile, test } from "./helpers.js";

/** St. Brendan's WordPress site, at its address, for the admin panel's requests. */
async function routeToWordPress(page: Page, options: Parameters<typeof fakeWordPress>[0] = {}) {
  const wordpress = fakeWordPress(options);
  await page.route(`${SAMPLE_WORDPRESS_URL}/**`, (route) => {
    const url = route.request().url();
    // Browsers don't check answers Playwright gives for other sites' rules, so files they'd refuse fail here.
    if (!options.mediaCors && url.includes("/wp-content/uploads/")) return route.abort("accessdenied");
    const answer = wordpress.handle(url);
    return route.fulfill({
      status: answer.status,
      headers: answer.headers,
      body: typeof answer.body === "string" ? answer.body : Buffer.from(answer.body),
    });
  });
}

/** Publishes the import, past the site checks' warnings about the imported pages. */
async function importAndPublish(page: Page) {
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const checks = page.getByRole("dialog", { name: "Publish anyway?" });
  const done = page.getByText(/^Imported St\. Brendan/);
  await expect(checks.or(done)).toBeVisible({ timeout: 30_000 });
  if (await checks.isVisible()) await checks.getByRole("button", { name: "Publish anyway" }).click();
  await expect(done).toBeVisible({ timeout: 30_000 });
}

test("imports a WordPress export file: its pages, posts, menus, media and old addresses", async ({ page }) => {
  await routeToWordPress(page, { mediaCors: true });
  await page.goto("/admin/#/settings/import");
  await page.getByLabel("WordPress export file").setInputFiles({
    name: "stbrendan.WordPress.2026-10-21.xml",
    mimeType: "text/xml",
    buffer: Buffer.from(sampleWordPressExport()),
  });

  await expect(page.getByRole("heading", { name: "Ready to import St. Brendan's Parish" })).toBeVisible();
  await expect(page.getByText("Pages: 4")).toBeVisible();
  // The starter has a News collection at /news/{slug}, so the posts take /posts/, listed on WordPress's posts page.
  await expect(page.getByText("Posts: 3, at /posts/{slug}, listed on /news")).toBeVisible();
  await expect(page.getByText("Media files to copy: 3")).toBeVisible();
  await expect(page.getByText("These pages will be replaced: /, /about, /news.")).toBeVisible();
  await expect(
    page.getByText("The [contact-form-7] shortcode only works in WordPress, so it was left out: About us."),
  ).toBeVisible();

  await importAndPublish(page);
  expect(readJson("content/pages/about/staff.json")).toMatchObject({
    data: { root: { props: { title: "Our staff" } } },
  });
  expect(readSiteFile("content/pages/index.json")).toContain('"src": "/media/church.jpg"');
  expect(readSiteFile("content/collections/posts/parish-picnic.md")).toContain("image: /media/picnic.jpg");
  expect(readJson("content/redirects.json")).toMatchObject({
    redirects: expect.arrayContaining([{ from: "/2026/06/parish-picnic", to: "/posts/parish-picnic" }]),
  });
  expect(readJson("content/menus.json")).toMatchObject({
    menus: { main: expect.arrayContaining([{ label: "Home", href: "/" }]) },
  });

  // The site shows them, and sends the old addresses on.
  await page.goto("/about/staff");
  await expect(page.getByRole("heading", { name: "Our staff", level: 1 })).toBeVisible();
  await page.goto("/2026/06/parish-picnic");
  await expect(page).toHaveURL(/\/posts\/parish-picnic$/);
  await expect(page.getByRole("heading", { name: "Parish picnic", level: 1 })).toBeVisible();
});

test("imports a WordPress site from its address, linking to media it can't copy", async ({ page }) => {
  await routeToWordPress(page, { mediaCors: false });
  await page.goto("/admin/#/settings/import");
  await page.getByLabel("Or the WordPress site's address").fill("stbrendan.example.org");
  await page.getByRole("button", { name: "Read the site" }).click();
  await expect(page.getByRole("heading", { name: /^Ready to import St\. Brendan/ })).toBeVisible();
  await expect(page.getByText(/^Menus can't be read from a site's address/)).toBeVisible();

  await importAndPublish(page);
  await expect(
    page.getByText(/^Media files that couldn't be copied, so pages show them from the WordPress site/),
  ).toBeVisible();
  expect(readSiteFile("content/pages/index.json")).toContain(
    `"src": "${SAMPLE_WORDPRESS_URL}/wp-content/uploads/2026/05/church-scaled.jpg"`,
  );
});

test("explains a file that isn't a WordPress export file", async ({ page }) => {
  await page.goto("/admin/#/settings/import");
  await page.getByLabel("WordPress export file").setInputFiles({
    name: "notes.xml",
    mimeType: "text/xml",
    buffer: Buffer.from("<notes><note>Hello</note></notes>"),
  });
  await expect(page.getByRole("alert")).toContainText("That file isn't a WordPress export file.");
});
