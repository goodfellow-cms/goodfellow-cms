import { canvas, editor, expect, openPageEditor, test } from "./helpers";

test("shows the admin panel, Puck and blocks' settings in the language chosen, and remembers it", async ({ page }) => {
  await page.goto("/admin#/pages");
  await expect(page.getByRole("link", { name: "Pages", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Language of the admin panel" }).selectOption("es");

  await expect(page.getByRole("link", { name: "Páginas", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Páginas" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  // The editor: the admin panel's header, Puck's own text and the blocks' names and groups.
  await openPageEditor(page, "/about", "About us");
  await expect(page.locator(".gfa-editor-header").getByText("Publicar", { exact: true })).toBeVisible();
  await expect(editor(page).getByText("Esquema", { exact: true }).first()).toBeVisible();
  await expect(editor(page).getByText("Diseño", { exact: true }).first()).toBeVisible();
  await expect(editor(page).getByText("Sección", { exact: true }).first()).toBeVisible();
  // The page's settings, from the renderer's own fields.
  await expect(
    editor(page).getByText("Título de la página", { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  // What's edited stays as it is written.
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();

  // Remembered in this browser.
  await page.goto("/admin#/settings/general");
  await expect(page.getByRole("heading", { name: "General" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ajustes del sitio", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Idioma del panel de administración" }).selectOption("en");
  await expect(page.getByRole("link", { name: "Site Settings", exact: true })).toBeVisible();
});

test.describe("in a browser set to Spanish", () => {
  test.use({ locale: "es-MX" });

  test("starts in Spanish", async ({ page }) => {
    await page.goto("/admin#/pages");
    await expect(page.getByRole("link", { name: "Páginas", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Idioma del panel de administración" })).toHaveValue("es");
  });
});
