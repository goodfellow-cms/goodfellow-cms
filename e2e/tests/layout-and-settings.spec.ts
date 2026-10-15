import { canvas, expect, publishInEditor, readJson, readSiteFile, test, writeSiteFile } from "./helpers.js";

test("edits and publishes the header", async ({ page }) => {
  await page.goto("/admin#/layout/header");
  await expect(canvas(page).getByRole("link", { name: "My site" })).toBeVisible();
  // Puck covers each block with a draggable handle; clicking it selects the block.
  await canvas(page).locator('[data-puck-component="SiteBrand-header"]').click();
  await page.locator(".gfa-editor").getByRole("radio", { name: "Name only" }).check({ force: true });
  await publishInEditor(page);

  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/layout/header.json")).toContain('"show": "title"');
});

test("switches between the header and footer", async ({ page }) => {
  await page.goto("/admin#/layout/header");
  await page.locator(".gfa-tabs").getByRole("link", { name: "Footer" }).click();
  await expect(canvas(page).getByText("Built with Goodfellow.")).toBeVisible();
});

test("previews theme changes and custom CSS before publishing, then publishes them together", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  const preview = page.frameLocator(".gfa-preview iframe");
  await expect(preview.getByRole("heading", { name: "Welcome to my site" })).toBeVisible();

  await page.getByRole("textbox", { name: "Main color", exact: true }).fill("#7c2d12");
  await expect(preview.locator("main section").first()).toHaveCSS("background-color", "rgb(124, 45, 18)");

  await page.getByRole("link", { name: "Custom CSS" }).click();
  await page.getByRole("textbox", { name: "Custom CSS" }).fill(".gf-main h2 { @apply italic; }");
  await expect(preview.getByRole("heading", { name: "Everything in one place" })).toHaveCSS("font-style", "italic");

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({ theme: { colors: { primary: "#7c2d12" } } });
  expect(readSiteFile("content/styles/custom.css")).toBe(".gf-main h2 { @apply italic; }\n");
});

test("undoes and redoes changes on every tab, with typing undone as one step", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  await expect(undo).toBeDisabled();
  const color = page.getByRole("textbox", { name: "Main color", exact: true });
  const colorBefore = await color.inputValue();
  await color.fill("#7c2d12");

  await page.getByRole("link", { name: "Custom CSS" }).click();
  // The code editor, once it has loaded.
  const css = page.locator(".gfa-code-editor .cm-content");
  const cssBefore = readSiteFile("content/styles/custom.css").trimEnd();
  await css.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("h1 { color: red; }");
  await expect.poll(() => css.innerText()).toContain("color: red");
  await undo.click();
  await expect.poll(async () => (await css.innerText()).trimEnd()).toBe(cssBefore);

  await page.getByRole("link", { name: "Colors & fonts" }).click();
  await expect(color).toHaveValue("#7c2d12");
  // Outside text fields, the keyboard works too.
  await page.getByRole("heading", { name: "Site settings" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(color).toHaveValue(colorBefore);
  await expect(undo).toBeDisabled();
  await redo.click();
  await expect(color).toHaveValue("#7c2d12");

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({ theme: { colors: { primary: "#7c2d12" } } });
  expect(readSiteFile("content/styles/custom.css")).not.toContain("color: red");
});

test("chooses fonts from a searchable list of Google Fonts", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  const headings = page.getByRole("combobox", { name: "Headings" });
  await expect(headings).toHaveValue("Fraunces");
  await headings.click();
  await headings.fill("playf");
  await page
    .getByRole("option", { name: /^Playfair Display/ })
    .first()
    .click();
  await expect(headings).toHaveValue("Playfair Display");
  await expect(page.frameLocator(".gfa-preview iframe").getByRole("heading", { name: "Welcome to my site" })).toHaveCSS(
    "font-family",
    /Playfair Display/,
  );

  // The keyboard works as well.
  const text = page.getByRole("combobox", { name: "Text" });
  await text.click();
  await text.fill("Lora");
  await page.keyboard.press("Enter");
  await expect(text).toHaveValue("Lora");

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    theme: { fonts: { heading: "Playfair Display", body: "Lora" } },
  });

  // "Site default" takes a font back out.
  await headings.click();
  await page.getByRole("option", { name: /^Site default/ }).click();
  await expect(headings).toHaveValue("Site default");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({ theme: { fonts: { body: "Lora" } } });
  expect(readSiteFile("content/site.json")).not.toContain('"heading"');
});

