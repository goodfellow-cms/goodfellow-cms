import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";
import { canvas, editor } from "./helpers.js";

const PERMISSIONS = {
  version: 1,
  people: { maria: { pages: ["/about"] } },
  reviewers: ["owen"],
};

async function signIn(page: Page, login: string, permissions: unknown = PERMISSIONS) {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: { ...files(), "content/permissions.json": JSON.stringify(permissions) },
    tokens: { "good-token": { login, name: login === "maria" ? "Maria" : "Owen" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${GITHUB_SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  return fake;
}

test("an editor with limits changes only what's theirs, and submits the rest for review", async ({ page }) => {
  const fake = await signIn(page, "maria");
  // Pages outside her limits can be looked at, not changed.
  const home = page.getByRole("row", { name: /Welcome/ });
  await expect(home.getByRole("link", { name: "Look" })).toBeVisible();
  await expect(home.getByRole("button", { name: "Change address" })).toHaveCount(0);
  await home.getByRole("link", { name: "Look" }).click();
  await expect(page.getByText("You can look at this, but an owner has limited what you can change")).toBeVisible();
  await expect(canvas(page).getByRole("heading", { name: "Welcome to my site" })).toBeVisible();
  const header = page.locator(".gfa-editor-header");
  await expect(header.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);

  // Her own page publishes as ever.
  await page.goto(`${GITHUB_SITE}/admin/#/pages/edit?path=%2Fabout`);
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await editor(page).locator('input[name="text"]:visible').fill("About our parish");
  await header.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published.")).toBeVisible();
  expect(fake.repo.files().get("content/pages/about.json")).toContain("About our parish");

  // Moving it changes the menus and the home page's link to it, which aren't hers: those go to review.
  await page.goto(`${GITHUB_SITE}/admin/`);
  const head = fake.repo.head();
  await page
    .getByRole("row", { name: /About us/ })
    .getByRole("button", { name: "Change address" })
    .click();
  await page.getByLabel("New address").fill("/about/us");
  await page.getByRole("button", { name: "Change address" }).last().click();
  const dialog = page.getByRole("dialog", { name: "Some of this is outside what you can change" });
  await expect(dialog).toContainText("The page Welcome");
  // The redirect from the old address is a setting.
  await expect(dialog).toContainText("The site's settings");
  await expect(dialog).toContainText("The menus");
  await dialog.getByRole("button", { name: "Submit for review" }).click();
  await expect(dialog).toContainText("Submitted for review.");
  await expect(dialog.getByRole("link", { name: "See it" })).toHaveAttribute(
    "href",
    "https://github.com/parish/site/pull/1",
  );
  expect(fake.repo.head()).toBe(head);
  expect(fake.repo.reviews).toEqual([
    expect.objectContaining({ state: "open", reviewers: ["owen"], title: expect.stringContaining("About") }),
  ]);
  const branch = fake.repo.reviews[0]?.branch ?? "";
  expect(fake.repo.files(branch).get("content/pages/about/us.json")).toContain("About our parish");
});

test("an owner sees what waits for their review, publishes it, and sets someone's limits", async ({ page }) => {
  const fake = await signIn(page, "owen", { version: 1, people: {} });
  // A draft someone submitted for review.
  const about = String(fake.repo.files().get("content/pages/about.json"));
  fake.repo.branches.set("goodfellow-draft-20261027-maria1", fake.repo.head());
  fake.repo.commit(
    [{ path: "content/pages/about.json", content: about.replace("About us", "About the parish") }],
    "About",
    { branch: "goodfellow-draft-20261027-maria1" },
  );
  fake.repo.openReview("goodfellow-draft-20261027-maria1", "A new About page", "", undefined, ["owen"]);
  await page.reload();
  const banner = page.locator(".gfa-draft-banner");
  await expect(banner).toContainText("A draft is waiting for review: A new About page.");
  await banner.getByRole("button", { name: "Open" }).click();
  await banner.getByRole("button", { name: "Publish all" }).click();
  await expect(banner).toContainText("The draft is published.");
  expect(fake.repo.files().get("content/pages/about.json")).toContain("About the parish");
  // Publishing it closes its review, which GitLab and Bitbucket wouldn't do by themselves.
  expect(fake.repo.reviews[0]?.state).not.toBe("open");

  await page.goto(`${GITHUB_SITE}/admin/#/settings/editors`);
  await page.getByLabel("Their username").fill("maria");
  await page.getByRole("button", { name: "Limit what they can change" }).click();
  const limits = page.getByRole("dialog", { name: "What maria can change" });
  await limits.getByLabel("/about").check();
  await limits.getByLabel("The media library").check();
  await limits.getByRole("button", { name: "Publish limits" }).click();
  await expect(limits).toHaveCount(0);
  expect(JSON.parse(String(fake.repo.files().get("content/permissions.json")))).toEqual({
    version: 1,
    people: { maria: { pages: ["/about"], collections: [], media: true } },
  });
  await expect(page.getByText("maria", { exact: true })).toBeVisible();
});
