import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { site } from "../scripts/site.mjs";
import {
  canvas,
  editor,
  expect,
  openPageEditor,
  publishInEditor,
  readSiteFile,
  test,
  writeSiteFile,
} from "./helpers.js";

/** Draws an image in the browser, so tests have real photos to upload. */
async function makeImage(page: Page, width: number, height: number, type = "image/jpeg"): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ width, height, type }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#1e3a8a";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "#f59e0b";
        context.fillRect(width / 4, height / 4, width / 2, height / 2);
      }
      return canvas.toDataURL(type, 0.95);
    },
    { width, height, type },
  );
  return Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
}

/** The size an image on the site really is, measured in the browser. */
async function imageSize(page: Page, url: string): Promise<[number, number]> {
  return page.evaluate(
    (url) =>
      new Promise<[number, number]>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
        image.onerror = reject;
        image.src = url;
      }),
    url,
  );
}

const uploadInput = (page: Page) => page.locator('input[type="file"][aria-label="Upload files"]').first();

test("uploads photos and documents, making large photos web-sized", async ({ page }) => {
  await page.goto("/admin#/media");
  const photo = await makeImage(page, 4000, 3000);
  await uploadInput(page).setInputFiles([
    { name: "Easter Vigil.JPG", mimeType: "image/jpeg", buffer: photo },
    { name: "bulletin.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
  ]);
  await expect(page.getByText("Uploaded.", { exact: false })).toBeVisible();
  await expect(page.locator(".gfa-media-name", { hasText: "easter-vigil.jpg" })).toBeVisible();
  await expect(page.locator(".gfa-media-card", { hasText: "bulletin.pdf" })).toContainText("PDF");

  expect(existsSync(join(site, "public/media/bulletin.pdf"))).toBe(true);
  // The development server can take a moment to start serving a new file.
  await expect.poll(() => imageSize(page, "/media/easter-vigil.jpg").catch(() => null)).toEqual([2400, 1800]);
});

test("refuses files the site can't use", async ({ page }) => {
  await page.goto("/admin#/media");
  await uploadInput(page).setInputFiles({ name: "page.html", mimeType: "text/html", buffer: Buffer.from("<p>hi</p>") });
  await expect(page.getByRole("alert")).toContainText("page.html can't be uploaded.");
  expect(existsSync(join(site, "public/media/page.html"))).toBe(false);
});

test("removes anything that could run code from SVG images", async ({ page }) => {
  await page.goto("/admin#/media");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" fill="red"/></svg>';
  await uploadInput(page).setInputFiles({ name: "badge.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.locator(".gfa-media-name", { hasText: "badge.svg" })).toBeVisible();
  const saved = readSiteFile("public/media/badge.svg");
  expect(saved).toContain("<rect");
  expect(saved).not.toMatch(/script|onload/i);
});

test("chooses an image for a block, uploading a new one from the editor", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await canvas(page).locator('[data-puck-component="Image-about"]').click();
  await editor(page).getByRole("button", { name: "Choose image" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose an image" });
  await expect(dialog.getByRole("button", { name: /logo\.svg/ })).toBeVisible();

  const photo = await makeImage(page, 800, 600, "image/png");
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: "Our Church.png", mimeType: "image/png", buffer: photo });
  await expect(dialog).toBeHidden();
  await expect(editor(page).locator('input[name="src"]:visible').first()).toHaveValue("/media/our-church.png");
  // Shown from memory straight away, before the site has the file.
  const shown = canvas(page).locator('img[data-gf-src="/media/our-church.png"]');
  await expect(shown).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => shown.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(800);

  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readSiteFile("content/pages/about.json")).toContain('"src": "/media/our-church.png"');
});

test("picks an existing image for the site's logo", async ({ page }) => {
  await page.goto("/admin#/settings/general");
  await page.getByRole("button", { name: "Choose image" }).first().click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /placeholder\.svg/ })
    .click();
  await expect(page.getByLabel("Logo", { exact: true })).toHaveValue("/media/placeholder.svg");
});

