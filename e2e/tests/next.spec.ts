import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect as baseExpect } from "@playwright/test";
import { nextSite, resetNextContent } from "../scripts/site.mjs";

// The Next.js template under `next dev`: see playwright.config.ts.
const BASE = "http://localhost:4403";

// `next dev` compiles each page the first time it's opened, which can take most of a minute on CI.
const expect = baseExpect.configure({ timeout: 60_000 });

base.describe.configure({ timeout: 150_000 });

const test = base.extend({
  page: async ({ page }, use) => {
    resetNextContent();
    await use(page);
  },
});

test("serves the site's pages, header and footer with Next.js", async ({ page }) => {
  await page.goto(`${BASE}/about/`);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  await expect(page.locator("header nav").getByRole("link", { name: "News" })).toBeVisible();
  await expect(page).toHaveTitle("About us | My site");
  // Styled by the site's Tailwind build and theme.
  const background = await page
    .locator("footer section")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");

  await page.goto(`${BASE}/news/welcome/`);
  await expect(page).toHaveTitle("Welcome to our new website | My site");
});

test("shows the site's own page for addresses that don't exist", async ({ page }) => {
  const response = await page.goto(`${BASE}/no-such-page/`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("sends visitors on from a redirect's old address", async ({ page }) => {
  writeFileSync(
    join(nextSite, "content/redirects.json"),
    `${JSON.stringify({ version: 1, redirects: [{ from: "/who-we-are", to: "/about" }] }, null, 2)}\n`,
  );
  await page.goto(`${BASE}/who-we-are`);
  await expect(page).toHaveURL(/\/about\/?$/);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
});

test("publishes from the admin panel to the files on disk", async ({ page }) => {
  await page.goto(`${BASE}/admin/#/settings/general`);
  await expect(page.locator('head link[rel~="icon"]').first()).toHaveAttribute("href", /\/media\/favicon\.svg/);
  await page.getByLabel("Site name").fill("Next site");
  await expect(page.frameLocator(".gfa-preview iframe").getByText("Next site").first()).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const settings = JSON.parse(readFileSync(join(nextSite, "content/site.json"), "utf8")) as { title: string };
  expect(settings.title).toBe("Next site");
  await page.goto(`${BASE}/about/`);
  await expect(page.locator("header").getByText("Next site")).toBeVisible();
});

test("edits a page in Puck with the site's styles", async ({ page }) => {
  await page.goto(`${BASE}/admin/#/pages/edit?path=${encodeURIComponent("/about")}`);
  const canvas = page.frameLocator("iframe#preview-frame");
  await expect(canvas.getByRole("heading", { name: "About us" })).toBeVisible();
  const heading = canvas.getByRole("heading", { name: "About us" });
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");
});

test("runs a block's Client Component in the browser, with the site's data and next/link", async ({ page }) => {
  const counterPage = {
    version: 1,
    data: {
      content: [{ type: "Counter", props: { id: "Counter-1", className: "", label: "Clicked" } }],
      root: { props: { className: "", description: "", image: "", title: "Counter" } },
    },
  };
  writeFileSync(join(nextSite, "content/pages/counter.json"), `${JSON.stringify(counterPage, null, 2)}\n`);

  await page.goto(`${BASE}/counter/`);
  await expect(page.getByText("My site at /counter")).toBeVisible();
  await page.getByRole("button", { name: "Clicked 0 times" }).click();
  await expect(page.getByRole("button", { name: "Clicked 1 times" })).toBeVisible();

  // next/link moves to the page without reloading the browser's page.
  await page.evaluate(() => {
    (window as { notReloaded?: boolean }).notReloaded = true;
  });
  await page.getByRole("link", { name: "About this site" }).click();
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/about/");
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
});

test("adds the site's own code to every page once, kept when moving between pages", async ({ page }) => {
  mkdirSync(join(nextSite, "content/code"), { recursive: true });
  writeFileSync(
    join(nextSite, "content/code/head.html"),
    '<meta name="gf-test" content="yes">\n<script>window.headRan = (window.headRan || 0) + 1;</script>\n',
  );
  writeFileSync(
    join(nextSite, "content/code/body.html"),
    "<script>window.bodyRan = (window.bodyRan || 0) + 1;</script>\n",
  );

  await page.goto(`${BASE}/`);
  await expect(page.locator('head meta[name="gf-test"]')).toHaveAttribute("content", "yes");
  await expect.poll(() => page.evaluate(() => (window as { headRan?: number }).headRan)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);

  await page.locator("header nav").getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as { headRan?: number }).headRan)).toBe(1);
  expect(await page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);
});
