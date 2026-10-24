import {
  canvas,
  expect,
  expectSandboxed,
  field,
  openPageEditor,
  publishInEditor,
  readJson,
  readSiteFile,
  test,
  writeSiteFile,
} from "./helpers.js";

test("lists the site's pages", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
  for (const title of ["Welcome", "About us", "Page not found"]) {
    await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  }
});

test("edits and publishes a page", async ({ page, request }) => {
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("About our parish");
  await expect(canvas(page).getByRole("heading", { name: "About our parish" })).toBeVisible();

  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const file = readSiteFile("content/pages/about.json");
  expect(file).toContain('"text": "About our parish"');
  expect(file).not.toContain('"zones"');
  // The live page shows the change, and the editor kept its state instead of reloading.
  expect(await (await request.get("/about")).text()).toContain("About our parish");
  await expect(canvas(page).getByRole("heading", { name: "About our parish" })).toBeVisible();
});

test("styles Tailwind classes typed in the editor before the site is rebuilt", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  const heading = canvas(page).getByRole("heading", { name: "About us" });
  await heading.click();
  // An arbitrary value no content file uses, so only the in-browser Tailwind can have generated it.
  await field(page, "className").fill("text-[rgb(200,30,30)]");
  await expect(heading).toHaveCSS("color", "rgb(200, 30, 30)");
});

test("shows the site's header and footer around the page being edited", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await expect(canvas(page).locator("header.gf-header")).toContainText("My site");
  await expect(canvas(page).locator("footer.gf-footer")).toContainText("Built with Goodfellow");
});

test("creates a page", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Page title").fill("Mass & Confession Times");
  await expect(page.getByLabel("Address")).toHaveValue("/mass-confession-times");
  await page.getByRole("button", { name: "Create page" }).click();

  await expect(page).toHaveURL(/#\/pages\/edit\?path=%2Fmass-confession-times$/);
  expect(readJson("content/pages/mass-confession-times.json")).toEqual({
    version: 1,
    data: { root: { props: { title: "Mass & Confession Times" } }, content: [] },
  });
});

test("duplicates a page, so a similar one doesn't start from scratch", async ({ page }) => {
  const about = readJson("content/pages/about.json") as { data: { root: { props: object } } };
  await page.goto("/admin");
  await page
    .getByRole("row", { name: /About us/ })
    .getByRole("button", { name: "Duplicate" })
    .click();
  await expect(page.getByRole("dialog", { name: 'Duplicate "About us"' })).toBeVisible();
  await expect(page.getByLabel("Page title")).toHaveValue("About us (copy)");
  await expect(page.getByLabel("Address")).toHaveValue("/about-us-copy");
  await page.getByLabel("Page title").fill("Our history");
  await expect(page.getByLabel("Address")).toHaveValue("/our-history");
  await page.getByRole("button", { name: "Duplicate page" }).click();

  await expect(page).toHaveURL(/#\/pages\/edit\?path=%2Four-history$/);
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible({ timeout: 20_000 });
  // The same blocks and settings, with the new title.
  expect(readJson("content/pages/our-history.json")).toEqual({
    ...about,
    data: { ...about.data, root: { ...about.data.root, props: { ...about.data.root.props, title: "Our history" } } },
  });
});

test("refuses addresses that can't be used", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "New page" }).click();
  await page.getByLabel("Page title").fill("Another about page");
  const address = page.getByLabel("Address");

  await address.fill("/about");
  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page.getByText("Another page already uses this address.")).toBeVisible();

  await address.fill("/admin");
  await expect(page.getByText("This address is used by the admin panel.")).toBeVisible();

  await address.fill("/Not Valid");
  await expect(page.getByText(/Use lowercase letters, numbers and hyphens/)).toBeVisible();
});

test("changes a page's address, updates links to it, and sends visitors on from the old one", async ({ page }) => {
  await page.goto("/admin");
  await page
    .getByRole("row", { name: /About us/ })
    .getByRole("button", { name: "Change address" })
    .click();
  await page.getByLabel("New address").fill("/about-us");
  await page.getByRole("button", { name: "Change address" }).last().click();

  await expect(page.getByRole("row", { name: /About us/ })).toContainText("/about-us");
  expect(() => readSiteFile("content/pages/about.json")).toThrow();
  expect(readJson("content/pages/about-us.json")).toMatchObject({ data: { root: { props: { title: "About us" } } } });
  expect(readSiteFile("content/menus.json")).toContain('"href": "/about-us"');
  expect(readSiteFile("content/menus.json")).not.toContain('"href": "/about"');
  // The home page's button to it, too.
  expect(readSiteFile("content/pages/index.json")).toContain('"href": "/about-us"');
  expect(readSiteFile("content/pages/index.json")).not.toContain('"href": "/about"');
  expect(readJson("content/redirects.json")).toEqual({ version: 1, redirects: [{ from: "/about", to: "/about-us" }] });

  await page.goto("/about");
  await expect(page).toHaveURL(/\/about-us$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("deletes a page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("row", { name: /Welcome/ }).getByRole("button", { name: "Delete" })).toBeDisabled();
  await page
    .getByRole("row", { name: /Page not found/ })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByRole("button", { name: "Delete page" }).click();

  await expect(page.getByRole("link", { name: "Page not found" })).toHaveCount(0);
  expect(() => readSiteFile("content/pages/404.json")).toThrow();
});

test("doesn't overwrite changes someone else made in the meantime", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  const original = readSiteFile("content/pages/about.json");
  const theirs = original.replace('"text": "About us"', '"text": "Their heading"');
  writeSiteFile("content/pages/about.json", theirs);

  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("My heading");
  await publishInEditor(page);

  await expect(page.getByRole("alert")).toContainText("Someone else changed the site");
  expect(readSiteFile("content/pages/about.json")).toBe(theirs);
});

test("asks before leaving a page with unpublished changes", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("Unsaved heading");

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("link", { name: "Site settings" }).click();
  await expect(page).toHaveURL(/#\/pages\/edit/);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("link", { name: "Site settings" }).click();
  await expect(page).toHaveURL(/#\/settings\/general$/);
});

test("runs the site's blocks in a sandbox in goodfellow dev too, away from the files on disk", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  await expectSandboxed(page);
});
