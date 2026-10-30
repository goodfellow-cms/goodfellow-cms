import type { Page } from "@playwright/test";
import {
  canvas,
  expect,
  field,
  openPageEditor,
  publishInEditor,
  readSiteFile,
  test,
  writeSiteFile,
} from "./helpers.js";

/** How many changes the admin panel has kept in this browser. */
function keptCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const opening = indexedDB.open("goodfellow-edits", 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore("edits");
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const counting = opening.result.transaction("edits").objectStore("edits").count();
          counting.onsuccess = () => {
            opening.result.close();
            resolve(counting.result);
          };
          counting.onerror = () => reject(counting.error);
        };
      }),
  );
}

/** Changes the About page's heading, waits until the browser has kept it, and closes the tab without publishing. */
async function changeAndClose(page: Page): Promise<Page> {
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("My heading");
  await expect.poll(() => keptCount(page)).toBe(1);
  const next = await page.context().newPage();
  await page.close();
  return next;
}

test("puts back changes that weren't published after the tab closed, and forgets them once published", async ({
  page,
}) => {
  const next = await changeAndClose(page);
  await openPageEditor(next, "/about", "About us");
  const offer = next.getByRole("status").filter({ hasText: "that weren't published" });
  await expect(offer).toBeVisible();
  await expect(offer).not.toContainText("Someone has published");

  await offer.getByRole("button", { name: "Put them back" }).click();
  await expect(canvas(next).getByRole("heading", { name: "My heading" })).toBeVisible();
  await publishInEditor(next);
  await expect(next.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/pages/about.json")).toContain('"text": "My heading"');
  await expect.poll(() => keptCount(next)).toBe(0);
});

test("throws kept changes away when asked", async ({ page }) => {
  const next = await changeAndClose(page);
  await openPageEditor(next, "/about", "About us");
  await next.getByRole("button", { name: "Throw them away" }).click();
  await expect(next.getByText("that weren't published")).toHaveCount(0);
  await expect.poll(() => keptCount(next)).toBe(0);

  await next.reload();
  await expect(canvas(next).getByRole("heading", { name: "About us" })).toBeVisible({ timeout: 20_000 });
  await expect(next.getByText("that weren't published")).toHaveCount(0);
});

test("says when someone else has published since the changes were kept", async ({ page }) => {
  const next = await changeAndClose(page);
  const original = readSiteFile("content/pages/about.json");
  writeSiteFile("content/pages/about.json", original.replace('"text": "About us"', '"text": "Their heading"'));

  await openPageEditor(next, "/about", "Their heading");
  const offer = next.getByRole("status").filter({ hasText: "that weren't published" });
  await expect(offer).toContainText("Someone has published changes here since then");
  await offer.getByRole("button", { name: "Put them back" }).click();
  await expect(canvas(next).getByRole("heading", { name: "My heading" })).toBeVisible();
  await publishInEditor(next);
  await expect(next.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/pages/about.json")).toContain('"text": "My heading"');
});

test("forgets kept changes when they're undone", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("My heading");
  await expect.poll(() => keptCount(page)).toBe(1);
  await field(page, "text").fill("About us");
  await expect.poll(() => keptCount(page)).toBe(0);
});
