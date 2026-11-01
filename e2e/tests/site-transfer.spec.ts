import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { site } from "../scripts/site.mjs";
import { expect, readJson, test } from "./helpers.js";

const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const page = (title: string, words: string) => ({
  version: 1,
  data: {
    root: { props: { title, description: `${title}, described` } },
    content: [{ type: "Text", props: { id: `Text-${title.length}`, content: `<p>${words}</p>` } }],
  },
});

test("downloads the site for another Goodfellow site, with what the import reads first", async ({ page: browser }) => {
  await browser.goto("/admin/#/settings/import");
  const section = browser.locator("section", {
    has: browser.getByRole("heading", { name: "Export for another Goodfellow site" }),
  });
  const downloading = browser.waitForEvent("download");
  await section.getByRole("button", { name: "Download for another Goodfellow site" }).click();
  const zip = unzipSync(new Uint8Array(readFileSync((await (await downloading).path()) as string)));
  expect(Object.keys(zip)).toEqual(
    expect.arrayContaining(["goodfellow-transfer.json", "content/site.json", "content/pages/index.json"]),
  );
  const manifest = JSON.parse(new TextDecoder().decode(zip["goodfellow-transfer.json"]));
  expect(manifest).toMatchObject({ version: 1, title: "My site", media: true });
  expect(manifest.blocks.length).toBeGreaterThan(0);
});

test("imports another Goodfellow site's export, keeping this site's version until the other's is chosen", async ({
  page: browser,
}, testInfo) => {
  const file = testInfo.outputPath("st-brendan.zip");
  writeFileSync(
    file,
    zipSync({
      "goodfellow-transfer.json": encode({ version: 1, title: "St. Brendan", content: { page: 1 }, blocks: [] }),
      "content/site.json": encode({ version: 1, title: "St. Brendan", url: "https://stbrendan.example.org/" }),
      "content/pages/index.json": encode(page("Welcome to St. Brendan", "All are welcome.")),
      "content/pages/visit.json": encode(page("Visit St. Brendan", "Find us on Main Street.")),
      "content/permissions.json": encode({ version: 1, editors: {} }),
      "public/media/brendan.svg": new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
      ),
    }),
  );
  const before = readFileSync(join(site as string, "content/pages/index.json"), "utf8");

  await browser.goto("/admin/#/settings/import");
  const section = browser.locator("section", {
    has: browser.getByRole("heading", { name: "Import from another Goodfellow site" }),
  });
  await section.getByLabel("File from the other site").setInputFiles(file);
  await expect(section).toContainText("Ready to import St. Brendan.");
  await expect(section).toContainText("Pages: 1");
  await expect(section).toContainText("Stays as this site has it: the Site address, editors' limits.");
  const home = section.getByLabel(/Use the other site's: page Welcome to St\. Brendan \(\/\)/);
  await expect(home).not.toBeChecked();
  await section.getByRole("button", { name: "Import" }).click();
  await expect(section.getByText("Imported St. Brendan.")).toBeVisible();

  expect(JSON.stringify(readJson("content/pages/visit.json"))).toContain("Find us on Main Street.");
  expect(existsSync(join(site as string, "public/media/brendan.svg"))).toBe(true);
  // This site's home page, Site address and lack of editors' limits stay.
  expect(readFileSync(join(site as string, "content/pages/index.json"), "utf8")).toBe(before);
  expect(existsSync(join(site as string, "content/permissions.json"))).toBe(false);
  expect((readJson("content/site.json") as { url?: string }).url).not.toBe("https://stbrendan.example.org/");

  // Taking the other site's home page this time.
  await section.getByLabel("File from the other site").setInputFiles(file);
  await expect(section).toContainText("Ready to import St. Brendan.");
  await section.getByLabel(/Use the other site's: page Welcome to St\. Brendan/).check();
  await expect(section).toContainText("Pages: 1");
  await section.getByRole("button", { name: "Import" }).click();
  await expect(section.getByText("Imported St. Brendan.")).toBeVisible();
  expect(JSON.stringify(readJson("content/pages/index.json"))).toContain("All are welcome.");
});

test("refuses a file that isn't from a Goodfellow site", async ({ page: browser }, testInfo) => {
  const file = testInfo.outputPath("notes.zip");
  writeFileSync(file, zipSync({ "notes/readme.md": new TextEncoder().encode("# Hello") }));
  await browser.goto("/admin/#/settings/import");
  const section = browser.locator("section", {
    has: browser.getByRole("heading", { name: "Import from another Goodfellow site" }),
  });
  await section.getByLabel("File from the other site").setInputFiles(file);
  await expect(section).toContainText("This file isn't from a Goodfellow site.");
});
