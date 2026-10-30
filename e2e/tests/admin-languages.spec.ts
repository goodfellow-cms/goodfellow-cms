import { readFileSync } from "node:fs";
import { fakeAi } from "@goodfellow-cms/ai/testing";
import { GITHUB_SITE, routeToFake } from "./backends.js";
import { canvas, editor, expect, openPageEditor, readSiteFile, test, writeSiteFile } from "./helpers";

const french = readFileSync(new URL("../fixtures/admin-text/fr.json", import.meta.url), "utf8");

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

test("speaks a language the site has the admin panel's text in, with English where its words can't be used", async ({
  page,
}) => {
  writeSiteFile("content/admin-text/fr.json", french);
  await page.goto("/admin#/pages");
  const menu = page.getByRole("combobox", { name: "Language of the admin panel" });
  await expect(menu.locator("option", { hasText: "Français" })).toHaveCount(1);
  await menu.selectOption("fr");
  await expect(page.getByRole("link", { name: "Les pages", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  // What the site's file doesn't have is in English.
  await expect(page.getByRole("link", { name: "Media", exact: true })).toBeVisible();
  // Blocks' names too, in the editor's frame.
  await openPageEditor(page, "/about", "About us");
  await expect(editor(page).getByText("Bloc de section", { exact: true }).first()).toBeVisible();

  // Remembered, and English again once the site's file can't be used.
  await page.goto("/admin#/pages");
  await expect(page.getByRole("link", { name: "Les pages", exact: true })).toBeVisible();
  writeSiteFile("content/admin-text/fr.json", "");
  await page.reload();
  await expect(page.getByRole("link", { name: "Pages", exact: true })).toBeVisible();
});

test.describe("in a browser set to French", () => {
  test.use({ locale: "fr-FR" });

  test("signs in in the site's own language, from the copy its build published", async ({ page }) => {
    await page.goto(`${GITHUB_SITE}/admin/`);
    // Its strings about signing in show the English beside them.
    await expect(
      page.getByRole("heading", { name: "Connectez-vous pour modifier ce site (Sign in to edit this site)" }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    // A string with git's words in it isn't used.
    await expect(page.getByText("repository avec")).toHaveCount(0);
  });
});

test("translates the admin panel into a new language with the editor's AI service, and publishes it", async ({
  page,
}) => {
  const key = "sk-ant-test-key";
  // Claude, answering every string asked for with "FR " before its English.
  const fake = fakeAi({
    keys: [key],
    answer: (body) => {
      const messages = body.messages as { content: string }[];
      const json = /<site-content>\n([\s\S]*)\n<\/site-content>/.exec(messages[0]?.content ?? "")?.[1] ?? "[]";
      const asked = JSON.parse(json) as { key: string; english: string }[];
      return { strings: asked.map(({ key: item, english }) => ({ key: item, text: `FR ${english}` })) };
    },
  });
  await routeToFake(page, "https://api.anthropic.com", fake.handle);

  await page.goto("/admin#/settings/admin-languages");
  await expect(page.getByRole("heading", { name: "Admin panel languages" })).toBeVisible();
  await expect(page.getByText("The site has no languages of its own for the admin panel yet.")).toBeVisible();
  await page.getByLabel("API key").fill(key);
  await page.getByLabel("Language code").fill("fr");
  await page.getByLabel("Its name, in that language").fill("Français");
  await page.getByRole("button", { name: "Add and translate" }).click();

  await expect(page.getByText(/^Translated and published \d+ strings\.$/)).toBeVisible({ timeout: 60_000 });
  const file = JSON.parse(readSiteFile("content/admin-text/fr.json"));
  expect(file).toMatchObject({ version: 1, name: "Français" });
  expect(file.strings["nav.pages"]).toMatchObject({ text: "FR Pages", source: expect.stringMatching(/^[0-9a-f]{8}$/) });
  expect(file.puck["header-publish"].text).toBe("FR Publish");
  expect(file.labels.Section.text).toBe("FR Section");
  // Every request went to Claude with the glossary.
  expect(fake.requests.length).toBeGreaterThan(1);
  expect(JSON.stringify(fake.requests[1]?.body)).toContain("FR Publish");
  await expect(page.getByRole("cell", { name: /Français/ })).toBeVisible();

  // Editors can then choose it.
  await page.getByRole("combobox", { name: "Language of the admin panel" }).selectOption("fr");
  await expect(page.getByRole("link", { name: "FR Pages", exact: true })).toBeVisible();
});
