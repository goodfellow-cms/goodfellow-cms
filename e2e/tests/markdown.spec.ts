import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { site } from "../scripts/site.mjs";
import { canvas, expect, publishInEditor, readSiteFile, test } from "./helpers.js";

const exists = (path: string) => existsSync(join(site as string, path));

/** The visible part of the item editor's sidebar, since Puck also renders hidden copies of its fields. */
const sidebar = (page: Page) => page.locator(".gfa-editor");

async function storeNewsAsMarkdown(page: Page) {
  await page.goto("/admin#/collections/news/settings");
  await page.getByLabel("Store items as Markdown files").check();
  await expect(page.getByText("Every item will be converted when you publish.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
}

test("stores a collection's items as Markdown files, converting the ones it has", async ({ page }) => {
  await storeNewsAsMarkdown(page);
  expect(exists("content/collections/news/welcome.json")).toBe(false);
  expect(readSiteFile("content/collections/news/welcome.md")).toBe(
    [
      "---",
      "version: 1",
      "title: Welcome to our new website",
      "date: 2026-10-01",
      "summary: Our new site is easier to keep up to date, so you'll always find the latest news here.",
      "image: /media/placeholder.svg",
      "---",
      "",
      "This is a news story. Add your own on the **Collections** screen of the admin panel, and they'll appear on the news page in date order.",
      "",
    ].join("\n"),
  );
});

test("edits a Markdown item's text formatted, or as Markdown when the formatted editor can't show it", async ({
  page,
  request,
}) => {
  await storeNewsAsMarkdown(page);
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect(canvas(page).getByText("This is a news story.")).toBeVisible();

  // Formatted: typing changes the Markdown, written the usual way.
  const formatted = sidebar(page).locator(".ProseMirror").filter({ visible: true }).first();
  // As tall as the Markdown editor. Measured once it's settled, since Puck can briefly hide it while rendering.
  const editor = sidebar(page)
    .locator('.gfa-markdown-formatted [class*="_RichTextEditor--editor_"]')
    .filter({ visible: true })
    .first();
  await expect(editor).toBeVisible();
  await expect.poll(async () => (await editor.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(384);
  await formatted.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" More to come.");
  await expect(canvas(page).getByText("More to come.")).toBeVisible();
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/collections/news/welcome.md")).toContain("in date order. More to come.\n");

  // As Markdown: a table, which the formatted editor can't show, so it's offered as Markdown only.
  await sidebar(page).getByRole("tab", { name: "Markdown" }).filter({ visible: true }).first().click();
  const source = sidebar(page).locator("textarea.gfa-markdown-source").filter({ visible: true }).first();
  await source.fill("| Day | Time |\n|---|---|\n| Saturday | 10 am |");
  await expect(sidebar(page).getByRole("tab", { name: "Formatted" }).filter({ visible: true }).first()).toBeDisabled();
  await expect(canvas(page).getByRole("cell", { name: "Saturday" })).toBeVisible();
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/collections/news/welcome.md")).toContain(
    "| Day | Time |\n|---|---|\n| Saturday | 10 am |\n",
  );
  await expect.poll(async () => (await request.get("/news/welcome")).text()).toContain("<td>Saturday</td>");
});
