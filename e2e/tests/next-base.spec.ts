import { expect as baseExpect, test } from "@playwright/test";

// A production build of the Next.js template served from /site/: see playwright.config.ts.
const SITE = "http://localhost:4404/site";
const expect = baseExpect.configure({ timeout: 15_000 });

test("serves every page, style and image from the base path", async ({ page }) => {
  await page.goto(`${SITE}/about/`);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  await expect(page).toHaveTitle("About us | My site");

  const background = await page
    .locator("footer section")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");
  for (const image of await page.locator("main img, header img").all()) {
    await expect(image).toHaveAttribute("src", /^\/site\/media\//);
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
  // Links in rich text, as well as in blocks.
  for (const link of await page.locator("main .gf-prose a[href^='/']").all()) {
    await expect(link).toHaveAttribute("href", /^\/site\//);
  }
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/site/media/favicon.svg");
});

test("moves between pages with next/link, keeping the header and marking the current page in its menu", async ({
  page,
}) => {
  await page.goto(`${SITE}/`);
  const menu = page.locator("header nav");
  await expect(menu.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await page.evaluate(() => {
    (window as { notReloaded?: boolean }).notReloaded = true;
    // The header is shown by the layout, so moving to another page keeps the same element.
    Object.assign(document.querySelector("header.gf-header") as object, { kept: true });
  });
  await menu.getByRole("link", { name: "News" }).click();
  await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/site/news/");
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
  expect(await page.evaluate(() => "kept" in (document.querySelector("header.gf-header") as object))).toBe(true);
  await expect(menu.getByRole("link", { name: "News" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "News" })).toHaveAttribute("data-current", "");
  await expect(menu.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");

  // An item's page is in its section: News stays marked, though not as the current page.
  await page.goto(`${SITE}/news/welcome/`);
  await expect(menu.getByRole("link", { name: "News" })).toHaveAttribute("data-current", "");
  await expect(menu.getByRole("link", { name: "News" })).not.toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Home" })).not.toHaveAttribute("data-current", "");
});

test("puts the header's menu under a button on phones, closed again after moving to another page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${SITE}/`);
  const button = page.locator("header summary.gf-menu-button");
  const news = page.locator("header .gf-menu-panel").getByRole("link", { name: "News" });
  // The links across the header give way to the button.
  await expect(page.locator("header ul.gf-menu-list").last()).toBeHidden();
  await expect(news).toBeHidden();
  await button.click();
  await news.click();
  await expect(page.getByRole("heading", { name: "News", level: 1 })).toBeVisible();
  // The layout keeps the header, so the panel would stay open without CurrentMenuLinks.
  await expect(news).toBeHidden();
  await expect(page.locator("header details.gf-menu-toggle")).not.toHaveAttribute("open", "");
});

test("shows the site's own page for addresses that don't exist", async ({ page }) => {
  const response = await page.goto(`${SITE}/no-such-page/`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("includes the admin panel, which explains that it isn't set up yet", async ({ page }) => {
  await page.goto(`${SITE}/admin/`);
  await expect(page.getByText("don't say where the site is stored", { exact: false })).toBeVisible();
});
