import { canvas, expect, field, publishInEditor, readSiteFile, test, writeSiteFile } from "./helpers";

/** A page for the Outline plugin's editor (`e2e/fixtures/plugins/outline`) to edit. */
const outlinePage = {
  version: 1,
  data: {
    content: [
      { type: "Heading", props: { id: "Heading-1", className: "", text: "Welcome", level: "h1", align: "left" } },
    ],
    root: { props: { className: "", description: "A page to outline", image: "", title: "Outlined" } },
  },
};

const editorAddress = `/admin#/pages/edit?path=${encodeURIComponent("/outlined")}`;

test("an editor plugin edits a page in place of Puck, in a sandboxed frame, and publishes what fits the site's blocks", async ({
  page,
}) => {
  test.setTimeout(90_000);
  writeSiteFile("content/pages/outlined.json", `${JSON.stringify(outlinePage, null, 2)}\n`);
  await page.goto(editorAddress);
  await expect(canvas(page).getByRole("heading", { name: "Welcome" })).toBeVisible({ timeout: 20_000 });

  // Each person chooses their editor: the standard one unless they choose another.
  const choice = page.locator(".gfa-editor-header").getByLabel("Editor");
  await expect(choice).toHaveValue("");
  await choice.selectOption({ label: "Outline editor" });
  const frame = page.locator('iframe[title="Editing Outlined"]');
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  // The frame is named for what's edited, whose title changes below.
  const outline = page.frameLocator("iframe.gfa-editor-frame");
  await expect(outline.getByRole("heading", { name: "Outline of Outlined (page)" })).toBeVisible({ timeout: 20_000 });
  // Puck's own sidebars and preview widths aren't the plugin's.
  await expect(page.getByRole("button", { name: "Phone" })).toBeHidden();

  // What it changes counts as unpublished, with the header's Undo and Redo.
  await outline.getByLabel("Page title").fill("Outlined again");
  await outline.getByLabel("Page title").press("Tab");
  await outline.getByLabel("Heading 1").fill("Hello");
  await outline.getByLabel("Heading 1").press("Tab");
  const undo = page.locator(".gfa-editor-header").getByRole("button", { name: "Undo" });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(outline.getByLabel("Heading 1")).toHaveValue("Welcome");
  await page.locator(".gfa-editor-header").getByRole("button", { name: "Redo" }).click();
  await expect(outline.getByLabel("Heading 1")).toHaveValue("Hello");

  // The page asks the admin panel how a link to it looks when shared.
  await outline.getByRole("button", { name: "Preview a shared link" }).click();
  await expect(outline.getByRole("status")).toHaveText(/Shared as Outlined again/);

  await publishInEditor(page);
  await expect(page.getByText("Published.")).toBeVisible({ timeout: 15_000 });
  const saved = JSON.parse(readSiteFile("content/pages/outlined.json")) as typeof outlinePage;
  expect(saved.data.root.props.title).toBe("Outlined again");
  expect(saved.data.content[0]?.props).toEqual({ ...outlinePage.data.content[0]?.props, text: "Hello" });

  // A block the site doesn't have isn't published.
  await outline.getByRole("button", { name: "Add a script" }).click();
  await publishInEditor(page);
  await expect(page.getByText("Outline editor gave back something this site can't publish")).toBeVisible();
  expect(JSON.parse(readSiteFile("content/pages/outlined.json"))).toEqual(saved);

  // The choice is kept in this browser, and the standard editor is a choice away.
  await page.reload();
  await expect(outline.getByRole("heading", { name: "Outline of Outlined again (page)" })).toBeVisible({
    timeout: 20_000,
  });
  await page.locator(".gfa-editor-header").getByLabel("Editor").selectOption({ label: "Standard editor" });
  await expect(canvas(page).getByRole("heading", { name: "Hello" })).toBeVisible({ timeout: 20_000 });
});

