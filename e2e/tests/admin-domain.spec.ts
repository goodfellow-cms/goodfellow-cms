import { expect, type Page, test } from "@playwright/test";
import { ADMIN_ADDRESSES } from "../scripts/site.mjs";

// A production build of the starter whose admin panel has an address of its own (`builtSites.admin`). Its test
// pages, from e2e/fixtures/admin-domain, try every way a script could run before the guard each page starts with.
// This runs in Chromium, Firefox and WebKit (playwright.config.ts), since each loads pages its own way.
const { admin, site } = ADMIN_ADDRESSES;

/** The marks the test pages' scripts left in this page's address's storage. */
function marksHere(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("ran-"))
      .sort(),
  );
}

/** The marks left at an address, read from a file there that isn't a page. */
async function marksAt(page: Page, origin: string): Promise<string[]> {
  await page.goto(`${origin}/attack/async.js`);
  return marksHere(page);
}

const PAGES = [
  // Scripts in the head and body, async, deferred and module scripts, event handlers, frames and an SVG object.
  { path: "/attack/scripts.html", ran: ["ran-inline", "ran-body-inline", "ran-framed", "ran-srcdoc"] },
  { path: "/attack/picture.svg", ran: ["ran-svg"] },
  // Browsers show XML with no stylesheet as it is; whether its script runs at the Site address doesn't matter.
  { path: "/attack/feed.xml", ran: [] },
];

for (const { path, ran } of PAGES) {
  test(`${path} runs nothing at the admin address`, async ({ page }) => {
    await page.goto(`${admin}${path}`);
    await expect(page).toHaveURL(`${site}${path}`);
    // At the Site address the page's scripts run, which comes after anything they'd have run at the admin address.
    await expect.poll(() => marksHere(page)).toEqual(expect.arrayContaining(ran));
    expect(await marksAt(page, admin)).toEqual([]);
  });
}

test("the admin panel starts only at its own address", async ({ page }) => {
  await page.goto(`${site}/admin/`);
  await expect(page).toHaveURL(`${admin}/admin/`);
  await expect(page.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();
});

test("the admin panel refuses to be shown in a frame", async ({ page }) => {
  await page.goto(`${site}/attack/framed.html`);
  await page.evaluate((src) => {
    const frame = document.createElement("iframe");
    frame.src = src;
    frame.title = "Admin panel";
    document.body.append(frame);
  }, `${admin}/admin/`);
  // The guard writes <plaintext>, after which the parser reads the rest of the page as text. Pages it stops
  // never finish loading in WebKit, so this waits for that rather than for the page to load.
  await expect
    .poll(async () => {
      const frame = page.frames().find((candidate) => candidate.url().startsWith(`${admin}/admin/`));
      return frame?.evaluate(() => document.querySelector("plaintext") !== null).catch(() => false);
    })
    .toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().startsWith(`${admin}/admin/`));
  // Only the guard was read as HTML: the rest of the page is hidden text, and nothing of the admin panel ran.
  expect(await frame?.evaluate(() => document.scripts.length)).toBe(1);
  expect(await frame?.evaluate(() => document.querySelector("script[data-goodfellow-guard]") !== null)).toBe(true);
  expect(await frame?.evaluate(() => document.body.innerText.trim())).toBe("");
});

test("the editor's frames run only in the admin panel's frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // It stops loading, so the page never finishes.
  await page.goto(`${admin}/admin/editor/`, { waitUntil: "commit" });
  await expect.poll(() => errors).toContainEqual(expect.stringContaining("only in the admin panel's frames"));
  await expect(page.locator(".gf-canvas")).toHaveCount(0);
});