test("says where a file is used, and keeps it while it is", async ({ page }) => {
  await page.goto("/admin#/media");
  await page.locator(".gfa-media-card", { hasText: "placeholder.svg" }).getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: /Delete/ });
  await expect(dialog).toContainText("It's used in: About us, Welcome to our new website.");
  await dialog.getByRole("button", { name: "Delete" }).click();
  const checks = page.getByRole("dialog", { name: "This can't be published yet" });
  await expect(checks).toContainText("/media/placeholder.svg, which isn't in the media library");
  await checks.getByRole("button", { name: "Go back" }).click();
  await expect(checks).toHaveCount(0);
  expect(existsSync(join(site, "public/media/placeholder.svg"))).toBe(true);
});

test("deletes a file nothing uses", async ({ page }) => {
  await page.goto("/admin#/media");
  await uploadInput(page).setInputFiles([
    { name: "bulletin.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") },
  ]);
  await expect(page.getByText("Uploaded.", { exact: false })).toBeVisible();
  await page.locator(".gfa-media-card", { hasText: "bulletin.pdf" }).getByRole("button", { name: "Delete" }).click();
  const dialog = page.getByRole("dialog", { name: /Delete/ });
  await expect(dialog).toContainText("Nothing on the site uses it.");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".gfa-media-name", { hasText: "bulletin.pdf" })).toHaveCount(0);
  expect(existsSync(join(site, "public/media/bulletin.pdf"))).toBe(false);
});

test("replaces a file, keeping its address", async ({ page }) => {
  await page.goto("/admin#/media");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>';
  await page
    .locator(".gfa-media-card", { hasText: "logo.svg" })
    .locator('input[type="file"]')
    .setInputFiles({ name: "new-logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.locator(".gfa-screen > .gfa-notice, .gfa-screen > [role=alert]").first()).toContainText(
    "Uploaded.",
  );
  expect(readSiteFile("public/media/logo.svg")).toContain("<circle");
  expect(existsSync(join(site, "public/media/new-logo.svg"))).toBe(false);
});

test("won't replace a file with another kind of file, which would be saved under its name", async ({ page }) => {
  await page.goto("/admin#/media");
  const before = readSiteFile("public/media/logo.svg");
  const input = page.locator(".gfa-media-card", { hasText: "logo.svg" }).locator('input[type="file"]');
  await expect(input).toHaveAttribute("accept", ".svg");
  // An SVG with a script, chosen as a text file: replacing logo.svg with it would make it the site's logo.
  await input.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  });
  await expect(page.getByRole("alert").first()).toContainText("notes.txt is a different kind of file from logo.svg");
  expect(readSiteFile("public/media/logo.svg")).toBe(before);
});

test("describes an image once, for every block that leaves its description empty", async ({ page }) => {
  writeSiteFile(
    "content/pages/about.json",
    readSiteFile("content/pages/about.json").replace(
      '"alt": "A placeholder picture, to replace with a photo of your own"',
      '"alt": ""',
    ),
  );
  await page.goto("/admin#/media");
  const card = page.locator(".gfa-media-card", { hasText: "placeholder.svg" });
  await expect(card).toContainText("No description yet");
  await card.getByRole("button", { name: "Details" }).click();
  const dialog = page.getByRole("dialog", { name: "Details of placeholder.svg" });
  await dialog.getByLabel("Description").fill("A hillside in the sun");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText("A hillside in the sun");
  expect(JSON.parse(readSiteFile("content/media.json")).descriptions).toEqual({
    "/media/placeholder.svg": { text: "A hillside in the sun" },
  });

  // Found by what it shows, too.
  await page.getByLabel("Find a file").fill("hillside");
  await expect(page.locator(".gfa-media-name")).toHaveText(["placeholder.svg"]);

  await page.goto("/about");
  await expect(page.locator('main img[src="/media/placeholder.svg"]')).toHaveAttribute("alt", "A hillside in the sun");
});

