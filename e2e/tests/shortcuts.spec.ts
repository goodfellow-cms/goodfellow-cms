import { canvas, editor, expect, readSiteFile, test } from "./helpers.js";

test("? lists the shortcuts, and Ctrl+K goes to a page by its name", async ({ page }) => {
  await page.goto("/admin#/pages");
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await page.keyboard.press("Shift+?");
  const list = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(list).toContainText("Add your changes to a draft, in an editor");
  await expect(list).toContainText("Go to a page, item or screen");
  await list.getByRole("button", { name: "Close" }).click();
  await expect(list).toBeHidden();

  await page.keyboard.press("Control+k");
  const box = page.getByRole("dialog", { name: "Go to…" });
  const search = box.getByRole("combobox", { name: "Page, item or screen" });
  await expect(search).toBeFocused();
  // Typing ? in the box is a letter, not the list of shortcuts.
  await search.fill("?");
  await expect(box).toContainText("Nothing matches.");
  await search.fill("colors");
  await expect(box.getByRole("option").first()).toContainText("Colors & fonts");
  await search.fill("about");
  await expect(box.getByRole("option").first()).toContainText("About us");
  await search.press("Enter");
  await expect(page).toHaveURL(/#\/pages\/edit\?path=%2Fabout$/);
});

test("Ctrl+S in the editor adds the change to a draft, never publishing it, and Ctrl+K works there too", async ({
  page,
}) => {
  const before = readSiteFile("content/pages/about.json");
  await page.goto("/admin#/pages/edit?path=%2Fabout");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await editor(page).locator('input[name="text"]:visible').fill("About our parish");
  await expect(canvas(page).getByRole("heading", { name: "About our parish" })).toBeVisible();

  // Pressed in the editor's frame, while typing in its field.
  await page.keyboard.press("Control+s");
  await expect(page.locator(".gfa-draft-banner")).toContainText("You're working in a draft");
  expect(readSiteFile("content/pages/about.json")).toBe(before);

  // Undo and Redo work from the admin panel's own header too.
  await page.locator(".gfa-editor-header").getByRole("button", { name: "Undo" }).focus();
  await page.keyboard.press("Control+z");
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  await page.keyboard.press("Control+Shift+z");
  await expect(canvas(page).getByRole("heading", { name: "About our parish" })).toBeVisible();

  await canvas(page).getByRole("heading", { name: "About our parish" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Go to…" })).toBeVisible();
});
