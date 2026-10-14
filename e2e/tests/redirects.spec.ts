import { expect, readJson, readSiteFile, test } from "./helpers.js";

test("sets up redirects in Site Settings, which send visitors on from old addresses", async ({ page }) => {
  await page.goto("/admin#/settings/redirects");
  await expect(page.getByText("There are no redirects yet.")).toBeVisible();
  const before = readSiteFile("content/site.json");

  await page.getByRole("button", { name: "Add redirect" }).click();
  await page.getByLabel("Old address").fill("https://old.example.org/index.php?page_id=5");
  await page.getByLabel("Send visitors to").fill("/about");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/Addresses with a \? in them can't be redirected/)).toBeVisible();
  expect(() => readSiteFile("content/redirects.json")).toThrow();

  // A full address copied from the old site gives its path.
  await page.getByLabel("Old address").fill("https://old.example.org/who-we-are/");
  // An empty row is left out.
  await page.getByRole("button", { name: "Add redirect" }).click();
  await page.getByRole("button", { name: "Add redirect" }).click();
  await page.getByLabel("Old address").nth(1).fill("/about");
  await page.getByLabel("Send visitors to").nth(1).fill("/");
  await expect(
    page.getByText("A page has this address, so visitors see the page instead.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove" }).nth(1).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  expect(readJson("content/redirects.json")).toEqual({
    version: 1,
    redirects: [{ from: "/who-we-are", to: "/about" }],
  });
  expect(readSiteFile("content/site.json")).toBe(before);

  // While it sends visitors on, the old address says where they're going.
  const html = await (await page.request.get("/who-we-are")).text();
  expect(html).toContain('This page has moved to <a href="/about"');
  expect(html).toContain(">About us</a>.");

  await page.goto("/");
  await page.goto("/who-we-are/");
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About us" })).toBeVisible();
  // The old address isn't left in the browser's history, so one Back goes back.
  await page.goBack();
  await expect(page).toHaveURL(/:\d+\/$/);

  // Taking every redirect out removes the file.
  await page.goto("/admin#/settings/redirects");
  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(() => readSiteFile("content/redirects.json")).toThrow();
});
