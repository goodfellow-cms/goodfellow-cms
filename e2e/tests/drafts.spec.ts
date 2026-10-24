import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { type Page, test as plain } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";
import { canvas, editor, expect, field, openPageEditor, readSiteFile, test } from "./helpers.js";

const DRAFT_BRANCH = /^goodfellow-draft-\d{8}-[a-z0-9]{6}$/;

async function signedIn(page: Page) {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await page.goto(`${GITHUB_SITE}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByLabel("Stay signed in on this device").check();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  return fake;
}

/** Changes a page's first heading in the editor. */
async function editHeading(page: Page, path: string, from: string, to: string) {
  await page.goto(`${GITHUB_SITE}/admin/#/pages/edit?path=${encodeURIComponent(path)}`);
  await canvas(page).getByRole("heading", { name: from }).click();
  await editor(page).locator('input[name="text"]:visible').fill(to);
  await expect(canvas(page).getByRole("heading", { name: to })).toBeVisible();
}

function draftBranches(fake: ReturnType<typeof fakeGitHub>): string[] {
  return [...fake.repo.branches.keys()].filter((branch) => DRAFT_BRANCH.test(branch));
}

plain("keeps several pages' changes in a draft, then publishes them in one save", async ({ page }) => {
  const fake = await signedIn(page);
  const head = fake.repo.head();
  await editHeading(page, "/about", "About us", "About our parish");
  const header = page.locator(".gfa-editor-header");
  await header.getByRole("button", { name: "Add to draft" }).click();
  await expect(page.getByText("Added to the draft.", { exact: true })).toBeVisible();

  // The change is on a draft, not the live site, which isn't rebuilt.
  const [branch = ""] = draftBranches(fake);
  expect(branch).toMatch(DRAFT_BRANCH);
  expect(fake.repo.head()).toBe(head);
  expect(fake.repo.files(branch).get("content/pages/about.json")).toContain("About our parish");
  const banner = page.locator(".gfa-draft-banner");
  await expect(banner).toContainText("You're working in a draft");
  await expect(banner).toContainText("1 file changed");
  await expect(page.locator(".gfa-deploy")).toHaveCount(0);

  // With the draft open, the editor's Publish adds to it, on every screen, and it's there after the page reloads.
  await page.reload();
  await expect(banner).toContainText("1 file changed");
  await editHeading(page, "/", "Welcome to my site", "Welcome to the parish");
  await expect(header.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  await header.getByRole("button", { name: "Add to draft" }).click();
  await expect(banner).toContainText("2 files changed");
  await page.goto(`${GITHUB_SITE}/admin/#/media`);
  await expect(banner).toContainText("2 files changed");
  expect(fake.repo.head()).toBe(head);

  await banner.getByRole("button", { name: "Publish all" }).click();
  await expect(banner).toContainText("The draft is published.");
  expect(fake.repo.commitAt(fake.repo.head())?.message).toBe(
    `Publish the draft ${branch.slice("goodfellow-draft-".length)}`,
  );
  expect(fake.repo.files().get("content/pages/about.json")).toContain("About our parish");
  expect(fake.repo.files().get("content/pages/index.json")).toContain("Welcome to the parish");
  expect(draftBranches(fake)).toEqual([]);
  await expect(page.locator(".gfa-deploy")).toHaveText("The live site is up to date", { timeout: 15_000 });
});

plain("finishes a draft started elsewhere, such as from Claude, and submits it for review", async ({ page }) => {
  const fake = await signedIn(page);
  // A draft branch made from the live site, as the Claude connector makes them.
  const about = String(fake.repo.files().get("content/pages/about.json"));
  fake.repo.branches.set("goodfellow-draft-20261020-claude", fake.repo.head());
  fake.repo.commit(
    [
      {
        path: "content/pages/about.json",
        content: about.replace('"text": "About us"', '"text": "About Claude\'s draft"'),
      },
    ],
    "Edit",
    { branch: "goodfellow-draft-20261020-claude" },
  );
  await page.reload();

  const banner = page.locator(".gfa-draft-banner");
  await expect(banner).toContainText("is waiting to be published");
  await banner.getByRole("button", { name: "Open" }).click();
  await expect(banner).toContainText("1 file changed");
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await expect(canvas(page).getByRole("heading", { name: "About Claude's draft" })).toBeVisible();

  await banner.getByRole("button", { name: "Submit for review" }).click();
  await expect(banner).toContainText("Submitted for review.");
  expect(fake.repo.reviews).toHaveLength(1);
  expect(fake.repo.reviews[0]).toMatchObject({ branch: "goodfellow-draft-20261020-claude", state: "open" });
  expect(fake.repo.reviews[0]?.description).toContain("content/pages/about.json");

  // Going back to the live site leaves the draft for later, and the editor shows the live page.
  await banner.getByRole("button", { name: "Back to the live site" }).click();
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  await expect(banner).toContainText("is waiting to be published");
});

plain("won't publish a draft over someone else's change to the same page, and throws it away", async ({ page }) => {
  const fake = await signedIn(page);
  await editHeading(page, "/about", "About us", "Mine");
  await page.locator(".gfa-editor-header").getByRole("button", { name: "Add to draft" }).click();
  const banner = page.locator(".gfa-draft-banner");
  await expect(banner).toContainText("1 file changed");

  const about = String(fake.repo.files().get("content/pages/about.json"));
  fake.commit(
    [{ path: "content/pages/about.json", content: about.replace('"text": "About us"', '"text": "Theirs"') }],
    "Theirs",
  );
  await banner.getByRole("button", { name: "Publish all" }).click();
  await expect(banner.getByRole("alert")).toContainText("Someone else has published changes");
  expect(fake.repo.files().get("content/pages/about.json")).toContain("Theirs");
  expect(draftBranches(fake)).toHaveLength(1);

  await banner.getByRole("button", { name: "Throw away" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Throw away" }).click();
  await expect(banner).toHaveCount(0);
  expect(draftBranches(fake)).toEqual([]);
  // The editor shows the live site again.
  await editHeading(page, "/about", "Theirs", "Theirs again");
});

test("keeps a draft in the browser where the site has no drafts of its own", async ({ page }) => {
  const before = readSiteFile("content/pages/about.json");
  await openPageEditor(page, "/about", "About us");
  await canvas(page).getByRole("heading", { name: "About us" }).click();
  await field(page, "text").fill("About our parish");
  await page.locator(".gfa-editor-header").getByRole("button", { name: "Add to draft" }).click();
  const banner = page.locator(".gfa-draft-banner");
  await expect(banner).toContainText("kept in this browser");
  await expect(banner.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
  expect(readSiteFile("content/pages/about.json")).toBe(before);

  // It's still there when the admin panel opens again.
  await page.goto("/admin#/pages");
  await expect(banner).toContainText("1 file changed");
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await banner.getByRole("button", { name: "Publish all" }).click();
  await expect(banner).toContainText("The draft is published.");
  expect(readSiteFile("content/pages/about.json")).toContain("About our parish");
});
