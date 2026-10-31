import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../scripts/site.mjs";
import { expect, readJson, test } from "./helpers.js";

/** A WOFF2 font Google Fonts serves under the SIL Open Font License (core's `test/fonts/`). */
const FONT = join(dirname(fileURLToPath(import.meta.url)), "../../packages/core/test/fonts/inter-sample.woff2");

test("adds a font of the owner's own, uses it for headings, and removes it", async ({ page }) => {
  await page.goto("/admin#/settings/theme");
  await page.getByRole("button", { name: "Add a font" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a font" });

  // Only WOFF2 fonts can be added.
  await dialog.getByLabel("Font files (WOFF2)").setInputFiles({
    name: "Brandon-Regular.woff2",
    mimeType: "font/woff2",
    buffer: Buffer.from("<script>alert(1)</script>".padEnd(100)),
  });
  await expect(dialog.getByRole("alert")).toContainText("Brandon-Regular.woff2 isn't a WOFF2 font.");

  await dialog.getByLabel("Font files (WOFF2)").setInputFiles({
    name: "Brandon-Regular.woff2",
    mimeType: "font/woff2",
    buffer: readFileSync(FONT),
  });
  // Its name and weight are guessed from the file's name.
  await expect(dialog.getByLabel("Font's name")).toHaveValue("Brandon");
  await expect(dialog.getByLabel("Weight: Brandon-Regular.woff2")).toHaveValue("400");
  await dialog.getByRole("button", { name: "Add font" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Tick the box");
  // The license's info bubble links to the documentation, in a new tab.
  await expect(dialog.getByRole("link", { name: "About fonts' licenses" })).toHaveAttribute(
    "href",
    /\/docs\/layout-and-settings\/#your-own-fonts$/,
  );
  await dialog.getByLabel("I'm allowed to use this font on a website").check();
  await dialog.getByRole("button", { name: "Add font" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "Brandon" })).toContainText("Files: 1");

  // The font menus offer it first.
  const headings = page.getByRole("combobox", { name: "Headings" });
  await headings.click();
  await headings.fill("bran");
  await page.getByRole("option", { name: /^Brandon/ }).click();
  await expect(headings).toHaveValue("Brandon");

  // The preview shows it from its bytes, since its frame can't load the site's files.
  const preview = await page.locator(".gfa-preview iframe").elementHandle();
  const frame = await preview?.contentFrame();
  await expect
    .poll(() =>
      frame?.evaluate(() => [...document.fonts].some((font) => font.family === "Brandon" && font.status === "loaded")),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/site.json")).toMatchObject({
    theme: {
      fonts: {
        heading: "Brandon",
        custom: [
          {
            family: "Brandon",
            category: "sans-serif",
            files: [{ src: "/media/fonts/brandon-400.woff2", weight: 400 }],
          },
        ],
      },
    },
  });
  expect(existsSync(join(site as string, "public/media/fonts/brandon-400.woff2"))).toBe(true);

  // Pages load it from the site, preloading the headings' file.
  const html = await (await page.request.get("/")).text();
  expect(html).toContain('@font-face{font-family:"Brandon";src:url("/media/fonts/brandon-400.woff2") format("woff2")');
  expect(html).toContain('<link rel="preload" href="/media/fonts/brandon-400.woff2" as="font" type="font/woff2"');
  expect(html).not.toContain("family=Brandon");

  // The media library leaves fonts to this tab.
  await page.goto("/admin#/media");
  await expect(page.getByText("brandon-400.woff2")).toHaveCount(0);

  // Removing it takes its file out, and headings go back to the site default.
  await page.goto("/admin#/settings/theme");
  await page.getByRole("button", { name: "Remove Brandon" }).click();
  await expect(headings).toHaveValue("Site default");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(JSON.stringify(readJson("content/site.json"))).not.toContain("Brandon");
  expect(existsSync(join(site as string, "public/media/fonts/brandon-400.woff2"))).toBe(false);
});
