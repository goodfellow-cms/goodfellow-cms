import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect as baseExpect } from "@playwright/test";
import { nextSite, resetNextContent } from "../scripts/site.mjs";
import { editor, expectSandboxed } from "./helpers.js";

// The Next.js template under `next dev`: see playwright.config.ts.
const BASE = "http://localhost:4403";

// `next dev` compiles each page the first time it's opened, which can take most of a minute on CI.
const expect = baseExpect.configure({ timeout: 60_000 });

base.describe.configure({ timeout: 150_000 });

const test = base.extend({
  page: async ({ page }, use) => {
    resetNextContent();
    await use(page);
  },
});

test("serves the site's pages, header and footer with Next.js", async ({ page }) => {
  await page.goto(`${BASE}/about/`);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  await expect(page.locator("header nav").getByRole("link", { name: "News" })).toBeVisible();
  await expect(page).toHaveTitle("About us | My site");
  // Styled by the site's Tailwind build and theme.
  const background = await page
    .locator("footer section")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(background).not.toBe("rgba(0, 0, 0, 0)");

  await page.goto(`${BASE}/news/welcome/`);
  await expect(page).toHaveTitle("Welcome to our new website | My site");
});

test("follows the visitor's light or dark setting once the site has dark mode", async ({ page }) => {
  const settingsFile = join(nextSite, "content/site.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.theme = { ...settings.theme, darkMode: true, darkColors: { background: "#1e1b4b" } };
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/about/`);
  await expect(page.locator('head meta[name="color-scheme"]')).toHaveAttribute("content", "light dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("keeps a visitor's choice from the Dark mode switch between pages", async ({ page }) => {
  const settingsFile = join(nextSite, "content/site.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.theme = { ...settings.theme, darkMode: true, darkColors: { background: "#1e1b4b" } };
  writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
  const headerFile = join(nextSite, "content/layout/header.json");
  const header = JSON.parse(readFileSync(headerFile, "utf8"));
  header.data.content.push({
    type: "DarkModeSwitch",
    props: {
      id: "DarkModeSwitch-test",
      display: "switch",
      labels: "hide",
      label: "Dark mode",
      lightLabel: "Light",
      darkLabel: "Dark",
      systemLabel: "Follow my computer",
      className: "",
    },
  });
  writeFileSync(headerFile, `${JSON.stringify(header, null, 2)}\n`);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) problems.push(message.text());
  });

  await page.goto(`${BASE}/about/`);
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await page.goto(`${BASE}/news/`);
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
  expect(problems).toEqual([]);
});

test("shows the site's own page for addresses that don't exist", async ({ page }) => {
  const response = await page.goto(`${BASE}/no-such-page/`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("sends visitors on from a redirect's old address", async ({ page }) => {
  writeFileSync(
    join(nextSite, "content/redirects.json"),
    `${JSON.stringify({ version: 1, redirects: [{ from: "/who-we-are", to: "/about" }] }, null, 2)}\n`,
  );
  await page.goto(`${BASE}/who-we-are`);
  await expect(page).toHaveURL(/\/about\/?$/);
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
});

test("publishes from the admin panel to the files on disk", async ({ page }) => {
  await page.goto(`${BASE}/admin/#/settings/general`);
  await expect(page.locator('head link[rel~="icon"]').first()).toHaveAttribute("href", /\/media\/favicon\.svg/);
  await page.getByLabel("Site name").fill("Next site");
  await expect(page.frameLocator(".gfa-preview iframe").getByText("Next site").first()).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const settings = JSON.parse(readFileSync(join(nextSite, "content/site.json"), "utf8")) as { title: string };
  expect(settings.title).toBe("Next site");
  await page.goto(`${BASE}/about/`);
  await expect(page.locator("header").getByText("Next site")).toBeVisible();
});

test("edits a page in Puck with the site's styles", async ({ page }) => {
  await page.goto(`${BASE}/admin/#/pages/edit?path=${encodeURIComponent("/about")}`);
  const canvas = editor(page).locator(".gf-canvas").first();
  await expect(canvas.getByRole("heading", { name: "About us" })).toBeVisible();
  const heading = canvas.getByRole("heading", { name: "About us" });
  await expect.poll(() => heading.evaluate((el: Element) => getComputedStyle(el).fontWeight)).toBe("700");
});

test("runs the site's blocks in a sandbox in next dev too, from a bundle of their own", async ({ page }) => {
  await page.goto(`${BASE}/admin/#/pages/edit?path=${encodeURIComponent("/about")}`);
  await expect(editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" })).toBeVisible();
  await expect(page.locator("iframe.gfa-editor-frame")).toHaveAttribute("src", "/__goodfellow/api/editor/");
  await expectSandboxed(page);
});

test("says how to update an admin page from before the editor's sandbox, and never signs in there", async ({
  page,
}) => {
  const file = join(nextSite, "app/admin/page.tsx");
  const current = readFileSync(file, "utf8");
  const old = `"use client";

import { GoodfellowAdmin } from "@goodfellow-cms/next/admin";
import config from "@/goodfellow.config";

export default function AdminPage() {
  return <GoodfellowAdmin config={config} />;
}
`;
  writeFileSync(file, old);
  try {
    await page.goto(`${BASE}/admin/`);
    await expect(page.getByRole("heading", { name: "This site's admin page needs updating" })).toBeVisible();
    await page.getByText("Details", { exact: true }).click();
    await expect(page.getByText("npx goodfellow-next update")).toBeVisible();
    await expect(page.locator("pre").first()).toContainText("site.admin()");
    await expect(page.locator("iframe")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
  } finally {
    writeFileSync(file, current);
  }
});

test("runs a block's Client Component in the browser, with the site's data and next/link", async ({ page }) => {
  const counterPage = {
    version: 1,
    data: {
      content: [{ type: "Counter", props: { id: "Counter-1", className: "", label: "Clicked" } }],
      root: { props: { className: "", description: "", image: "", title: "Counter" } },
    },
  };
  writeFileSync(join(nextSite, "content/pages/counter.json"), `${JSON.stringify(counterPage, null, 2)}\n`);

  await page.goto(`${BASE}/counter/`);
  await expect(page.getByText("My site at /counter")).toBeVisible();
  await page.getByRole("button", { name: "Clicked 0 times" }).click();
  await expect(page.getByRole("button", { name: "Clicked 1 times" })).toBeVisible();

  // next/link moves to the page without reloading the browser's page.
  await page.evaluate(() => {
    (window as { notReloaded?: boolean }).notReloaded = true;
  });
  await page.getByRole("link", { name: "About this site" }).click();
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/about/");
  expect(await page.evaluate(() => (window as { notReloaded?: boolean }).notReloaded)).toBe(true);
});

test("adds the site's own code to every page once, kept when moving between pages", async ({ page }) => {
  mkdirSync(join(nextSite, "content/code"), { recursive: true });
  writeFileSync(
    join(nextSite, "content/code/head.html"),
    '<meta name="gf-test" content="yes">\n<script>window.headRan = (window.headRan || 0) + 1;</script>\n',
  );
  writeFileSync(
    join(nextSite, "content/code/body.html"),
    "<script>window.bodyRan = (window.bodyRan || 0) + 1;</script>\n",
  );

  await page.goto(`${BASE}/`);
  await expect(page.locator('head meta[name="gf-test"]')).toHaveAttribute("content", "yes");
  await expect.poll(() => page.evaluate(() => (window as { headRan?: number }).headRan)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);

  await page.locator("header nav").getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => (window as { headRan?: number }).headRan)).toBe(1);
  expect(await page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);
});

test("loads what a site that asks held back once, for a visitor who agreed before, without upsetting React", async ({
  page,
}) => {
  const settingsFile = join(nextSite, "content/site.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  writeFileSync(settingsFile, `${JSON.stringify({ ...settings, consent: {} }, null, 2)}\n`);
  writeFileSync(
    join(nextSite, "content/pages/watch.json"),
    `${JSON.stringify(
      {
        version: 1,
        data: {
          root: { props: { title: "Watch" } },
          content: [
            { type: "Video", props: { id: "Video-1", source: "youtube", youtube: "https://youtu.be/dQw4w9WgXcQ" } },
          ],
        },
      },
      null,
      2,
    )}\n`,
  );
  mkdirSync(join(nextSite, "content/code"), { recursive: true });
  writeFileSync(
    join(nextSite, "content/code/head.html"),
    "<script>window.headRan = (window.headRan || 0) + 1;</script>\n",
  );
  writeFileSync(
    join(nextSite, "content/code/body.html"),
    '<p id="widget">Widget</p><script>window.bodyRan = (window.bodyRan || 0) + 1;</script>\n',
  );
  const loaded: string[] = [];
  await page.route("https://www.youtube-nocookie.com/**", (route) => {
    loaded.push(route.request().url());
    return route.fulfill({ contentType: "text/html", body: "<p>Player</p>" });
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      "goodfellow-consent",
      JSON.stringify({ yes: ["content"], asked: ["content"], at: Date.now() }),
    ),
  );

  await page.goto(`${BASE}/watch/`);
  await expect(page.locator("iframe[title='Video']")).toHaveAttribute("src", /youtube-nocookie/);
  await expect(page.getByText("Widget")).toBeVisible();
  await expect(page.locator("[data-gf-consent-placeholder]")).toBeHidden();
  await expect(page.getByRole("dialog")).toBeHidden();
  // Give React time to take over the page, which would draw it again, and load it all again, if it disagreed.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => (window as { headRan?: number }).headRan)).toBe(1);
  expect(await page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);
  await expect(page.locator("#widget")).toHaveCount(1);
  expect(loaded).toHaveLength(1);
  expect(errors.filter((text) => /hydrat|#418|#425|didn't match/i.test(text))).toEqual([]);
});

test("shows the header and footer in each page's language, as visitors move between languages", async ({ page }) => {
  const write = (path: string, value: unknown) => {
    mkdirSync(join(nextSite, path, ".."), { recursive: true });
    writeFileSync(join(nextSite, path), `${JSON.stringify(value, null, 2)}\n`);
  };
  const read = (path: string) => JSON.parse(readFileSync(join(nextSite, path), "utf8"));
  write("content/site.json", {
    ...read("content/site.json"),
    languages: [{ code: "es", name: "Español" }],
    translations: { es: { title: "Mi sitio" } },
  });
  const about = read("content/pages/about.json");
  write("content/pages/es/sobre.json", {
    ...about,
    translationOf: "/about",
    data: { ...about.data, root: { props: { ...about.data.root.props, title: "Quiénes somos" } } },
  });
  const header = read("content/layout/header.json");
  header.data.content.push({
    type: "LanguageSwitch",
    props: { id: "LanguageSwitch-test", display: "links", label: "Languages", className: "" },
  });
  write("content/layout/header.json", header);
  // Spanish's own footer, for the words typed into it.
  write(
    "content/layout/footer.es.json",
    JSON.parse(
      JSON.stringify(read("content/layout/footer.json")).replace("Built with Goodfellow", "Hecho con Goodfellow"),
    ),
  );

  await page.goto(`${BASE}/about/`);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const languages = page.getByRole("navigation", { name: "Languages" });
  await expect(languages.getByRole("link", { name: "English" })).toHaveAttribute("aria-current", "true");
  await expect(page.locator("footer")).toContainText("Built with Goodfellow");

  // Moving to the translation without loading a new page: the layout follows.
  await languages.getByRole("link", { name: "Español" }).click();
  await expect(page.getByRole("heading", { name: "About us", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/es\/sobre\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator("footer")).toContainText("Hecho con Goodfellow");
  await expect(page.locator("header")).toContainText("Mi sitio");
  await expect(languages.getByRole("link", { name: "Español" })).toHaveAttribute("aria-current", "true");
  await expect(languages.getByRole("link", { name: "English" })).toHaveAttribute("href", "/about/");

  // Loaded on its own, a Spanish page is Spanish from the start.
  const html = await (await page.request.get(`${BASE}/es/sobre/`)).text();
  // The page's data carries every language's footer, for moving between them; the HTML shows Spanish's.
  const footer = /<footer[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "";
  expect(footer).toContain("Hecho con Goodfellow");
  expect(footer).not.toContain("Built with Goodfellow");
});
