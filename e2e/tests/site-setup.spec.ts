import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { routeToFake } from "./backends.js";

// The documentation site's setup page, which creates sites in the browser.
const SETUP = "http://localhost:4406/goodfellow-cms/new-site/";

/** A file of a created site, as text. */
function text(file: string | Uint8Array | undefined): string {
  return typeof file === "string" ? file : new TextDecoder().decode(file);
}

async function signIn(page: Page, token: string) {
  await page.getByPlaceholder("Paste the token here").fill(token);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Signed in as")).toBeVisible();
}

test("creates a site on GitHub with GitHub Pages, as npm create goodfellow would", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });

  await page.getByRole("radio", { name: "Parish example" }).check();
  await expect(page.getByRole("radio", { name: "GitHub Pages" })).toBeChecked();
  await expect(page.locator("label", { has: page.getByRole("radio", { name: "GitHub Pages" }) })).toContainText(
    "Recommended",
  );
  // Sites made from this copy of the docs have no lockfile, which the published docs have.
  await expect(page.getByText(/has no package-lock.json files/)).toBeVisible();

  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("parish");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await page.getByRole("button", { name: "Create the site" }).click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://someone.github.io/parish/", exact: true })).toHaveAttribute(
    "href",
    "https://someone.github.io/parish/",
  );
  await expect(page.getByRole("link", { name: "https://someone.github.io/parish/admin/", exact: true })).toBeVisible();

  const site = github.created.get("someone/parish");
  expect(site?.private).toBe(false);
  expect(site?.pages).toEqual({ build_type: "workflow" });
  const files = site?.repo.files() ?? new Map();
  expect(text(files.get("goodfellow.config.tsx"))).toContain('backend: github({ repo: "someone/parish" }),');
  expect(JSON.parse(text(files.get("package.json"))).name).toBe("parish");
  expect(files.has(".github/workflows/deploy.yml")).toBe(true);
  expect(files.has(".gitlab-ci.yml") || files.has("vercel.ts")).toBe(false);
  expect(files.has(".gitignore")).toBe(true);
  // The parish example's own blocks, and the recommended ones.
  expect(files.has("blocks/mass-times.tsx")).toBe(true);
  expect(Object.keys(JSON.parse(text(files.get("blocks/installed/installed.json"))).blocks)).toContain("shadcn-faq");
});