test("edits custom CSS like a code editor: it indents, closes braces and suggests properties", async ({ page }) => {
  await page.goto("/admin#/settings/css");
  const editor = page.locator(".gfa-code-editor .cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type(".gf-main {");
  await page.keyboard.press("Enter");
  await page.keyboard.type("colo");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("color");
  // The editor takes a moment before Enter picks a suggestion, so typing quickly isn't caught by one.
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  // The suggestion brings its colon.
  await page.keyboard.type("red;");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/styles/custom.css")).toBe(".gf-main {\n  color: red;\n}\n");
});

test("adds the site's own code to every page, but never runs it in the admin panel", async ({ page }) => {
  await page.goto("/admin#/settings/code");
  const head = page.getByRole("textbox", { name: "In the page head" });
  await head.fill("<div>Not for the head</div>");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("alert")).toContainText("Fix the highlighted problems");
  await expect(page.getByText("A <div> tag can't go in the page head.")).toBeVisible();

  await head.fill('<meta name="gf-test" content="yes">\n<script>window.headRan = true;</script>');
  await page
    .getByRole("textbox", { name: "At the end of the page" })
    .fill("<script>window.bodyRan = (window.bodyRan || 0) + 1;</script>");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/code/head.html")).toBe(
    '<meta name="gf-test" content="yes">\n<script>window.headRan = true;</script>\n',
  );
  expect(readSiteFile("content/code/body.html")).toBe("<script>window.bodyRan = (window.bodyRan || 0) + 1;</script>\n");

  // The preview shows the site without its code.
  for (const frame of page.frames()) {
    expect(await frame.evaluate(() => "headRan" in window || "bodyRan" in window)).toBe(false);
  }

  await page.goto("/about");
  await expect(page.locator('head meta[name="gf-test"]')).toHaveAttribute("content", "yes");
  expect(await page.evaluate(() => (window as { headRan?: boolean }).headRan)).toBe(true);
  expect(await page.evaluate(() => (window as { bodyRan?: number }).bodyRan)).toBe(1);
});

test("won't publish invalid settings", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  const before = readSiteFile("content/site.json");
  await page.getByLabel("Site address").fill("not a web address");
  await page.getByRole("button", { name: "Publish" }).click();

  await expect(page.getByRole("alert")).toContainText("Fix the highlighted problems");
  await expect(page.getByLabel("Site address")).toHaveAttribute("aria-invalid", "true");
  expect(readSiteFile("content/site.json")).toBe(before);
});

test("saves the site's contact details, leaving out empty ones", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  await page.getByLabel("Address", { exact: true }).fill("100 Church Street\nAnytown");
  await page.getByLabel("Phone", { exact: true }).fill("(555) 010-0100");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    contact: { address: "100 Church Street\nAnytown", phone: "(555) 010-0100" },
  });
  expect(readSiteFile("content/site.json")).not.toContain('"email"');
});

