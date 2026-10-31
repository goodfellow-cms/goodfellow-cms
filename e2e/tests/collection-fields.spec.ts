import type { Page } from "@playwright/test";
import { canvas, editor, expect, publishInEditor, readJson, test, writeSiteFile } from "./helpers.js";

const SETTINGS = "content/collections/news/_collection.json";

/** The news collection with yes or no, links to other stories and a schedule, shown on each story's page. */
function addFields() {
  const settings = readJson(SETTINGS) as {
    fields: unknown[];
    template: { content: unknown[] };
  };
  settings.fields.push(
    { name: "featured", label: "Featured", type: "yesno" },
    { name: "related", label: "Related stories", type: "item", collection: "news", multiple: true },
    {
      name: "schedule",
      label: "Schedule",
      type: "group",
      fields: [
        { name: "time", label: "Time", type: "text" },
        { name: "place", label: "Place", type: "text" },
      ],
    },
  );
  settings.template.content.push(
    { type: "EntryField", props: { id: "related", field: "related", style: "text", copyLabel: "", className: "" } },
    { type: "EntryField", props: { id: "schedule", field: "schedule", style: "text", copyLabel: "", className: "" } },
  );
  writeSiteFile(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
}

function setFields(slug: string, fields: Record<string, unknown>) {
  const file = `content/collections/news/${slug}.json`;
  const item = readJson(file) as { fields: Record<string, unknown> };
  writeSiteFile(file, `${JSON.stringify({ ...item, fields: { ...item.fields, ...fields } }, null, 2)}\n`);
}

function sidebar(page: Page) {
  return editor(page).locator('[class*="_Sidebar--right_"]');
}

test("ticks yes or no and links to other items, which the page shows by their titles", async ({ page, request }) => {
  addFields();
  setFields("welcome", { schedule: [{ time: "9:00", place: "Hall" }] });
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect(canvas(page).getByRole("heading", { name: "Welcome to our new website" })).toBeVisible();

  await sidebar(page).getByLabel("Featured").check();
  await sidebar(page).getByPlaceholder("Search News").fill("open");
  await sidebar(page).getByRole("button", { name: "Open house this Saturday" }).click();
  await expect(sidebar(page).getByRole("button", { name: "Take out Open house this Saturday" })).toBeVisible();
  await expect(canvas(page).getByRole("link", { name: "Open house this Saturday" })).toBeVisible();
  await expect(canvas(page).getByText("9:00")).toBeVisible();

  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/collections/news/welcome.json")).toMatchObject({
    fields: { featured: true, related: ["open-house"], schedule: [{ time: "9:00", place: "Hall" }] },
  });
  const html = await (await request.get("/news/welcome")).text();
  expect(html).toMatch(/href="\/news\/open-house\/"[^>]*>Open house this Saturday<\/a>/);
  expect(html).toContain(">Hall</span>");
});

test("deleting an item takes it out of the items that link to it", async ({ page }) => {
  addFields();
  setFields("welcome", { related: ["open-house"] });
  await page.goto("/admin#/collections/news");
  await page
    .getByRole("row", { name: /Open house this Saturday/ })
    .getByRole("button", { name: "Delete" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("These items link to it");
  await expect(dialog.getByRole("listitem")).toHaveText(["Welcome to our new website"]);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Open house this Saturday" })).toHaveCount(0);
  expect((readJson("content/collections/news/welcome.json") as { fields: object }).fields).not.toHaveProperty(
    "related",
  );
});

test("adds a link to items and a repeating group in a collection's settings", async ({ page }) => {
  await page.goto("/admin#/collections/news/settings");
  await page.getByRole("button", { name: "Add field" }).click();
  const added = page.locator(".gfa-field-editor").last();
  await added.getByLabel("Label").first().fill("Related stories");
  await added.getByLabel("Kind of information").first().selectOption("item");
  await expect(added.getByLabel("Links to items in")).toHaveValue("news");
  await added.getByLabel("Can link to several").check();

  await page.getByRole("button", { name: "Add field" }).click();
  const group = page.locator(".gfa-field-editor").last();
  await group.getByLabel("Label").first().fill("Schedule");
  await group.getByLabel("Kind of information").first().selectOption("group");
  await group.locator(".gfa-choices").getByLabel("Label").fill("Time");
  await group.getByRole("button", { name: "Add a field to each row" }).click();
  await group.locator(".gfa-choices").getByLabel("Label").last().fill("Place");

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const fields = (readJson(SETTINGS) as { fields: unknown[] }).fields;
  expect(fields.slice(-2)).toEqual([
    { name: "related-stories", label: "Related stories", type: "item", collection: "news", multiple: true },
    {
      name: "schedule",
      label: "Schedule",
      type: "group",
      fields: [
        { name: "time", label: "Time", type: "text" },
        { name: "place", label: "Place", type: "text" },
      ],
    },
  ]);
});
