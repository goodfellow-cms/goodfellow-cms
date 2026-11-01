import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";
import { canvas, editor, expectSandboxed } from "./helpers.js";

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
  const heading = editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" });
  await heading.click();
  await editor(page).locator('input[name="text"]:visible').fill("About our parish");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();

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
  await editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" }).click();
  await editor(page).locator('input[name="text"]:visible').fill("Mine");

  // Someone else edits the home page, then publishing still works.
  const home = String(fake.repo.files().get("content/pages/index.json") ?? "");
  fake.commit([{ path: "content/pages/index.json", content: home.replace("Welcome to my site", "Theirs") }], "Theirs");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  expect(fake.repo.files().get("content/pages/index.json")).toContain("Theirs");
  expect(fake.repo.files().get("content/pages/about.json")).toContain('"text": "Mine"');

  // Someone else edits this page: publishing stops instead of overwriting them.
  const about = String(fake.repo.files().get("content/pages/about.json") ?? "");
  fake.commit(
    [{ path: "content/pages/about.json", content: about.replace('"text": "Mine"', '"text": "Theirs too"') }],
    "Theirs",
  );
  await editor(page).locator('input[name="text"]:visible').fill("Mine again");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
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

test("runs the site's blocks in a sandbox that can't reach the sign-in, storage, the network or WebRTC", async ({
  page,
}) => {
  await setup(page);
  await signIn(page, "good-token", true);
  await page.getByRole("link", { name: "About us", exact: true }).click();
  await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
  await expectSandboxed(page);

  // The admin panel's page still has the sign-in it kept, which the frame can't see.
  expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith("goodfellow:github")))).toBe(
    true,
  );
});

test("adds a token broker: makes its repository from the released page, then publishes its address", async ({
  page,
}) => {
  const fake = await setup(page, {
    orgs: ["parish"],
    files: { ...files(), "goodfellow.config.tsx": "export default defineConfig({\n  blocks,\n});\n" },
    tokens: { "good-token": { login: "maria", name: "Maria" }, "maker-token": { login: "maria", name: "Maria" } },
  });
  // The released page, which the admin panel downloads from jsDelivr, served from the built broker.
  const built = fileURLToPath(new URL("../../packages/broker/site/", import.meta.url));
  await page.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@goodfellow-cms\/broker@[^/]+\/site\//, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*?\/site\//, "");
    await route.fulfill({ body: readFileSync(join(built, path)) });
  });
  await signIn(page);
  await page.goto(`${GITHUB_SITE}/admin/#/settings/security`);
  await expect(page.getByRole("heading", { name: "Add a token broker" })).toBeVisible();
  // Without one, or an admin address, the tab says what the site's pages could reach, as the Code tab does.
  await expect(page.getByRole("note").filter({ hasText: "where its pages could reach their sign-in" })).toBeVisible();
  await page.goto(`${GITHUB_SITE}/admin/#/settings/code`);
  await expect(page.getByRole("note").filter({ hasText: "could act as anyone signed in" })).toBeVisible();
  await page.goto(`${GITHUB_SITE}/admin/#/settings/security`);

  // GitHub Pages needs a domain of its own, never a github.io one.
  await page.getByLabel("Its domain").fill("signin.parish.github.io");
  await page.getByLabel("A GitHub token that can create projects").fill("maker-token");
  await page.getByRole("button", { name: "Make the sign-in page" }).click();
  await expect(page.getByText("shared with other sites")).toBeVisible();
  await page.getByLabel("Its domain").fill("signin.example.org");
  await page.getByRole("button", { name: "Make the sign-in page" }).click();
  await expect(page.getByText("The sign-in page's project is ready")).toBeVisible({ timeout: 30_000 });

  const created = fake.created.get("parish/site-signin");
  expect(created?.pages?.cname).toBe("signin.example.org");
  const repoFiles = created?.repo.files();
  expect(repoFiles?.has("site/index.html")).toBe(true);
  expect(JSON.parse(String(repoFiles?.get("site/broker.json")))).toMatchObject({
    sites: [{ package: "@goodfellow-cms/github", export: "github", options: { repo: "parish/site" } }],
  });
  expect(String(repoFiles?.get(".github/workflows/deploy.yml"))).toContain("path: site");

  // Its address is known already, so publishing it is one click.
  await expect(page.getByLabel("The sign-in page's address")).toHaveValue("https://signin.example.org");
  await page.getByRole("button", { name: "Sign in there from now on" }).click();
  await expect
    .poll(() => fake.repo.files().get("goodfellow.config.tsx"))
    .toContain('broker: { url: "https://signin.example.org" },');
});

test("names the site's sign-in service once it's set up, for Sign in with GitHub", async ({ page }) => {
  const site = { ...JSON.parse(files()["content/site.json"] ?? "{}"), url: "https://parish.example" };
  const fake = await setup(page, {
    files: {
      ...files(),
      "content/site.json": `${JSON.stringify(site, null, 2)}\n`,
      "goodfellow.config.tsx":
        'import { github } from "@goodfellow-cms/github";\nexport default defineConfig({\n  blocks,\n  backend: github({ repo: "parish/site" }),\n});\n',
    },
  });
  let ready = false;
  await page.route("https://sign-in.parish.example/health", (route) =>
    route.fulfill({ json: { ok: ready, apps: {} }, headers: { "access-control-allow-origin": "*" } }),
  );
  await signIn(page);
  await page.goto(`${GITHUB_SITE}/admin/#/settings/security`);
  await expect(page.getByRole("heading", { name: "Sign in with GitHub" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Deploy to Cloudflare" })).toHaveAttribute(
    "href",
    "https://deploy.workers.cloudflare.com/?url=https://github.com/goodfellow-cms/goodfellow-sign-in",
  );

  // A service that hasn't finished its setup page isn't published, since editors couldn't sign in with it.
  await page.getByLabel("The sign-in service's address").fill("https://sign-in.parish.example/");
  await page.getByRole("button", { name: "Use this sign-in service" }).click();
  await expect(page.getByText("isn't set up yet")).toBeVisible();
  ready = true;
  await page.getByRole("button", { name: "Use this sign-in service" }).click();
  await expect
    .poll(() => fake.repo.files().get("goodfellow.config.tsx"))
    .toContain('backend: github({ repo: "parish/site", signIn: "https://sign-in.parish.example" }),');
  await expect(page.getByText("through the sign-in service at https://sign-in.parish.example")).toBeVisible();
});
