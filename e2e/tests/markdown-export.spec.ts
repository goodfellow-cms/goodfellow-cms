import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { expect, test } from "./helpers.js";

test("downloads the site as a folder of Markdown files, with its media", async ({ page }) => {
  await page.goto("/admin/#/settings/import");
  await expect(page.getByRole("heading", { name: "Export as Markdown" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the Markdown files" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("my-site-markdown.zip");

  const zip = unzipSync(new Uint8Array(readFileSync((await download.path()) as string)));
  const text = (path: string) => new TextDecoder().decode(zip[`my-site-markdown/${path}`]);
  const paths = Object.keys(zip);
  // Every page and item at its address, the media library beside them, and the menus as data.
  expect(paths).toEqual(
    expect.arrayContaining([
      "my-site-markdown/index.md",
      "my-site-markdown/about.md",
      "my-site-markdown/news/index.md",
      "my-site-markdown/menus.json",
      "my-site-markdown/media/logo.svg",
    ]),
  );
  expect(paths.some((path) => /^my-site-markdown\/news\/.+\.md$/.test(path) && !path.endsWith("index.md"))).toBe(true);
  expect(text("about.md")).toMatch(/^---\ntitle: .+\n[\s\S]*permalink: \/about\/\n/);
  expect(text("menus.json")).toContain('"main"');

  await expect(page.getByRole("status").filter({ hasText: "Downloaded the Markdown files." })).toBeVisible();
  await expect(page.getByText(/Media files: 3/)).toBeVisible();
  await expect(
    page.getByText("The header and footer aren't in the files. The menus are, in menus.json."),
  ).toBeVisible();
});

test("links to the files rather than the site's addresses, when asked", async ({ page }) => {
  await page.goto("/admin/#/settings/import");
  await page.getByLabel("As links to the files, such as about.md (for notes apps)").check();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download the Markdown files" }).click();
  const zip = unzipSync(new Uint8Array(readFileSync((await (await downloading).path()) as string)));
  const home = new TextDecoder().decode(zip["my-site-markdown/index.md"]);
  expect(home).not.toMatch(/\]\(\/about\/?\)/);
});
