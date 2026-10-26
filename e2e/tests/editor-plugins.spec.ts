import { canvas, expect, publishInEditor, readSiteFile, test, writeSiteFile } from "./helpers";

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
