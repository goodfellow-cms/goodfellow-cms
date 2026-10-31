import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { site } from "../scripts/site.mjs";
import { expect, readJson, test } from "./helpers";

/**
 * Media kept by a plugin outside the site's own files, through the Keeper
 * plugin (`e2e/fixtures/plugins/keeper`), whose storage at
 * `https://storage.example` the test answers. Its task signs each request
 * with `KEEPER_KEY`, which `goodfellow dev` has and the browser never sees,
 * as a site's CI would.
 */
const inSite = (path: string) => existsSync(join(site as string, path));

test("keeps media in a plugin's storage, and moves the site's own media there and back", async ({ page }) => {
  const stored = new Map<string, { body: Buffer; type: string }>();
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, PUT, DELETE",
    "access-control-allow-headers": "*",
  };
  await page.route("https://storage.example/**", async (route) => {
    const request = route.request();
    const key = new URL(request.url()).pathname.slice(1);
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const signature = createHmac("sha256", "secret")
      .update(`${request.method()} ${key.slice("media/".length)}`)
      .digest("hex");
    if (request.method() !== "GET" && request.headers()["x-keeper-signature"] !== signature) {
      return route.fulfill({ status: 403, headers: cors });
    }
    if (request.method() === "PUT") {
      stored.set(key, {
        body: request.postDataBuffer() ?? Buffer.alloc(0),
        type: request.headers()["content-type"] ?? "",
      });
      return route.fulfill({ status: 200, headers: cors });
    }
    if (request.method() === "DELETE") {
      stored.delete(key);
      return route.fulfill({ status: 204, headers: cors });
    }
    const file = stored.get(key);
    return file
      ? route.fulfill({ status: 200, headers: { ...cors, "content-type": file.type }, body: file.body })
      : route.fulfill({ status: 404, headers: cors });
  });

  // The plugin's screen starts keeping the site's media.
  await page.goto("/admin#/settings/general");
  await page.getByRole("link", { name: "Keeper" }).click();
  const screen = page.frameLocator('iframe[title="Keeper"]');
  await screen.getByRole("button", { name: "Keep the site's media here" }).click();
  await expect(screen.getByRole("status")).toHaveText("Keeping media", { timeout: 15_000 });
  expect(readJson("content/media-storage.json")).toEqual({
    version: 1,
    plugin: "goodfellow-plugin-keeper",
    url: "https://storage.example/media",
    files: {},
  });

  // What the plugin's task refuses, it says why, from the task's sealed answer.
  await page.goto("/admin#/media");
  const upload = page.getByLabel("Upload files", { exact: true });
  await upload.setInputFiles({ name: "Refused.mp4", mimeType: "video/mp4", buffer: Buffer.from("video") });
  await expect(page.getByText("Keeper couldn't keep refused.mp4.")).toBeVisible({ timeout: 15_000 });
  // The upload problem's own Details, not a file's Details button.
  await page.locator("summary").getByText("Details", { exact: true }).click();
  await expect(page.getByText("Keeper won't keep /media/refused.mp4.")).toBeVisible();

  // Uploads are signed by the plugin's task, go to the storage, and the site lists them.
  await upload.setInputFiles({ name: "Sermon.mp4", mimeType: "video/mp4", buffer: Buffer.from("video") });
  await expect(page.getByText("Uploading to Keeper… This takes about a minute.")).toBeVisible();
  await expect(page.getByText("Uploaded.")).toBeVisible({ timeout: 15_000 });
  expect(stored.get("media/sermon.mp4")?.body.toString()).toBe("video");
  expect((readJson("content/media-storage.json").files as Record<string, unknown>)["/media/sermon.mp4"]).toEqual({
    size: 5,
  });
  expect(inSite("public/media/sermon.mp4")).toBe(false);
  await expect(page.locator(".gfa-media-card", { hasText: "sermon.mp4" })).toContainText(
    "Kept by goodfellow-plugin-keeper",
  );

  // The starter's own files move to the storage, at the same addresses.
  await page.getByRole("button", { name: "Move 3 files to Keeper" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move 3 files to Keeper" }).click();
  await expect(page.getByText("Moved 3 files to Keeper.")).toBeVisible({ timeout: 15_000 });
  expect(inSite("public/media/logo.svg")).toBe(false);
  expect(stored.has("media/logo.svg")).toBe(true);
  expect(Object.keys(readJson("content/media-storage.json").files as object).sort()).toEqual([
    "/media/favicon.svg",
    "/media/logo.svg",
    "/media/placeholder.svg",
    "/media/sermon.mp4",
  ]);

  // Pages show them from the storage.
  await page.goto("/about");
  await expect(page.locator('img[src="https://storage.example/media/placeholder.svg"]').first()).toBeAttached();
  await expect(page.locator('img[src="/media/placeholder.svg"]')).toHaveCount(0);

  // Moving back puts them in the site's own files, and the site stops keeping media there.
  await page.goto("/admin#/media");
  await page.getByRole("button", { name: "Move back to the site" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Move back to the site" }).click();
  await expect(page.getByText("Moved 4 files back from Keeper.")).toBeVisible({ timeout: 15_000 });
  expect(inSite("public/media/logo.svg")).toBe(true);
  expect(inSite("public/media/sermon.mp4")).toBe(true);
  expect(inSite("content/media-storage.json")).toBe(false);
  await expect.poll(() => stored.size).toBe(0);
});
