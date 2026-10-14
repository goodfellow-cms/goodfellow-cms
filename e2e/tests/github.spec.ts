import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";

function setup(page: Page, options: Partial<Parameters<typeof fakeGitHub>[0]> = {}) {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    tokens: { "good-token": { login: "maria", name: "Maria" }, "read-only": { login: "visitor", push: false } },
    deployAfterChecks: 0,
    ...options,
  });
  return routeToFake(page, "https://api.github.com", fake.handle).then(() => fake);
}

async function signIn(page: Page, token = "good-token", remember = false) {
  await page.goto(`${GITHUB_SITE}/admin/`);
  await page.getByLabel("Access token").fill(token);
  if (remember) await page.getByLabel("Stay signed in on this device").check();
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signs in with a GitHub token created from a prefilled link", async ({ page }) => {
  await setup(page);
  await page.goto(`${GITHUB_SITE}/admin/`);
  await expect(page.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();
  // Signing in with GitHub through the worker works only at the site's own address, not on this computer.
  await expect(page.getByRole("button", { name: "Sign in with GitHub" })).toHaveCount(0);
  // The site's icon is in the tab before anyone signs in.
  await expect(page.locator('head link[rel~="icon"]')).toHaveAttribute("href", /\/media\/favicon\.svg$/);

  const link = new URL((await page.getByRole("link", { name: "Create a token on GitHub" }).getAttribute("href")) ?? "");
  expect(link.pathname).toBe("/settings/personal-access-tokens/new");
  expect(link.searchParams.get("target_name")).toBe("parish");
  expect(link.searchParams.get("contents")).toBe("write");

  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await expect(page.locator(".gfa-account")).toContainText("Maria");
});

test("explains when a token can't be used", async ({ page }) => {
  await setup(page);
  await signIn(page, "not-a-token");
  await expect(page.getByRole("alert")).toContainText("That sign-in didn't work");
  await signIn(page, "read-only");
  await expect(page.getByRole("alert")).toContainText("isn't allowed to change it");
});

test("publishes to GitHub and follows the live site's update", async ({ page }) => {
  const fake = await setup(page);
  await signIn(page);
  await page.getByRole("link", { name: "About us", exact: true }).click();
  const heading = page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "About us" });
  await heading.click();
  await page.locator('.gfa-editor input[name="text"]:visible').fill("About our parish");
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();

  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/pages/about.json")).toContain('"text": "About our parish"');
  expect(fake.repo.commitAt(fake.repo.head())?.message).toBe('Update page "About us"');
  await expect(page.locator(".gfa-deploy")).toHaveText("Updating the live site…");
  await expect(page.locator(".gfa-deploy")).toHaveText("The live site is up to date", { timeout: 15_000 });
});

test("publishes over someone else's change to a different page, but not to the same one", async ({ page }) => {
  const fake = await setup(page);
  await signIn(page);
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await page.frameLocator("iframe#preview-frame").getByRole("heading", { name: "About us" }).click();
  await page.locator('.gfa-editor input[name="text"]:visible').fill("Mine");

  // Someone else edits the home page, then publishing still works.
  const home = String(fake.repo.files().get("content/pages/index.json") ?? "");
  fake.commit([{ path: "content/pages/index.json", content: home.replace("Welcome to my site", "Theirs") }], "Theirs");
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/pages/index.json")).toContain("Theirs");
  expect(fake.repo.files().get("content/pages/about.json")).toContain('"text": "Mine"');

  // Someone else edits this page: publishing stops instead of overwriting them.
  const about = String(fake.repo.files().get("content/pages/about.json") ?? "");
  fake.commit(
    [{ path: "content/pages/about.json", content: about.replace('"text": "Mine"', '"text": "Theirs too"') }],
    "Theirs",
  );
  await page.locator('.gfa-editor input[name="text"]:visible').fill("Mine again");
  await page.locator(".gfa-editor").getByText("Publish", { exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Someone else changed the site");
  expect(fake.repo.files().get("content/pages/about.json")).toContain('"text": "Theirs too"');
});

test("stays signed in only when asked, and signs out", async ({ page, context }) => {
  await setup(page);
  await signIn(page);
  await expect(page.locator(".gfa-account")).toBeVisible();

  // Not remembered: a new tab has to sign in again.
  const other = await context.newPage();
  await setup(other);
  await other.goto(`${GITHUB_SITE}/admin/`);
  await expect(other.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();

  await signIn(other, "good-token", true);
  const third = await context.newPage();
  await setup(third);
  await third.goto(`${GITHUB_SITE}/admin/`);
  await expect(third.locator(".gfa-account")).toContainText("Maria");
  await third.evaluate(() => localStorage.setItem("goodfellow.ai.key.anthropic", "sk-ant-saved"));

  await third.getByRole("button", { name: "Sign out" }).click();
  await expect(third.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();
  expect(await third.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("goodfellow:")))).toEqual(
    [],
  );
  // AI keys go too, so the next person on this computer can't use them.
  expect(await third.evaluate(() => localStorage.getItem("goodfellow.ai.key.anthropic"))).toBeNull();
});

test("asks to sign in again when the token stops working", async ({ page }) => {
  await setup(page, { tokens: { "good-token": { login: "maria" } } });
  await signIn(page);
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  // Revoke the token, then try to publish settings.
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 401, body: "{}", headers: { "access-control-allow-origin": "*" } }),
  );
  await page.getByRole("link", { name: "Site settings" }).click();
  await page.getByLabel("Site name").fill("Renamed");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to edit this site" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("your sign-in expired");
});

test("uploads an image and shows it before the live site has it", async ({ page }) => {
  const fake = await setup(page);
  await signIn(page);
  await page.goto(`${GITHUB_SITE}/admin/#/media`);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    return canvas.toDataURL("image/png");
  });
  const png = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  await page
    .locator('input[type="file"][aria-label="Upload files"]')
    .setInputFiles({ name: "Dot.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Uploaded.", { exact: false })).toBeVisible();
  expect(fake.repo.files().get("public/media/dot.png")).toBeInstanceOf(Uint8Array);

  const thumb = page.locator(".gfa-media-card", { hasText: "dot.png" }).locator("img");
  await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(2);

  // After a reload the copy in memory is gone, and the live site still doesn't have the file: it's read from GitHub.
  await page.reload();
  const reloaded = page.locator(".gfa-media-card", { hasText: "dot.png" }).locator("img");
  await expect(reloaded).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => reloaded.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(2);
});
