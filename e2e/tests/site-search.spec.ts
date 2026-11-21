import { expect, readJson, test, writeSiteFile } from "./helpers.js";

/** A stand-in for a search module, Pagefind's or MiniSearch's, which finds the About page. */
const stub = (title: string) => ({
  contentType: "text/javascript",
  body: `export async function options() {}
export async function destroy() {}
export async function debouncedSearch() {
  return { results: [{ data: async () => ({ url: "/about/", excerpt: "Who <mark>we</mark> are", meta: { title: ${JSON.stringify(title)} } }) }] };
}`,
});

/** The site with a Search block in its header, searching with `engine`. */
function searchWith(engine: "pagefind" | "minisearch") {
  writeSiteFile(
    "content/site.json",
    `${JSON.stringify({ ...readJson("content/site.json"), search: { engine } }, null, 2)}\n`,
  );
  const header = readJson("content/layout/header.json") as { data: { content: unknown[] } };
  header.data.content.push({
    type: "Search",
    props: {
      id: "Search-test",
      label: "Search this site",
      placeholder: "Search",
      noResults: "Nothing matches “{query}”.",
      unavailable: "Search works on the published site.",
      className: "",
    },
  });
  writeSiteFile("content/layout/header.json", `${JSON.stringify(header, null, 2)}\n`);
}

// A full-stack site that renders pages from its repository shows a new setting before its next build has written
// that engine's files, so the box uses the other engine's until then.
for (const [engine, other] of [
  ["minisearch", "pagefind"],
  ["pagefind", "minisearch"],
] as const) {
  test(`searches with ${other}'s files where the site says ${engine} but has no index of it yet`, async ({ page }) => {
    searchWith(engine);
    const modules = { pagefind: "**/pagefind/pagefind.js", minisearch: "**/minisearch/minisearch.js" };
    await page.route(modules[engine], (route) => route.fulfill({ status: 404, body: "" }));
    await page.route(modules[other], (route) => route.fulfill(stub(`About us, from ${other}`)));
    await page.goto("/");
    await page.getByRole("searchbox", { name: "Search this site" }).fill("we");
    await expect(page.getByRole("search").getByRole("link", { name: `About us, from ${other}` })).toBeVisible();
  });
}

test("says search isn't available where neither engine's files are there", async ({ page }) => {
  searchWith("minisearch");
  await page.route("**/minisearch/minisearch.js", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/pagefind/pagefind.js", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search this site" }).fill("we");
  await expect(page.getByRole("search").getByText("Search works on the published site.")).toBeVisible();
});
