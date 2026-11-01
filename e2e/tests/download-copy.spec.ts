import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { site } from "../scripts/site.mjs";
import { expect, test } from "./helpers.js";

test("downloads a copy of the site's content and media as one zip file", async ({ page }) => {
  await page.goto("/admin#/settings/history");
  await expect(page.getByRole("heading", { name: "Download a copy" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download a copy" }).click();
  const download = await downloading;
  const today = new Date();
  const day = [today.getFullYear(), today.getMonth() + 1, today.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  expect(download.suggestedFilename()).toMatch(new RegExp(`-${day}\\.zip$`));

  const zip = unzipSync(new Uint8Array(readFileSync((await download.path()) as string)));
  const paths = Object.keys(zip);
  // The content and the media library, each file as it is on the site.
  expect(paths).toContain("content/site.json");
  expect(paths).toContain("content/pages/index.json");
  expect(paths).toContain("public/media/logo.svg");
  expect(new TextDecoder().decode(zip["content/site.json"])).toBe(
    readFileSync(join(site as string, "content/site.json"), "utf8"),
  );
  // Never the site's code: only the records of installed blocks and plugins, and what another site's import reads first.
  expect(paths.filter((path) => !path.startsWith("content/") && !path.startsWith("public/media/"))).toEqual(
    paths.filter((path) => path.endsWith("/installed.json") || path === "goodfellow-transfer.json"),
  );
  expect(JSON.parse(new TextDecoder().decode(zip["goodfellow-transfer.json"]))).toMatchObject({ version: 1 });
});
