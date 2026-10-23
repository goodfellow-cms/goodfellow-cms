import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { resetContent, site } from "../scripts/site.mjs";

/**
 * Waits for a dev server to load the site's code again after it changed on disk. Until its
 * watcher has seen every change, it can mix old modules with new ones. `next dev` also
 * recompiles every page that imports the code, which can take a minute on a slow computer.
 * Leaves the page on the last of `urls`.
 */
export async function waitForCode(page: Page, urls = ["/"], timeout = 30_000): Promise<void> {
  await page.waitForTimeout(1_000);
  for (const url of urls) {
    await expect(async () => {
      // In the browser, since `next dev` compiles a page's scripts when they're first loaded.
      expect((await page.goto(url, { timeout }))?.status()).toBe(200);
      // The watcher reports changes in bursts, each reloading open pages, which would cut off
      // the test's next navigation. Done once a page stays loaded for a while.
      await page.evaluate(() => Object.assign(window, { codeSettled: true }));
      await page.waitForTimeout(2_000);
      expect(await page.evaluate(() => "codeSettled" in window).catch(() => false)).toBe(true);
    }).toPass({ timeout });
  }
}

/** Every test starts from the starter template's content, including tests that only send requests. */
export const test = base.extend({
  page: async ({ page }, use) => {
    if (resetContent()) await waitForCode(page);
    await use(page);
  },
  request: async ({ request }, use) => {
    resetContent();
    await use(request);
  },
});

export { expect };

export function readSiteFile(path: string): string {
  return readFileSync(join(site as string, path), "utf8");
}

export function writeSiteFile(path: string, content: string): void {
  writeFileSync(join(site as string, path), content);
}

export function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readSiteFile(path));
}

/** The editor: Puck, the site's config and its blocks, in the frame sandboxed away from the admin panel's page. */
export function editor(page: Page) {
  return page.frameLocator("iframe.gfa-editor-frame");
}

/** The editor's canvas: the page being edited, which Puck draws in the editor's frame. */
export function canvas(page: Page) {
  return editor(page).locator(".gf-canvas").first();
}

/** Opens the editor for a page and waits for its canvas to show it. */
export async function openPageEditor(page: Page, path: string, heading: string) {
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent(path)}`);
  await expect(canvas(page).getByRole("heading", { name: heading })).toBeVisible();
}

/** A field in Puck's right-hand panel. Puck renders hidden copies of fields, so only visible ones count. */
export function field(page: Page, name: string) {
  return editor(page).locator(`input[name="${name}"]:visible, textarea[name="${name}"]:visible`).first();
}

export async function publishInEditor(page: Page) {
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
}
