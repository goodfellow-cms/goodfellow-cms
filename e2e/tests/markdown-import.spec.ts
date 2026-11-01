import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { site } from "../scripts/site.mjs";
import { expect, readJson, test } from "./helpers.js";

/** A made-up parish's old static site: a page at the top, posts in a folder with its own page, and a picture. */
const FOLDER = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/markdown/old-site");

test("imports a folder of Markdown files as pages and a collection, with links, pictures and the menu", async ({
  page,
}) => {
  await page.goto("/admin#/settings/import");
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Import Markdown files" }) });
  await section.getByLabel("Folder of Markdown files").setInputFiles(FOLDER);
  await expect(section).toContainText("Ready to import old-site.");
  await expect(section.getByLabel("Files at the top (1)")).toHaveValue("pages");
  await expect(section.getByLabel("posts (3 files)")).toHaveValue("collection");
  await expect(section).toContainText("Posts: 1 items, at /posts/{slug}");
  await expect(section).toContainText("Drafts aren't imported unless you ask: posts/2026-07-01-choir.md.");
  await section.getByLabel("Add the top-level pages to the main menu").check();
  await section.getByRole("button", { name: "Import" }).click();
  await expect(section.getByText("Imported old-site.")).toBeVisible();

  // The page at the top, with its link to the posts' page and its picture copied into the media library.
  const visit = JSON.stringify(readJson("content/pages/visit.json"));
  expect(visit).toContain("Visit us");
  expect(visit).toContain('href=\\"/posts\\"');
  expect(visit).toContain("/media/sign.svg");
  expect(existsSync(join(site as string, "public/media/sign.svg"))).toBe(true);
  // The folder's own page lists its items, which keep their Markdown, with links at their new addresses.
  expect(JSON.stringify(readJson("content/pages/posts.json"))).toContain('"collection":"posts"');
  const fete = readFileSync(join(site as string, "content/collections/posts/fete.md"), "utf8");
  expect(fete).toContain("See [how to visit](/visit).");
  expect(existsSync(join(site as string, "content/collections/posts/choir.md"))).toBe(false);
  expect(readJson("content/menus.json")).toMatchObject({
    menus: { main: expect.arrayContaining([{ label: "Visit us", href: "/visit" }]) },
  });
});
