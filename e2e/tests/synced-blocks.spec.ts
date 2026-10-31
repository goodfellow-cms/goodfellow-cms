import {
  canvas,
  editor,
  expect,
  field,
  openPageEditor,
  publishInEditor,
  readJson,
  readSiteFile,
  test,
} from "./helpers.js";

test("saves a block as a synced block, changes it once for every page, then detaches it", async ({ page }) => {
  await openPageEditor(page, "/", "Welcome to my site");
  // Its corner, outside the blocks inside it.
  await canvas(page)
    .locator('[data-puck-component="Section-hero"]')
    .click({ position: { x: 4, y: 4 } });
  await page.getByRole("button", { name: "Save as synced block" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Welcome band");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The synced block is published at once; the page places it once the page is published.
  // Published first, with the site checks, then put in the block's place.
  await expect(canvas(page).getByText("Synced block: Welcome band")).toBeVisible({ timeout: 20_000 });
  expect(readJson("content/synced-blocks/welcome-band.json").title).toBe("Welcome band");
  await expect(canvas(page).getByRole("heading", { name: "Welcome to my site" })).toBeVisible();
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/pages/index.json")).toContain('"block": "welcome-band"');

  // The site shows its blocks in its place.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to my site" })).toBeVisible();

  // It can't be deleted while a page shows it.
  await page.goto("/admin#/synced-blocks");
  const row = page.getByRole("row", { name: /Welcome band/ });
  await expect(row).toContainText("Welcome");
  await row.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("It's still shown on these.");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  // Changed in its own editor, every page that shows it changes.
  await row.getByRole("link", { name: "Welcome band" }).click();
  await expect(canvas(page).getByRole("heading", { name: "Welcome to my site" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Changes show on Welcome when you publish.")).toBeVisible();
  await canvas(page).locator('[data-puck-component="Heading-hero"]').click();
  await field(page, "text").fill("Welcome, everyone");
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/synced-blocks/welcome-band.json")).toContain("Welcome, everyone");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome, everyone" })).toBeVisible();

  // Detached, its blocks are the page's own, and the synced block can go.
  await openPageEditor(page, "/", "Welcome, everyone");
  await canvas(page).locator('[data-puck-component="Section-hero"]').click();
  await page.getByRole("button", { name: "Detach" }).click();
  await expect(canvas(page).getByText("Synced block: Welcome band")).toBeHidden();
  await expect(canvas(page).getByRole("heading", { name: "Welcome, everyone" })).toBeVisible();
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const home = readSiteFile("content/pages/index.json");
  expect(home).not.toContain("SyncedBlock");
  expect(home).toContain("Welcome, everyone");

  await page.goto("/admin#/synced-blocks");
  await page
    .getByRole("row", { name: /Welcome band/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("There are no synced blocks yet.")).toBeVisible();
});

test("makes a synced block on its own screen, and offers it in the Synced block block's settings", async ({ page }) => {
  await page.goto("/admin#/synced-blocks");
  await page.getByRole("button", { name: "New synced block" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Mass times");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/#\/synced-blocks\/edit\?name=mass-times/);
  await expect(page.getByText("Nothing shows this synced block yet.")).toBeVisible();
  // A synced block can't place another, so the block isn't offered here.
  await expect(editor(page).locator(".gf-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(editor(page).getByText("Synced block", { exact: true })).toBeHidden();
  expect(readJson("content/synced-blocks/mass-times.json")).toMatchObject({
    title: "Mass times",
    data: { content: [] },
  });
});