test("adds a link to a menu", async ({ page }) => {
  await page.goto("/admin#/settings/menus");
  await page.getByRole("tab", { name: "main" }).click();
  await page.getByRole("button", { name: "Add link", exact: true }).click();
  await page.getByLabel("Label").last().fill("Contact");
  await page.getByLabel("Link to").last().fill("/contact");
  await expect(page.frameLocator(".gfa-preview iframe").getByRole("link", { name: "Contact" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const menus = readJson("content/menus.json") as { menus: { main: Array<{ label: string; href: string }> } };
  expect(menus.menus.main.at(-1)).toEqual({ label: "Contact", href: "/contact" });
});

test("shows a clear message when content files have problems", async ({ page }) => {
  writeSiteFile("content/pages/broken.json", "{ not json");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "The admin panel couldn't open this site" })).toBeVisible();
  await page.getByText("Details").click();
  await expect(page.getByText(/content\/pages\/broken\.json: isn't valid JSON/)).toBeVisible();
});

test("isn't reachable from other websites", async ({ request }) => {
  expect((await request.get("/__goodfellow/api/revision")).status()).toBe(403);
  const crossSite = await request.get("/__goodfellow/api/revision", {
    headers: { "x-goodfellow-request": "1", origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);
  const outside = await request.get("/__goodfellow/api/file?path=goodfellow.config.tsx", {
    headers: { "x-goodfellow-request": "1" },
  });
  expect(outside.status()).toBe(400);
});

test("shows the admin panel light or dark, following the computer unless an editor chooses", async ({ page }) => {
  const background = () => page.locator(".gfa-app").evaluate((app) => getComputedStyle(app).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin#/pages");
  await expect.poll(background).toBe("rgb(248, 250, 252)");

  const menu = page.getByRole("combobox", { name: "Colors of the admin panel" });
  await menu.selectOption({ label: "Dark" });
  await expect.poll(background).toBe("rgb(11, 17, 32)");
  // Puck's own colors follow.
  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/about")}`);
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  const sidebar = page.locator('[class*="_Sidebar--right_"]');
  await expect.poll(() => sidebar.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(17, 24, 39)");

  // Remembered in this browser.
  await page.reload();
  await expect(menu).toHaveValue("dark");
  await expect.poll(background).toBe("rgb(11, 17, 32)");

  await menu.selectOption({ label: "Match my computer" });
  await expect.poll(background).toBe("rgb(248, 250, 252)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe("rgb(11, 17, 32)");
});

test("shows the site's icon in the admin panel's tab, and a new one once it's published", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  const icon = page.locator('head link[rel~="icon"]');
  await expect(icon).toHaveAttribute("href", /\/media\/favicon\.svg$/);

  await page.getByLabel("Browser tab icon").fill("/media/logo.svg");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  await expect(icon).toHaveAttribute("href", /\/media\/logo\.svg$/);
});

test("says Published under the Publish button, until something changes or a few seconds pass", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  const publishButton = page.getByRole("button", { name: "Publish" });
  const published = page.getByRole("status").filter({ hasText: "Published." });

  await page.getByLabel("Site name").fill("St. Joseph Parish");
  await publishButton.click();
  await expect(published).toBeVisible();
  // Just under the button, at its right-hand edge.
  const button = await publishButton.boundingBox();
  const notice = await published.boundingBox();
  expect(notice && button && Math.abs(notice.x + notice.width - (button.x + button.width))).toBeLessThan(2);
  expect(notice && button && notice.y - (button.y + button.height)).toBeLessThan(16);

  // Any change hides it.
  await page.getByLabel("Site name").fill("St. Joseph's Parish");
  await expect(published).toBeHidden();

  // Otherwise it goes on its own.
  await publishButton.click();
  await expect(published).toBeVisible();
  await expect(published).toBeHidden({ timeout: 8_000 });
});

test("gives the site a dark mode only once it's turned on, with its own colors and logo", async ({ page }) => {
  // Light only by default, even on a computer set to dark.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveCount(0);

  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/admin#/settings/theme");
  const preview = page.frameLocator(".gfa-preview iframe");
  await expect(preview.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("checkbox", { name: "Follow each visitor's light or dark setting" }).check();
  // The preview is like the admin panel, light here, until Dark is chosen.
  await expect(preview.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(preview.locator("body")).toHaveCSS("background-color", "rgb(10, 10, 10)");
  const dark = page.getByRole("group", { name: "Colors in dark mode" });
  await dark.getByRole("textbox", { name: "Background", exact: true }).fill("#1e1b4b");
  await expect(preview.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await page.getByRole("radio", { name: "Light" }).check();
  await expect(preview.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");

  await page.getByRole("link", { name: "General" }).click();
  await expect(page.getByText("Logo in dark mode")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    theme: { darkMode: true, darkColors: { background: "#1e1b4b" } },
  });

  // Pages follow the visitor's setting.
  await page.goto("/");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "light dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
});

const darkModeSwitch = (display: "switch" | "menu") => ({
  type: "DarkModeSwitch",
  props: {
    id: "DarkModeSwitch-test",
    display,
    labels: "show",
    label: "Dark mode",
    lightLabel: "Light",
    darkLabel: "Dark",
    systemLabel: "Follow my computer",
    className: "",
  },
});

function withDarkModeSwitch(display: "switch" | "menu") {
  const settings = readJson("content/site.json") as { theme: Record<string, unknown> };
  settings.theme = { ...settings.theme, darkMode: true, darkColors: { background: "#1e1b4b" } };
  writeSiteFile("content/site.json", `${JSON.stringify(settings, null, 2)}\n`);
  const header = readJson("content/layout/header.json") as { data: { content: unknown[] } };
  header.data.content.push(darkModeSwitch(display));
  writeSiteFile("content/layout/header.json", `${JSON.stringify(header, null, 2)}\n`);
}

test("keeps a visitor's choice from the Dark mode switch on every page, before they show", async ({ page }) => {
  withDarkModeSwitch("switch");
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Dark mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");

  // The next page is dark from the start, whatever the computer's setting.
  await page.goto("/about");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-gf-color-scheme"))).toBe("dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await expect(page.getByRole("switch", { name: "Dark mode" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("lets visitors go back to following their computer with the Dark mode menu", async ({ page }) => {
  withDarkModeSwitch("menu");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const menu = page.getByRole("combobox", { name: "Dark mode" });
  await expect(menu).toHaveValue("system");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  await menu.selectOption("light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Dark mode" })).toHaveValue("light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.getByRole("combobox", { name: "Dark mode" }).selectOption("system");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(30, 27, 75)");
  expect(await page.evaluate(() => localStorage.getItem("goodfellow.colorScheme"))).toBeNull();
});

test("chooses the colors code is shown in", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  await page.getByRole("combobox", { name: "Light colors" }).selectOption("everforest-light");
  await page.getByRole("combobox", { name: "Dark colors" }).selectOption("everforest-dark");
  await page.getByRole("checkbox", { name: "Show code on the subtle background color" }).check();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    theme: { code: { light: "everforest-light", dark: "everforest-dark", background: "site" } },
  });
});