test("deletes several files at once", async ({ page }) => {
  await page.goto("/admin#/media");
  const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
  await uploadInput(page).setInputFiles([
    { name: "bulletin.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "rota.pdf", mimeType: "application/pdf", buffer: pdf },
  ]);
  await expect(page.getByText("Uploaded.", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Select files" }).click();
  await page.getByLabel("Select bulletin.pdf").check();
  await page.getByLabel("Select rota.pdf").check();
  await page.getByRole("button", { name: "Delete selected (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete 2 files?" });
  await expect(dialog).toContainText("Nothing on the site uses them.");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".gfa-media-name", { hasText: /bulletin|rota/ })).toHaveCount(0);
  expect(existsSync(join(site, "public/media/bulletin.pdf"))).toBe(false);
  expect(existsSync(join(site, "public/media/rota.pdf"))).toBe(false);
  // Choosing ends with the delete.
  await expect(page.getByRole("button", { name: "Select files" })).toBeVisible();
});

test("keeps an image's focal point in view, and tags files to find them by", async ({ page }) => {
  await page.goto("/admin#/media");
  const card = page.locator(".gfa-media-card", { hasText: "placeholder.svg" });
  await card.getByRole("button", { name: "Details" }).click();
  const dialog = page.getByRole("dialog", { name: "Details of placeholder.svg" });
  // Clicking a quarter of the way across and three quarters down.
  const picture = dialog.getByRole("button", { name: "placeholder.svg: choose its focal point" });
  const shownPicture = picture.locator("img");
  await expect.poll(() => shownPicture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const size = await shownPicture.evaluate((image) => ({ width: image.clientWidth, height: image.clientHeight }));
  await shownPicture.click({ position: { x: size.width * 0.25, y: size.height * 0.75 } });
  await expect(dialog).toContainText(/2[45](\.\d)?% · 7[45](\.\d)?%/);
  const tags = dialog.getByLabel("Tags");
  await tags.fill("Events");
  await tags.press("Enter");
  await tags.fill("Parish life,");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(dialog).toBeHidden();
  const media = JSON.parse(readSiteFile("content/media.json"));
  expect(media.focus["/media/placeholder.svg"].x).toBeCloseTo(25, 0);
  expect(media.focus["/media/placeholder.svg"].y).toBeCloseTo(75, 0);
  expect(media.tags).toEqual({ "/media/placeholder.svg": ["Events", "Parish life"] });

  // The Media screen shows only the files with a tag.
  await expect(card).toContainText("Events · Parish life");
  await page.getByRole("group", { name: "Show files tagged" }).getByRole("button", { name: "Events" }).click();
  await expect(page.locator(".gfa-media-name")).toHaveText(["placeholder.svg"]);

  // Pages cut the image around its focal point.
  await page.goto("/about");
  const shown = page.locator('main img[src="/media/placeholder.svg"]');
  await expect(shown).toHaveAttribute("style", /object-position: ?2[45](\.\d)?% 7[45](\.\d)?%/);
});

test("tags several files at once", async ({ page }) => {
  await page.goto("/admin#/media");
  await page.getByRole("button", { name: "Select files" }).click();
  await page.getByLabel("Select logo.svg").check();
  await page.getByLabel("Select placeholder.svg").check();
  await page.getByRole("button", { name: "Tag selected (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Tag 2 files" });
  await dialog.getByLabel("Add these tags").fill("Brand");
  await dialog.getByLabel("Add these tags").press("Enter");
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(dialog).toBeHidden();
  expect(JSON.parse(readSiteFile("content/media.json")).tags).toEqual({
    "/media/logo.svg": ["Brand"],
    "/media/placeholder.svg": ["Brand"],
  });
});

test("crops and turns a photo, saving it as a new image", async ({ page }) => {
  await page.goto("/admin#/media");
  const photo = await makeImage(page, 800, 600);
  await uploadInput(page).setInputFiles({ name: "hall.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("Uploaded.", { exact: false })).toBeVisible();

  await page.locator(".gfa-media-card", { hasText: "hall.jpg" }).getByRole("button", { name: "Details" }).click();
  await page.getByRole("dialog", { name: "Details of hall.jpg" }).getByRole("button", { name: "Crop or turn" }).click();
  const dialog = page.getByRole("dialog", { name: "Crop or turn hall.jpg" });
  await dialog.getByLabel("Shape").selectOption("square");
  await expect(dialog).toContainText("600 × 600 pixels");
  await dialog.getByRole("button", { name: "Turn right" }).click();
  await expect(dialog).toContainText("600 × 600 pixels");
  await dialog.getByRole("button", { name: "Save as a new image" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Saved hall-cropped.jpg.")).toBeVisible();
  expect(existsSync(join(site, "public/media/hall-cropped.jpg"))).toBe(true);
  expect(existsSync(join(site, "public/media/hall.jpg"))).toBe(true);
  await expect.poll(() => imageSize(page, "/media/hall-cropped.jpg").catch(() => null)).toEqual([600, 600]);
});
