import type { Page } from "@playwright/test";
import { canvas, editor, expect, openPageEditor, publishInEditor, readJson, test } from "./helpers.js";

/** A group's title in Puck's block list, by the group's key in the config's `categories`. */
function group(page: Page, key: string) {
  return editor(page).locator(`button[aria-controls="puck-drawer-category-${key}"]`);
}

const search = (page: Page) => editor(page).getByRole("searchbox", { name: "Search blocks" });

test("opens the groups that fit what's edited", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await expect(group(page, "content")).toHaveText("Text");
  await expect(group(page, "layout")).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, "content")).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, "forms")).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, "navigation")).toHaveAttribute("aria-expanded", "false");
  await expect(group(page, "collections")).toHaveAttribute("aria-expanded", "false");

  await page.goto("/admin#/layout/header");
  await expect(group(page, "navigation")).toHaveAttribute("aria-expanded", "true");
  await expect(group(page, "content")).toHaveAttribute("aria-expanded", "false");
});

test("finds blocks by other words for them, and adds one found from the search", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await search(page).fill("divider");
  const found = editor(page).getByLabel("Blocks found");
  await expect(found.getByTestId("drawer-item:Separator")).toBeVisible();
  await expect(found.getByTestId("drawer-item:Heading")).toHaveCount(0);

  await search(page).fill("nothing like this");
  await expect(editor(page).getByText("No blocks match.", { exact: false })).toBeVisible();
  await search(page).press("Escape");
  await expect(group(page, "layout")).toBeVisible();

  // Dragged from what the search found, onto the page, as from Puck's own list.
  const blocksBefore = await canvas(page).locator("[data-puck-component]").count();
  await search(page).fill("cover");
  const item = editor(page).getByLabel("Blocks found").getByTestId("drawer-item:Section");
  const target = canvas(page).getByRole("heading", { name: "About us" });
  const from = await item.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("Nothing to drag");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 20 });
  await page.mouse.up();
  await expect(canvas(page).locator("[data-puck-component]")).toHaveCount(blocksBefore + 1, { timeout: 10_000 });

  await publishInEditor(page);
  await expect(page.getByText("Published.")).toBeVisible();
  const saved = readJson("content/pages/about.json") as { data: { content: { type: string }[] } };
  expect(JSON.stringify(saved.data.content).match(/"type":"Section"/g)?.length).toBe(2);
});
