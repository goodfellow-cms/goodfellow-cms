import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localScreenshots } from "@goodfellow-cms/mcp/screenshots";
import { chromium } from "@playwright/test";
import { builtSites, starter } from "../scripts/site.mjs";
import { expect, test } from "./helpers.js";

/** Every content file of the starter, as text by its path, as the Claude connector hands a draft to the preview. */
function starterContent(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(join(starter, "content"), { recursive: true, withFileTypes: true })) {
    if (!name.isFile()) continue;
    const path = join(name.parentPath, name.name)
      .slice(starter.length + 1)
      .split("\\")
      .join("/");
    files[path] = readFileSync(join(starter, path), "utf8");
  }
  return files;
}

declare global {
  interface Window {
    goodfellowPreview?: (request: { files: Record<string, string>; path: string }) => Promise<unknown>;
  }
}

const built = `http://localhost:${builtSites.github.port}`;

test("describes the site's blocks for the Claude connector", async ({ request }) => {
  const description = await (await request.get(`${built}/goodfellow-site.json`)).json();
  expect(description).toMatchObject({ version: 1, blocks: { Heading: { label: "Heading" } } });
});

test("shows a draft's page, from the files it's handed, without signing in", async ({ page }) => {
  await page.goto(`${built}/admin/#/preview`);
  await page.waitForFunction(() => typeof window.goodfellowPreview === "function");
  // Nothing is shown, and nobody is asked to sign in, until a script in the page asks.
  await expect(page.getByText("Sign in", { exact: false })).toHaveCount(0);

  const files = starterContent();
  files["content/pages/about.json"] = (files["content/pages/about.json"] ?? "").replace(
    '"text": "About us"',
    '"text": "About St. Joseph"',
  );
  const result = await page.evaluate((request) => window.goodfellowPreview?.(request), {
    files,
    path: "/about",
  });
  expect(result).toEqual({ ok: true, status: 200 });
  const frame = page.frameLocator("iframe[title=Preview]");
  await expect(frame.getByRole("heading", { name: "About St. Joseph" })).toBeVisible();
  // With the site's header and its styles.
  await expect(frame.locator("header.gf-header")).toBeVisible();
  expect(await frame.locator("body").evaluate((body) => getComputedStyle(body).fontFamily)).not.toBe("");

  const missing = await page.evaluate((request) => window.goodfellowPreview?.(request), {
    files,
    path: "/no-such-page",
  });
  expect(missing).toEqual({ ok: true, status: 404 });
  const broken = await page.evaluate((request) => window.goodfellowPreview?.(request), {
    files: { ...files, "content/site.json": "{" },
    path: "/",
  });
  expect(broken).toMatchObject({ ok: false });
});

test("takes screenshots of a draft with the computer's own browser, as the connector on a computer does", async () => {
  const screenshots = localScreenshots({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? chromium.executablePath(),
  });
  const png = await screenshots.take({
    url: `${built}/admin/#/preview`,
    width: 390,
    preview: { files: starterContent(), path: "/about" },
  });
  // A PNG, 390 pixels wide, and as tall as the page.
  expect([...png.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  const view = new DataView(png.buffer, png.byteOffset);
  expect(view.getUint32(16)).toBe(390);
  expect(view.getUint32(20)).toBeGreaterThan(600);
});
