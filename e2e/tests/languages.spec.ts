import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { site } from "../scripts/site.mjs";
import { canvas, expect, readJson, readSiteFile, test, writeSiteFile } from "./helpers.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Gives the starter a second language, Spanish, with the site's title in it. */
function addSpanish(extra: Record<string, unknown> = {}) {
  writeSiteFile(
    "content/site.json",
    json({
      ...readJson("content/site.json"),
      languages: [{ code: "es", name: "Español" }],
      translations: { es: { title: "Mi sitio" } },
      ...extra,
    }),
  );
}

function writePage(path: string, value: unknown) {
  mkdirSync(join(site as string, path, ".."), { recursive: true });
  writeSiteFile(path, json(value));
}

test("adds a language, translates a page and says when the translation is out of date", async ({ page }) => {
  await page.goto("/admin#/settings/languages");
  await page.getByRole("button", { name: "Add a language" }).click();
  const card = page.locator(".gfa-language-card");
  await card.getByLabel("Language code").fill("es");
  await expect(card.getByRole("heading", { name: "Español" })).toBeVisible();
  await card.getByLabel("Site name").fill("Mi sitio");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    languages: [{ code: "es" }],
    translations: { es: { title: "Mi sitio" } },
  });

  await page.goto("/admin#/pages");
  const about = page.getByRole("row").filter({ hasText: "/about" });
  await about.getByRole("button", { name: "Translate into Español" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Address")).toHaveValue("/es/about");
  await dialog.getByRole("button", { name: "Make the copy" }).click();
  // The copy opens in the editor, to translate.
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  const copy = readJson("content/pages/es/about.json");
  expect(copy).toMatchObject({ translationOf: "/about" });
  expect(typeof copy.translatedFrom).toBe("string");

  await page.goto("/admin#/pages");
  await expect(page.getByRole("row").filter({ hasText: "/about" }).first()).toContainText("Up to date");
  await expect(page.getByRole("row").filter({ hasText: "/es/about" })).toContainText("Translation of About us");

  // The original changes, so the translation is out of date until someone checks it.
  const original = readJson("content/pages/about.json") as { data: { root: { props: Record<string, unknown> } } };
  original.data.root.props.title = "About our parish";
  writeSiteFile("content/pages/about.json", json(original));
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "/about" }).first();
  await expect(row).toContainText("Out of date");
  await row.getByRole("button", { name: "Mark as up to date" }).click();
  await expect(row).toContainText("Up to date");
  expect(readJson("content/pages/es/about.json").translatedFrom).not.toBe(copy.translatedFrom);
});

test("a translation of a page that isn't shown yet keeps its schedule", async ({ page }) => {
  addSpanish();
  writeSiteFile(
    "content/pages/about.json",
    json({ ...readJson("content/pages/about.json"), showFrom: "2099-01-01T09:00" }),
  );
  await page.goto("/admin#/pages");
  await page
    .getByRole("row")
    .filter({ hasText: "/about" })
    .getByRole("button", { name: "Translate into Español" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Make the copy" }).click();
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  expect(readJson("content/pages/es/about.json")).toMatchObject({
    showFrom: "2099-01-01T09:00",
    translationOf: "/about",
  });
});

test("shows each page in its language, with links to its translations", async ({ page }) => {
  addSpanish({ url: "https://site.example/" });
  const about = readJson("content/pages/about.json") as { data: { root: { props: Record<string, unknown> } } };
  writePage("content/pages/es/sobre.json", {
    ...about,
    translationOf: "/about",
    data: { ...about.data, root: { props: { ...about.data.root.props, title: "Quiénes somos" } } },
  });
  // A Language switch in the header.
  const header = readJson("content/layout/header.json") as { data: { content: unknown[] } };
  header.data.content.push({
    type: "LanguageSwitch",
    props: { id: "LanguageSwitch-test", display: "links", label: "Languages", className: "" },
  });
  writeSiteFile("content/layout/header.json", json(header));
  // A story in Spanish, translating one in English.
  writeSiteFile(
    "content/collections/news/bienvenida.json",
    json({ version: 1, inLanguage: "es", translationOf: "welcome", fields: { title: "Bienvenidos" } }),
  );

  const html = await (await page.request.get("/es/sobre")).text();
  expect(html).toContain('<html lang="es">');
  // The title template has the site's name in Spanish.
  expect(html).toContain("<title>Quiénes somos | Mi sitio</title>");
  expect(html).toContain('hrefLang="en" href="https://site.example/about/"');
  expect(html).toContain('hrefLang="x-default" href="https://site.example/about/"');
  expect(await (await page.request.get("/about")).text()).toContain('<html lang="en">');

  await page.goto("/es/sobre");
  const languages = page.getByRole("navigation", { name: "Languages" });
  await expect(languages.getByRole("link", { name: "Español" })).toHaveAttribute("aria-current", "true");
  await languages.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/about$/);

  // Items in Spanish are under the language's code, and only Spanish pages list them.
  expect((await page.request.get("/es/news/bienvenida")).status()).toBe(200);
  const news = await (await page.request.get("/news")).text();
  expect(news).not.toContain("Bienvenidos");
  const feed = await (await page.request.get("/es/feeds/news.rss")).text();
  expect(feed).toContain("Bienvenidos");
  expect(feed).not.toContain("Welcome");

  // Their translations are linked too.
  const story = await (await page.request.get("/news/welcome")).text();
  expect(story).toContain('hrefLang="es" href="https://site.example/es/news/bienvenida/"');
  expect(readSiteFile("content/pages/about.json")).not.toContain("translationOf");
});

test("gives each language its own menus", async ({ page }) => {
  addSpanish();
  await page.goto("/admin#/settings/menus");
  await page.getByLabel("Language", { exact: true }).selectOption("es");
  await page.getByLabel("Español has menus of its own").check();
  await page.getByRole("tab", { name: "main" }).click();
  await page.getByLabel("Label").first().fill("Inicio");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const menus = readJson("content/menus.json") as {
    menus: Record<string, Array<{ label: string }>>;
    languages: Record<string, Record<string, Array<{ label: string }>>>;
  };
  expect(menus.languages.es?.main?.[0]?.label).toBe("Inicio");
  expect(menus.menus.main?.[0]?.label).not.toBe("Inicio");
});

test("the item editor's language menu opens an item's translations, and says which are out of date", async ({
  page,
}) => {
  addSpanish();
  writeSiteFile(
    "content/collections/news/bienvenida.json",
    json({
      version: 1,
      inLanguage: "es",
      translationOf: "welcome",
      translatedFrom: "older",
      fields: { title: "Bienvenidos" },
    }),
  );
  await page.goto("/admin#/collections/news/edit?slug=welcome");
  const language = page.locator(".gfa-header-actions").getByLabel("Language");
  await expect(language.locator("option")).toHaveText(["English", "Español (out of date)"]);
  await language.selectOption("es");
  await expect(page).toHaveURL(/slug=bienvenida$/);
  await expect(language).toHaveValue("es");
});
