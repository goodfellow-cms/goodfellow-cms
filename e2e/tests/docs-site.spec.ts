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

test("asks people to sponsor Goodfellow, and lists sponsors once there are any, from master's list", async ({
  page,
}) => {
  const SPONSORS = "https://raw.githubusercontent.com/goodfellow-cms/goodfellow-cms/master/.github/sponsors.json";
  let list: unknown = { version: 1, patrons: [], organizations: [], backers: [] };
  await page.route(SPONSORS, (route) =>
    route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, json: list }),
  );
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
    }),
  );

  // The header's Sponsor button and the footer's link go to GitHub Sponsors; nobody is listed yet.
  await page.goto(`${DOCS}/`, { waitUntil: "networkidle" });
  await expect(page.getByRole("banner").getByRole("link", { name: "Sponsor" })).toHaveAttribute(
    "href",
    "https://github.com/sponsors/goodfellow-cms",
  );
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Become a sponsor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sponsors", exact: true })).toBeHidden();

  // Once master's list has sponsors, the page shows them as it loads, and nothing that isn't a web address.
  list = {
    version: 1,
    patrons: [
      { name: "Patron Co.", url: "https://patron.example.org/", logo: "https://avatars.githubusercontent.com/u/1" },
    ],
    organizations: [
      { name: "Org", url: "https://org.example.org/", logo: "https://avatars.githubusercontent.com/u/2" },
      { name: "Sneaky", url: "javascript:alert(1)", logo: "https://avatars.githubusercontent.com/u/3" },
    ],
    backers: [{ name: "A. Backer", url: "https://github.com/backer" }],
  };
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Sponsors", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Patron Co." })).toHaveAttribute("href", "https://patron.example.org/");
  await expect(page.getByRole("img", { name: "Org" })).toBeVisible();
  await expect(page.getByRole("link", { name: "A. Backer" })).toHaveAttribute("href", "https://github.com/backer");
  await expect(page.getByRole("img", { name: "Sneaky" })).toHaveCount(0);
});
