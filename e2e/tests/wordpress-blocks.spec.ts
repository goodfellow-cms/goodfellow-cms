import { canvas, editor, expect, openPageEditor, publishInEditor, readJson, test, writeSiteFile } from "./helpers.js";

/** A page with the blocks made for WordPress's own. */
function libraryPage() {
  const block = (type: string, props: Record<string, unknown>) => ({
    type,
    props: { id: `${type}-1`, className: "", ...props },
  });
  return `${JSON.stringify(
    {
      version: 1,
      data: {
        root: { props: { title: "Library" } },
        content: [
          block("Heading", { text: "Library", level: "h1", align: "left" }),
          block("Table", {
            cells: [
              ["Day", "Time"],
              ["Sunday", "9:00"],
            ],
            header: true,
            footer: false,
            caption: "Mass times",
            striped: false,
          }),
          block("Audio", { src: "/media/homily.mp3", caption: "Sunday's homily", loop: false }),
          block("Details", {
            summary: "Parking",
            open: false,
            content: [block("Text", { content: "<p>Behind the hall.</p>", align: "left" })],
          }),
          block("Separator", { style: "wide" }),
        ],
      },
    },
    null,
    2,
  )}\n`;
}

test("shows WordPress's blocks on the site, and edits a table's cells in a grid", async ({ page, request }) => {
  writeSiteFile("public/media/homily.mp3", "not really a sound file");
  writeSiteFile("content/pages/library.json", libraryPage());

  const html = await (await request.get("/library")).text();
  expect(html).toMatch(/<th scope="col" class="gf-table-header-cell[^"]*">Day<\/th>/);
  expect(html).toMatch(/<audio controls="" preload="metadata" src="\/media\/homily\.mp3"/);
  expect(html).toMatch(/<details class="gf-details[^"]*"><summary class="gf-details-summary[^"]*">Parking<\/summary>/);
  expect(html).toMatch(/<hr class="gf-separator[^"]*border-t[^"]*"\/>/);

  await openPageEditor(page, "/library", "Library");
  // A closed Details block is open in the editor, so what's inside it can be edited.
  await expect(canvas(page).getByText("Behind the hall.")).toBeVisible();

  // The table is from before cells could be formatted: opening it changes nothing that would need publishing.
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole("link", { name: "Site settings" }).click();
  await expect(page).toHaveURL(/#\/settings\/general$/);
  expect(asked).toEqual([]);
  await openPageEditor(page, "/library", "Library");

  await canvas(page).locator('[data-puck-component="Table-1"]').click();
  const cell = editor(page).getByRole("textbox", { name: "Row 2, column 2" });
  await expect(cell).toHaveText("9:00");
  await cell.fill("10:30");
  await editor(page).getByRole("button", { name: "Add a row" }).click();
  const monday = editor(page).getByRole("textbox", { name: "Row 3, column 1" });
  await monday.fill("Monday");
  // Words in a cell can be bold.
  await monday.press("ControlOrMeta+a");
  await editor(page).getByRole("button", { name: "Bold" }).filter({ visible: true }).click();
  await editor(page).getByRole("button", { name: "Add a column" }).click();
  await editor(page).getByRole("textbox", { name: "Row 1, column 3" }).fill("Where & when");
  await expect(canvas(page).locator("td strong, td b").filter({ hasText: "Monday" })).toBeVisible();

  await publishInEditor(page);
  await expect(page.getByText("Published.")).toBeVisible();
  const saved = readJson("content/pages/library.json") as {
    data: { content: Array<{ type: string; props: Record<string, unknown> }> };
  };
  const table = saved.data.content.find((block) => block.type === "Table")?.props;
  expect(table?.format).toBe("html");
  expect(table?.cells).toEqual([
    ["Day", "Time", "Where &amp; when"],
    ["Sunday", "10:30", ""],
    ["<b>Monday</b>", "", ""],
  ]);
  const shown = await (await request.get("/library")).text();
  expect(shown).toMatch(/<td class="gf-table-cell[^"]*"><b>Monday<\/b><\/td>/);

  // Sound files are chosen from the media library's sound files only.
  await canvas(page).locator('[data-puck-component="Audio-1"]').click();
  await editor(page).getByRole("button", { name: "Choose sound file" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a sound file" });
  await expect(dialog.getByText("homily.mp3")).toBeVisible();
  await expect(dialog.getByText("placeholder.svg")).toHaveCount(0);
});
