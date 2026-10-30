import { readFileSync } from "node:fs";
import { fakeAi } from "@goodfellow-cms/ai/testing";
import { type FakeTheme, fakeLanguagePacks, sampleLanguagePackFiles } from "@goodfellow-cms/core/testing";
import type { Page } from "@playwright/test";
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
    // A string without the English's placeholders isn't used.
    await expect(page.getByText("Se connecter avec")).toHaveCount(0);
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

test("changes the admin panel's own English words, and edits a site's language string by string", async ({ page }) => {
  await page.goto("/admin#/settings/admin-languages");
  await page.getByRole("link", { name: "Change words" }).first().click();
  await expect(page.getByRole("heading", { name: "English: the admin panel's words" })).toBeVisible();
  await page.getByLabel("Search").fill("nav.pages");
  const pages = page.getByRole("textbox", { name: "Pages (strings:nav.pages)" });
  await expect(pages).toHaveAttribute("placeholder", "Pages");
  await pages.fill("Our pages");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const english = JSON.parse(readSiteFile("content/admin-text/en.json"));
  expect(english.strings["nav.pages"]).toMatchObject({ text: "Our pages" });
  // The admin panel says it at once, with no English beside its own English.
  await expect(page.getByRole("link", { name: "Our pages", exact: true })).toBeVisible();

  // A site's own language: mark a string read, and fix one that can't be used.
  writeSiteFile("content/admin-text/fr.json", french);
  await page.goto("/admin#/settings/admin-languages/fr");
  // Only the address's # changed, so the page loads again to read the file just written.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Français: the admin panel's words" })).toBeVisible();
  await page.getByLabel("Show").selectOption("unusable");
  const redirect = page.getByRole("textbox", { name: /strings:signIn\.redirect/ });
  await redirect.fill("Se connecter");
  await expect(page.getByText("This needs the same words in curly braces as the English")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
  await redirect.fill("Se connecter avec {host}");
  await page.getByLabel("Show").selectOption("all");
  await page.getByLabel("Search").fill("nav.pages");
  await page.getByRole("checkbox", { name: "Read by someone who speaks it" }).check();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const file = JSON.parse(readSiteFile("content/admin-text/fr.json"));
  expect(file.strings["signIn.redirect"]).toMatchObject({ text: "Se connecter avec {host}" });
  expect(file.strings["nav.pages"]).toMatchObject({ text: "Les pages", reviewed: true });
});

/** npm's registry and jsDelivr, answering for the language packs given, in place of any routed before. */
async function routeToPacks(page: Page, packs: FakeTheme[]) {
  const fake = fakeLanguagePacks({ packs });
  for (const origin of ["https://registry.npmjs.org", "https://cdn.jsdelivr.net"]) {
    await page.unroute(`${origin}/**`);
    await page.route(`${origin}/**`, (route) => {
      const answer = fake.handle(route.request().url());
      return route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
  }
}

function german(releases: { version: string; strings: Record<string, string> }[]): FakeTheme {
  return {
    name: "goodfellow-language-de",
    description: "Das Admin-Panel auf Deutsch.",
    publisher: "sprachen",
    releases: releases.map(({ version, strings }) => ({
      version,
      files: sampleLanguagePackFiles({ code: "de", name: "Deutsch", strings }),
    })),
  };
}

test("installs a language pack, updates it keeping the owner's words, and removes it", async ({ page }) => {
  test.setTimeout(120_000);
  await routeToPacks(page, [
    german([{ version: "1.0.0", strings: { "publish.button": "Veröffentlichen", "nav.pages": "Seiten" } }]),
  ]);
  await page.goto("/admin#/settings/admin-languages");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByRole("button", { name: "Show goodfellow-language-de" }).click();
  await expect(page.getByText("The admin panel in Deutsch (de)")).toBeVisible();
  await expect(page.getByText(/^With it, \d+ of the admin panel's \d+ strings are in Deutsch\.$/)).toBeVisible();
  await page.getByRole("button", { name: "Install and publish" }).click();
  await expect(page.getByText("The admin panel in Deutsch is installed from goodfellow-language-de.")).toBeVisible();
  const installed = JSON.parse(readSiteFile("content/admin-text/de.json"));
  expect(installed.pack).toMatchObject({ name: "goodfellow-language-de", release: "1.0.0" });
  expect(installed.strings["nav.pages"]).toMatchObject({ text: "Seiten", pack: expect.any(String) });
  await expect(page.getByText("From goodfellow-language-de, version 1.0.0")).toBeVisible();

  // The owner changes one of the pack's words, then a new release changes both.
  installed.strings["nav.pages"] = { text: "Unsere Seiten" };
  writeSiteFile("content/admin-text/de.json", `${JSON.stringify(installed, null, 2)}\n`);
  await routeToPacks(page, [
    german([
      { version: "1.0.0", strings: {} },
      { version: "1.1.0", strings: { "publish.button": "Jetzt veröffentlichen", "nav.pages": "Alle Seiten" } },
    ]),
  ]);
  await page.reload();
  await page.getByRole("button", { name: "Show goodfellow-language-de" }).click();
  await expect(page.getByText("You have your own words for 1 strings", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Update to 1.1.0" }).click();
  await expect(page.getByText("The admin panel in Deutsch is installed from goodfellow-language-de.")).toBeVisible();
  const updated = JSON.parse(readSiteFile("content/admin-text/de.json"));
  expect(updated.pack.release).toBe("1.1.0");
  expect(updated.strings["publish.button"].text).toBe("Jetzt veröffentlichen");
  expect(updated.strings["nav.pages"].text).toBe("Unsere Seiten");

  // Removing it keeps only what the owner wrote.
  await page.getByRole("button", { name: "Show goodfellow-language-de" }).click();
  await expect(page.getByText("Version 1.1.0 is installed, the newest offered.")).toBeVisible();
  await page.getByRole("button", { name: "Remove the pack" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove the pack" }).click();
  await expect(page.getByText("goodfellow-language-de is removed.")).toBeVisible();
  const left = JSON.parse(readSiteFile("content/admin-text/de.json"));
  expect(left).not.toHaveProperty("pack");
  expect(left.strings).toEqual({ "nav.pages": { text: "Unsere Seiten" } });
});