test("switching editors keeps what's unpublished, and asks before leaving behind what the site can't keep", async ({
  page,
}) => {
  test.setTimeout(90_000);
  writeSiteFile("content/pages/outlined.json", `${JSON.stringify(outlinePage, null, 2)}\n`);
  await page.goto(editorAddress);
  await expect(canvas(page).getByRole("heading", { name: "Welcome" })).toBeVisible({ timeout: 20_000 });
  const choice = page.locator(".gfa-editor-header").getByLabel("Editor");
  const outline = page.frameLocator("iframe.gfa-editor-frame");

  // From Puck, as it is when the choice is made.
  await canvas(page).locator("[data-puck-component]").filter({ hasText: "Welcome" }).last().click();
  await field(page, "text").fill("Changed in Puck");
  await choice.selectOption({ label: "Outline editor" });
  await expect(outline.getByLabel("Heading 1")).toHaveValue("Changed in Puck", { timeout: 20_000 });

  // From the plugin, back to Puck.
  await outline.getByLabel("Heading 1").fill("Changed in the outline");
  await outline.getByLabel("Heading 1").press("Tab");
  await choice.selectOption({ label: "Standard editor" });
  await expect(canvas(page).getByRole("heading", { name: "Changed in the outline" })).toBeVisible({ timeout: 20_000 });

  // A change the site can't publish: the editor is asked, and staying keeps everything.
  await choice.selectOption({ label: "Outline editor" });
  await expect(outline.getByLabel("Heading 1")).toHaveValue("Changed in the outline", { timeout: 20_000 });
  await outline.getByRole("button", { name: "Add a script" }).click();
  const asked: string[] = [];
  page.once("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await choice.selectOption({ label: "Standard editor" });
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toContain("can't be kept in the other editor");
  await expect(choice).not.toHaveValue("");
  await expect(outline.getByLabel("Heading 1")).toHaveValue("Changed in the outline");
  // Agreeing leaves behind only what was changed since the plugin opened.
  await outline.getByLabel("Heading 1").fill("Changed again");
  await outline.getByLabel("Heading 1").press("Tab");
  page.once("dialog", (dialog) => void dialog.accept());
  await choice.selectOption({ label: "Standard editor" });
  await expect(canvas(page).getByRole("heading", { name: "Changed in the outline" })).toBeVisible({ timeout: 20_000 });
  expect(JSON.parse(readSiteFile("content/pages/outlined.json"))).toEqual(outlinePage);
});

test("an editor plugin has blocks drawn by the site's code, with their slots left for it to fill", async ({ page }) => {
  test.setTimeout(90_000);
  const drawnPage = {
    version: 1,
    data: {
      content: [
        {
          type: "Section",
          props: {
            id: "Section-1",
            className: "",
            content: [
              {
                type: "Heading",
                props: { id: "Heading-2", text: "Inside", level: "h2", align: "left", className: "" },
              },
            ],
          },
        },
        { type: "Heading", props: { id: "Heading-1", className: "", text: "Drawn", level: "h1", align: "left" } },
      ],
      root: { props: { className: "", description: "Drawn blocks", image: "", title: "Drawn" } },
    },
  };
  writeSiteFile("content/pages/drawn.json", `${JSON.stringify(drawnPage, null, 2)}\n`);
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/drawn")}`);
  await page.locator(".gfa-editor-header").getByLabel("Editor").selectOption({ label: "Outline editor" });
  const outline = page.frameLocator("iframe.gfa-editor-frame");
  const drawn = outline.locator(".drawn");

  // A block as the site draws it, in the page it's on.
  await outline.getByRole("button", { name: "Draw Heading 2" }).click();
  await expect(drawn.getByRole("heading", { level: 1, name: "Drawn" })).toBeVisible({ timeout: 20_000 });
  // A block with a slot: its own HTML, with the slot left empty where its blocks go.
  await outline.getByRole("button", { name: "Draw Section 1" }).click();
  await expect(drawn.locator('gf-slot[data-slot="content"]')).toHaveCount(1);
  await expect(drawn.locator("gf-slot")).toBeEmpty();
  await expect(drawn.locator("section, div").first()).toBeAttached();
  await expect(drawn).not.toContainText("Inside");

  // Only blocks the site has, for what's edited.
  await outline.getByRole("button", { name: "Draw a block the site doesn't have" }).click();
  await expect(outline.getByRole("status")).toHaveText(/Refused: .*Script/);

  // The site's stylesheets, with the theme, and Tailwind's source for classes the last build hasn't seen.
  await outline.getByRole("button", { name: "Load the site's styles" }).click();
  await expect(outline.getByRole("status")).toHaveText(
    /^[1-9]\d* stylesheets, with the theme, and Tailwind's source with the theme's classes, and the theme's fonts$/,
  );
  // An editor's frame is the editor's alone: no screen's spacing, and none of the screens' plain styles.
  const body = page.frameLocator("iframe.gfa-editor-frame").locator("body");
  await expect(body).toHaveCSS("padding-top", "0px");
  await expect(body).toHaveCSS("max-width", "none");
  await expect(outline.locator("li").first()).toHaveCSS("margin-bottom", "0px");
});

test("an editor plugin's frame shows a picture uploaded from it straight away, before the site has it", async ({
  page,
}) => {
  test.setTimeout(90_000);
  writeSiteFile("content/pages/outlined.json", `${JSON.stringify(outlinePage, null, 2)}\n`);
  await page.goto(editorAddress);
  await page.locator(".gfa-editor-header").getByLabel("Editor").selectOption({ label: "Outline editor" });
  const outline = page.frameLocator("iframe.gfa-editor-frame");
  await outline.getByRole("button", { name: "Choose a picture" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose an image" });
  const picture = '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2"/></svg>';
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "Bell.svg", mimeType: "image/svg+xml", buffer: Buffer.from(picture) });
  await expect(dialog).toBeHidden();
  await expect(outline.getByRole("status")).toHaveText("Chose /media/bell.svg");
  // The plugin wrote content's address; the frame shows the upload from memory, as Puck's canvas does.
  const shown = outline.getByRole("img", { name: "Chosen" });
  await expect(shown).toHaveAttribute("data-gf-src", "/media/bell.svg");
  await expect(shown).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(3);
});

test("an editor plugin is offered only for what it edits, and edits the header", async ({ page }) => {
  await page.goto("/admin#/layout/header");
  const choice = page.locator(".gfa-editor-header").getByLabel("Editor");
  await choice.selectOption({ label: "Outline editor" });
  const outline = page.frameLocator('iframe[title^="Editing"]');
  // The header has no page settings, and the editor is told what it edits.
  await expect(outline.getByRole("heading", { name: /\(header\)$/ })).toBeVisible({ timeout: 20_000 });

  // Collections' templates and items aren't among what it edits, so they keep the standard editor.
  await page.goto("/admin#/collections/news/template");
  await expect(page.locator(".gfa-editor-header")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".gfa-editor-header").getByLabel("Editor")).toHaveCount(0);
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  await expect(page.locator(".gfa-editor-header")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".gfa-editor-header").getByLabel("Editor")).toHaveCount(0);
});
