import { expect, test } from "@playwright/test";

// The documentation site, built with Goodfellow and served from /goodfellow-cms/.
const DOCS = "http://localhost:4406/goodfellow-cms";

test("finds pages with the search box, from the site's own index", async ({ page }) => {
  await page.goto(`${DOCS}/`, { waitUntil: "networkidle" });
  // The Search box and the Dark mode switch work with scripts of their own, so the page loads no React.
  await expect(page.locator("script[src]")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search the documentation" }).fill("pagefind");
  const result = page.getByRole("search").getByRole("link", { name: /^Search/ });
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("href", "/goodfellow-cms/docs/search/");
  await expect(result.locator("mark").first()).toBeVisible();
  await result.click();
  await expect(page).toHaveURL(`${DOCS}/docs/search/`);
  // The search box starts working once the page's scripts have loaded.
  await page.waitForLoadState("networkidle");

  // Letters that make no word, or the start of one: Pagefind matches the start of words, and "zzzz" matched "Z".
  await page.getByRole("searchbox").fill("qxjvwk");
  await expect(page.getByText("Nothing matches “qxjvwk”.")).toBeVisible();
});

test("shows a documentation page with its navigation, headings and highlighted, copyable code", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${DOCS}/docs/create-a-site/`, { waitUntil: "networkidle" });
  const nav = page.getByRole("navigation", { name: "Docs" });
  await expect(nav.getByRole("link", { name: "Create a site" })).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Try it on your computer" }),
  ).toHaveAttribute("href", "#try-it-on-your-computer");
  await expect(page.getByRole("link", { name: /Next\s*Put it online/ })).toHaveAttribute(
    "href",
    "/goodfellow-cms/docs/put-it-online/",
  );

  const code = page.locator("figure.gf-code").first();
  await expect(code.locator("pre.shiki")).toContainText("npm create goodfellow@latest my-site");
  await code.hover();
  await code.getByRole("button", { name: "Copy code" }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("npm create goodfellow@latest my-site");
});
