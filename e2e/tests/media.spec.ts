import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { site } from "../scripts/site.mjs";
import { canvas, editor, expect, openPageEditor, publishInEditor, readSiteFile, test } from "./helpers.js";

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
