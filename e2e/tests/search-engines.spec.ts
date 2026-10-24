import {
  editor,
  expect,
  field,
  openPageEditor,
  publishInEditor,
  readJson,
  readSiteFile,
  test,
  writeSiteFile,
} from "./helpers.js";

test("hides a page from search engines, and shows how links to it look when shared", async ({ page }) => {
  await openPageEditor(page, "/about", "About us");
  const preview = editor(page).getByRole("region", { name: "When a link to this page is shared" });
  await expect(preview).toContainText("About us");
  // Link previews need the site's address for the image.
  await expect(preview).toContainText("once the site's address is set");

  // Pages are in search results unless they say otherwise, and their settings show it.
  await expect(editor(page).getByRole("radio", { name: "Show in search results" })).toBeChecked();
  await field(page, "description").fill("Who we are, and how to find us.");
  await expect(preview).toContainText("Who we are, and how to find us.");
  await editor(page).getByRole("radio", { name: "Hide from search results" }).check({ force: true });
  await expect(preview).toContainText("This page is hidden from search engines");
  await publishInEditor(page);
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(readJson("content/pages/about.json")).toMatchObject({
    data: { root: { props: { noIndex: true, description: "Who we are, and how to find us." } } },
  });
  expect(await (await page.request.get("/about")).text()).toContain('<meta name="robots" content="noindex"/>');
});

test("shows Page not found as hidden from search engines, which it always is", async ({ page }) => {
  await openPageEditor(page, "/404", "Page not found");
  const hidden = editor(page).getByRole("radio", { name: "Hide from search results" });
  await expect(hidden).toBeChecked();
  await expect(hidden).toBeDisabled();
  await expect(editor(page).getByRole("radio", { name: "Show in search results" })).toBeDisabled();
});

test("gives a site with an address feeds of its news, and tells search engines about its items", async ({ page }) => {
  writeSiteFile(
    "content/site.json",
    `${JSON.stringify({ ...readJson("content/site.json"), url: "https://parish.example/" }, null, 2)}\n`,
  );

  const rss = await page.request.get("/feeds/news.rss");
  expect(rss.headers()["content-type"]).toContain("application/rss+xml");
  const feed = await rss.text();
  expect(feed).toContain("<title>News – ");
  expect(feed).toContain("https://parish.example/news/welcome");
  expect(await (await page.request.get("/feeds/news.atom")).text()).toContain(
    '<feed xmlns="http://www.w3.org/2005/Atom"',
  );

  const home = await (await page.request.get("/")).text();
  expect(home).toContain('<link rel="alternate" type="application/rss+xml"');
  expect(home).toContain('"@type":"WebSite"');
  const story = await (await page.request.get("/news/welcome")).text();
  const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/.exec(story)?.[1] ?? "{}");
  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "Article",
    url: "https://parish.example/news/welcome",
  });
  expect(readSiteFile("content/pages/about.json")).not.toContain("noIndex");
});
