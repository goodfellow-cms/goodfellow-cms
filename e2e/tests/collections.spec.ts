import type { Page } from "@playwright/test";
import { canvas, editor, expect, publishInEditor, readJson, readSiteFile, test } from "./helpers.js";

/** A labelled field in Puck's right-hand panel. Puck renders hidden copies of fields, so only visible ones count. */
function sidebarField(page: Page, label: string) {
  return editor(page).getByLabel(label, { exact: true }).filter({ visible: true }).first();
}

test("builds a page for each item, and lists items on other pages", async ({ request }) => {
  const list = await (await request.get("/news")).text();
  expect(list).toContain('<a href="/news/welcome" class="after:absolute after:inset-0 hover:underline">');
  expect(list.indexOf("Welcome to our new website")).toBeLessThan(list.indexOf("Open house this Saturday"));

  const story = await (await request.get("/news/welcome")).text();
  expect(story).toContain("<title>Welcome to our new website | My site</title>");
  expect(story).toContain('<time dateTime="2026-10-01">October 1, 2026</time>');
});

test("edits an item, previewing it with the collection's page design", async ({ page, request }) => {
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect(canvas(page).getByRole("heading", { name: "Welcome to our new website" })).toBeVisible();

  await sidebarField(page, "Title *").fill("Our new website is here");
  await expect(canvas(page).getByRole("heading", { name: "Our new website is here" })).toBeVisible();
  await sidebarField(page, "Date *").fill("2026-10-02");
  await expect(canvas(page).getByText("October 2, 2026")).toBeVisible();

  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/collections/news/welcome.json")).toMatchObject({
    version: 1,
    fields: { title: "Our new website is here", date: "2026-10-02", image: "/media/placeholder.svg" },
  });
  expect(await (await request.get("/news/welcome")).text()).toContain("Our new website is here");
});

test("the item editor shows only what items need, with a wider sidebar of its own", async ({ page }) => {
  const rightSideBar = editor(page).locator('[class*="_Sidebar--right_"]');
  const sideBarWidth = async () => Math.round((await rightSideBar.boundingBox())?.width ?? 0);
  const widths = (key: string) =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").rightSideBarWidth, key);
  await page.goto("/admin#/");
  await page.evaluate(() =>
    localStorage.setItem("goodfellow-editor-sidebar-widths", JSON.stringify({ rightSideBarWidth: 300 })),
  );

  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect(canvas(page).getByRole("heading", { name: "Welcome to our new website" })).toBeVisible();
  // No blocks to add or outline, and the AI assistant, outside the editor's frame, starts closed.
  const nav = editor(page).locator('nav[class*="_Nav_"]');
  await expect(page.locator(".gfa-editor-header").getByRole("button", { name: "AI", exact: true })).toBeVisible();
  await expect(nav.getByText("Blocks", { exact: true })).toBeHidden();
  await expect(nav.getByText("Outline", { exact: true })).toBeHidden();
  await expect(page.locator(".gfa-ai")).toBeHidden();
  await expect.poll(sideBarWidth).toBe(520);

  // Resizing it is remembered for items only.
  const handle = editor(page).locator('[class*="_ResizeHandle--right_"]');
  const box = await handle.boundingBox();
  if (!box) throw new Error("No resize handle");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(sideBarWidth).toBe(600);
  await expect.poll(() => widths("goodfellow-entry-sidebar-widths")).toBe(600);
  await expect.poll(() => widths("goodfellow-editor-sidebar-widths")).toBe(300);

  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/about")}`);
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  await expect(editor(page).locator('nav[class*="_Nav_"]').getByText("Blocks", { exact: true })).toBeVisible();
  await expect.poll(sideBarWidth).toBe(300);
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect.poll(sideBarWidth).toBe(600);
});

test("won't publish an item without its required fields", async ({ page }) => {
  await page.goto("/admin#/collections/news/edit?slug=open-house");
  await expect(canvas(page).getByRole("heading", { name: "Open house this Saturday" })).toBeVisible();
  await sidebarField(page, "Title *").fill("");
  await publishInEditor(page);
  await expect(page.getByText("Fill in Title before publishing.")).toBeVisible();
  expect(readSiteFile("content/collections/news/open-house.json")).toContain("Open house this Saturday");
});

