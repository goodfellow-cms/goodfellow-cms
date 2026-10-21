import {
  canvas,
  expect,
  field,
  openPageEditor,
  publishInEditor,
  readJson,
  readSiteFile,
  test,
  writeSiteFile,
} from "./helpers";

test("stops a publish that would leave links to a page that's gone", async ({ page }) => {
  await page.goto("/admin");
  await page
    .getByRole("row", { name: /About us/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("button", { name: "Delete page" }).click();

  const dialog = page.getByRole("dialog", { name: "This can't be published yet" });
  await expect(dialog).toContainText("A menu links to /about, which isn't a page on the site.");
  // Only going back is offered.
  await expect(dialog.getByRole("button", { name: "Publish anyway" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Go back" }).click();
  await expect(dialog).toHaveCount(0);
  // The delete dialog stays open, with nothing more to say.
  await expect(page.getByRole("dialog", { name: /Delete/ })).not.toContainText("couldn't");
  expect(readSiteFile("content/pages/about.json")).toContain("About us");
});

test("shows colors that are hard to read as they're chosen, and publishes them if asked to", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  const note = page.getByRole("status").filter({ hasText: "hard to read" });
  await expect(note).toHaveCount(0);

  await page.getByRole("textbox", { name: "Main color", exact: true }).fill("#ffcc00");
  await expect(note).toContainText('Text in "Text on main color" is hard to read on "Main color"');
  await page.getByRole("textbox", { name: "Text on main color", exact: true }).fill("#1a1a1a");
  await expect(note).toHaveCount(0);
  await page.getByRole("textbox", { name: "Text on main color", exact: true }).fill("#ffffff");

  await page.getByRole("button", { name: "Publish" }).click();
  const dialog = page.getByRole("dialog", { name: "Publish anyway?" });
  await expect(dialog).toContainText("hard to read");
  await dialog.getByRole("button", { name: "Publish anyway" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    theme: { colors: { primary: "#ffcc00", primaryForeground: "#ffffff" } },
  });
});

test("warns about what a page has wrong as it shows, such as an image without a description", async ({ page }) => {
  // The About page's picture, as an editor might leave it.
  writeSiteFile(
    "content/pages/about.json",
    readSiteFile("content/pages/about.json").replace(
      '"alt": "A placeholder picture, to replace with a photo of your own"',
      '"alt": ""',
    ),
  );
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("About our parish");
  await publishInEditor(page);

  const dialog = page.getByRole("dialog", { name: "Publish anyway?" });
  await expect(dialog).toContainText(
    'The page "About us" has an image, placeholder.svg, with no description for people who can\'t see it.',
  );
  await dialog.getByRole("button", { name: "Publish anyway" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/pages/about.json")).toContain('"text": "About our parish"');
});