test("warns about private repositories on GitHub Pages and business sites on hosts that don't allow them", async ({
  page,
}) => {
  const label = (name: string) => page.locator("label", { has: page.getByRole("radio", { name, exact: true }) });
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Private", exact: true }).check();
  // Private sites are best on GitLab; Vercel is never the recommendation.
  await expect(label("GitLab")).toContainText("Recommended");
  await expect(page.getByText(/Private sites are best kept on GitLab/)).toBeVisible();
  await expect(
    page.getByText(/GitHub Pages doesn't work with private repositories on GitHub's free plan, unless/),
  ).toBeVisible();
  await expect(label("GitHub Pages")).not.toContainText("Recommended");
  await expect(label("Vercel")).not.toContainText("Recommended");
  await page.getByRole("radio", { name: "Vercel" }).check();
  await expect(
    page.getByText(/GitHub Pages doesn't work with private repositories on GitHub's free plan, unless/),
  ).toBeHidden();
  await page.getByRole("button", { name: "Use GitLab" }).click();
  await expect(page.getByRole("radio", { name: "GitLab Pages" })).toBeChecked();
  await expect(label("GitLab Pages")).toContainText("Recommended");
  await page.getByRole("radio", { name: "Public", exact: true }).check();
  await page.getByRole("radio", { name: "GitHub", exact: true }).check();

  await page.getByRole("radio", { name: "A business" }).check();
  // A business site is best kept on GitLab, and the host follows.
  await expect(page.getByRole("radio", { name: "GitHub Pages" })).toBeChecked({ checked: false });
  await page.getByRole("radio", { name: "GitLab", exact: true }).check();
  await expect(page.getByRole("radio", { name: "GitLab Pages" })).toBeChecked();
  await page.getByRole("radio", { name: "Vercel" }).check();
  await expect(page.getByText(/Vercel's free plan is for non-commercial sites only/)).toBeVisible();
});

test("creates a private project on GitLab with public GitLab Pages", async ({ page }) => {
  const gitlab = fakeGitLab({
    project: "someone/existing",
    groups: ["st-joseph"],
    tokens: { "gl-token": { username: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "GitLab", exact: true }).check();
  await page.getByRole("radio", { name: "Private", exact: true }).check();
  await page.getByRole("radio", { name: "Built-in blocks only" }).check();
  await signIn(page, "gl-token");
  await page.getByLabel("Account or group").selectOption("st-joseph");
  await page.getByLabel("Name", { exact: true }).fill("website");
  await page.getByRole("button", { name: "Create the site" }).click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Deploy → Pages" })).toHaveAttribute(
    "href",
    "https://gitlab.com/st-joseph/website/pages",
  );
  const project = gitlab.created.get("st-joseph/website");
  expect(project?.visibility).toBe("private");
  expect(project?.pagesAccessLevel).toBe("public");
  const files = project?.repo.files() ?? new Map();
  expect(text(files.get("goodfellow.config.tsx"))).toContain('backend: gitlab({ project: "st-joseph/website" }),');
  expect(files.has(".gitlab-ci.yml")).toBe(true);
  expect(files.has(".github/workflows/deploy.yml")).toBe(false);
  expect(files.has("blocks/installed/installed.json")).toBe(false);
});

test("creates a site on GitHub with its content in a repository of its own", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "In a repository of its own" }).check();
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("parish");
  await expect(
    page.getByText("The code goes in someone/parish, and the content in someone/parish-content"),
  ).toBeVisible();
  await expect(page.getByText("That name is free.")).toBeVisible();
  await page.getByRole("button", { name: "Create the site" }).click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  await expect(page.getByRole("link", { name: "someone/parish", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "someone/parish-content", exact: true })).toBeVisible();
  // GitHub Pages publishes the content repository, which builds the site.
  await expect(
    page.getByRole("link", { name: "https://someone.github.io/parish-content/", exact: true }),
  ).toBeVisible();

  const code = github.created.get("someone/parish");
  const content = github.created.get("someone/parish-content");
  expect(code?.pages).toBeUndefined();
  expect(content?.pages).toEqual({ build_type: "workflow" });
  const codeFiles = code?.repo.files() ?? new Map();
  const contentFiles = content?.repo.files() ?? new Map();
  expect(text(codeFiles.get("goodfellow.config.tsx"))).toContain(
    'backend: github({ repo: "someone/parish-content", contentOnly: true, code: "someone/parish" }),',
  );
  expect(codeFiles.has(".github/workflows/update.yml")).toBe(true);
  expect([...codeFiles.keys()].some((path) => path.startsWith("content"))).toBe(false);
  expect(text(codeFiles.get(".gitignore"))).toContain("/content-repository/");
  expect(contentFiles.has("content/site.json")).toBe(true);
  expect(text(contentFiles.get(".github/workflows/deploy.yml"))).toContain("repository: someone/parish");
  // Public repositories read each other without keys.
  expect(code?.deployKeys).toEqual([]);
});

test("creates a site's code and content projects on GitLab, letting each pipeline read the other", async ({ page }) => {
  const gitlab = fakeGitLab({
    project: "someone/existing",
    groups: ["st-joseph"],
    tokens: { "gl-token": { username: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "GitLab", exact: true }).check();
  await page.getByRole("radio", { name: "Private", exact: true }).check();
  await page.getByRole("radio", { name: "Built-in blocks only" }).check();
  await page.getByRole("radio", { name: "In a repository of its own" }).check();
  await signIn(page, "gl-token");
  await page.getByLabel("Account or group").selectOption("st-joseph");
  await page.getByLabel("Name", { exact: true }).fill("website");
  await page.getByRole("button", { name: "Create the site" }).click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Deploy → Pages" })).toHaveAttribute(
    "href",
    "https://gitlab.com/st-joseph/website-content/pages",
  );
  const code = gitlab.created.get("st-joseph/website");
  const content = gitlab.created.get("st-joseph/website-content");
  if (!code || !content) throw new Error("Not created");
  expect(code.pagesAccessLevel).toBeUndefined();
  expect(content.pagesAccessLevel).toBe("public");
  expect(code.jobTokenAllowlist).toEqual([content.id]);
  expect(content.jobTokenAllowlist).toEqual([code.id]);
  expect(code.jobTokenPush).toBe(true);
  expect(code.schedules).toHaveLength(1);
  expect(text(code.repo.files().get("goodfellow.config.tsx"))).toContain(
    'backend: gitlab({ project: "st-joseph/website-content", contentOnly: true, code: "st-joseph/website" }),',
  );
  expect(text(content.repo.files().get(".gitlab-ci.yml"))).toContain("/st-joseph/website.git");
});