test("adds an item to a collection", async ({ page }) => {
  await page.goto("/admin#/collections/news");
  await page.getByRole("button", { name: "Add news story" }).click();
  await page.getByLabel("Title").fill("Christmas schedule");
  await expect(page.getByLabel("Address")).toHaveValue("christmas-schedule");
  await page.getByRole("dialog").getByRole("button", { name: "Add news story" }).click();

  await expect(page).toHaveURL(/#\/collections\/news\/edit\?slug=christmas-schedule$/);
  expect(readJson("content/collections/news/christmas-schedule.json")).toEqual({
    version: 1,
    fields: { title: "Christmas schedule" },
  });
});

test("refuses an item address another page uses", async ({ page }) => {
  await page.goto("/admin#/collections/news");
  await page.getByRole("button", { name: "Add news story" }).click();
  await page.getByLabel("Title").fill("Welcome");
  await page.getByLabel("Address").fill("welcome");
  await page.getByRole("dialog").getByRole("button", { name: "Add news story" }).click();
  await expect(page.getByText("Something else on the site already uses this address.")).toBeVisible();
});

test("creates a collection and adds a field to it", async ({ page }) => {
  await page.goto("/admin#/collections");
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Videos");
  await page.getByLabel("One item is called").fill("Video");
  await expect(page.getByLabel("Address of the pages")).toHaveValue("/videos");
  await page.getByRole("button", { name: "Create collection" }).click();

  await expect(page).toHaveURL(/#\/collections\/videos$/);
  await expect(page.getByText("There's nothing in Videos yet.")).toBeVisible();
  expect(readJson("content/collections/videos/_collection.json")).toMatchObject({
    name: "Videos",
    entryName: "Video",
    path: "/videos/{slug}",
    fields: [
      { name: "title", type: "text" },
      { name: "text", type: "richtext" },
    ],
  });

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Add field" }).click();
  const label = page.getByLabel("Label").last();
  await label.fill("Speaker");
  await expect(page.getByText("Show it on the page design with {speaker}")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const settings = readJson("content/collections/videos/_collection.json");
  expect(settings.fields).toEqual([
    { name: "title", label: "Title", type: "text", required: true },
    { name: "text", label: "Text", type: "richtext" },
    { name: "speaker", label: "Speaker", type: "text" },
  ]);

  await page.getByRole("link", { name: "Page design" }).click();
  await expect(page.locator(".gfa-template-help")).toContainText("{speaker} Speaker");
});

test("removing a field removes it from every item", async ({ page }) => {
  await page.goto("/admin#/collections/news/settings");
  const summary = page
    .locator(".gfa-field-editor")
    .filter({ has: page.getByLabel("Label").and(page.locator('[value="Summary"]')) });
  await summary.getByRole("button", { name: "Remove field" }).click();
  await expect(page.getByText("Removed fields are also removed from every item when you publish.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  expect(readSiteFile("content/collections/news/_collection.json")).not.toContain('"summary"');
  expect(readSiteFile("content/collections/news/welcome.json")).not.toContain('"summary"');
  expect(readSiteFile("content/collections/news/open-house.json")).not.toContain('"summary"');
});

test("edits the page design every item shares", async ({ page, request }) => {
  await page.goto("/admin#/collections/news/template");
  const button = canvas(page).getByRole("link", { name: "All news" });
  await expect(button).toBeVisible();
  await canvas(page).locator('[data-puck-component="Button-news"]').click();
  await editor(page).locator('input[name="label"]:visible').first().fill("More news");
  await expect(canvas(page).getByRole("link", { name: "More news" })).toBeVisible();

  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  for (const slug of ["welcome", "open-house"]) {
    expect(await (await request.get(`/news/${slug}`)).text()).toContain("More news");
  }
});

test("deletes an item", async ({ page, request }) => {
  await page.goto("/admin#/collections/news");
  await page
    .getByRole("row", { name: /Open house this Saturday/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Open house this Saturday" })).toHaveCount(0);
  expect((await request.get("/news/open-house")).status()).toBe(404);
});

test("opening an item doesn't count as a change", async ({ page }) => {
  let asked = false;
  page.on("dialog", (dialog) => {
    asked = true;
    void dialog.dismiss();
  });
  await page.goto("/admin#/collections/news/edit?slug=open-house");
  await expect(canvas(page).getByRole("heading", { name: "Open house this Saturday" })).toBeVisible();
  await page.getByRole("link", { name: "Items", exact: true }).click();
  await expect(page).toHaveURL(/#\/collections\/news$/);
  expect(asked).toBe(false);
});

test("chooses which collection a list shows in the page editor", async ({ page }) => {
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/news")}`);
  await expect(canvas(page).getByRole("link", { name: "Welcome to our new website" })).toBeVisible();
  await canvas(page).locator('[data-puck-component="CollectionList-news"]').click();
  const sidebar = editor(page);
  // Puck's options name themselves with their label attribute.
  const options = (name: string) =>
    sidebar
      .getByRole("combobox", { name, exact: true })
      .locator("option")
      .evaluateAll((elements) =>
        elements.map((option) => [(option as HTMLOptionElement).label, (option as HTMLOptionElement).selected]),
      );
  await expect
    .poll(() => options("Collection"))
    .toEqual([
      ["Choose…", false],
      ["News", true],
    ]);
  await expect
    .poll(() => options("Date"))
    .toEqual([
      ["None", false],
      ["Date", true],
    ]);

  await sidebar.getByRole("spinbutton", { name: "How many (0 for all)" }).fill("1");
  await expect(canvas(page).getByRole("link", { name: "Welcome to our new website" })).toBeVisible();
  await expect(canvas(page).getByRole("link", { name: "Open house this Saturday" })).toHaveCount(0);
});
