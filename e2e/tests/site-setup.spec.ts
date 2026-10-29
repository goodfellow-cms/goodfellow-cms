import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { routeToFake } from "./backends.js";

// The documentation site's setup page, which creates sites in the browser: choosing on one page, creating on the next.
const SETUP = "http://localhost:4406/goodfellow-cms/new-site/";
const CREATE = "http://localhost:4406/goodfellow-cms/new-site/create/";

/** A file of a created site, as text. */
function text(file: string | Uint8Array | undefined): string {
  return typeof file === "string" ? file : new TextDecoder().decode(file);
}

const radio = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });

async function openAdvanced(page: Page) {
  await page.getByRole("button", { name: "Advanced settings" }).click();
}

async function continueToCreate(page: Page) {
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/new-site\/create\/\?/);
  await expect(page.getByRole("region", { name: "Your choices" })).toBeVisible();
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
  // Sites made from this copy of the docs have no lockfile, which the published docs have.
  await expect(page.getByText(/has no package-lock.json files/)).toBeVisible();

  // Only what the site is for, at first: everything else follows from it.
  await expect(page.getByRole("group", { name: "Start from" })).toBeHidden();
  await radio(page, "A church, charity, school or club").check();
  await radio(page, "Parish example").check();
  // GitLab is recommended for every site.
  await expect(radio(page, "GitLab")).toBeChecked();
  await expect(page.locator("label", { has: radio(page, "GitLab") })).toContainText("Recommended");
  await expect(page.getByText(/published with GitLab Pages/)).toBeVisible();
  // Keeping the files on GitHub instead says what GitLab would have given the site.
  await radio(page, "GitHub").check();
  await expect(page.getByText(/On GitLab, editors sign in with GitLab without a sign-in service/)).toBeVisible();
  // The advanced settings' defaults are said, though they're hidden.
  await expect(
    page.getByText(
      "Public files, published with GitHub Pages, with the recommended blocks, and the content kept with the code.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Blocks" })).toBeHidden();
  await openAdvanced(page);
  await expect(radio(page, "GitHub Pages")).toBeChecked();
  await expect(page.locator("label", { has: radio(page, "GitHub Pages") })).toContainText("Recommended");

  await continueToCreate(page);
  const summary = page.getByRole("region", { name: "Your choices" });
  await expect(summary).toContainText("Parish example");
  await expect(summary).toContainText("GitHub, public");
  // Signing in with GitHub isn't offered on this computer, so the token form shows straight away.
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
  await expect(page.getByText("Delete the token you made for this page")).toBeVisible();

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

test("recommends hosts whose free plans allow the site, and keeps what people chose themselves", async ({ page }) => {
  const label = (name: string) => page.locator("label", { has: radio(page, name) });
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school or club").check();
  await openAdvanced(page);
  await radio(page, "Private").check();
  // GitLab Pages publishes private sites, which kept on GitHub go on Cloudflare Pages; Vercel is never the recommendation.
  await expect(label("GitLab")).toContainText("Recommended");
  await expect(radio(page, "GitLab Pages")).toBeChecked();
  await radio(page, "GitHub").check();
  await expect(page.getByText(/a private site kept on GitHub is published with Cloudflare Pages/)).toBeVisible();
  await expect(radio(page, "Cloudflare Pages")).toBeChecked();
  await expect(label("Cloudflare Pages")).toContainText("Recommended");
  await expect(label("GitHub Pages")).not.toContainText("Recommended");
  await expect(label("Vercel")).not.toContainText("Recommended");
  // Choosing GitHub Pages anyway says why it won't work.
  await radio(page, "GitHub Pages").check();
  await expect(
    page.getByText(/GitHub Pages doesn't work with private repositories on GitHub's free plan, unless/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use GitLab" }).click();
  await expect(radio(page, "GitLab Pages")).toBeChecked();
  await expect(label("GitLab Pages")).toContainText("Recommended");

  // Choosing Vercel, then saying the site is a business's: the choice stays, with why it may not do.
  await radio(page, "Vercel").check();
  await radio(page, "A business").check();
  await expect(radio(page, "Vercel")).toBeChecked();
  await expect(page.getByText(/Vercel's free plan is for non-commercial sites only/)).toBeVisible();
  // With the advanced settings hidden, the warning still shows.
  await page.getByRole("button", { name: "Hide advanced settings" }).click();
  await expect(page.getByText(/Vercel's free plan is for non-commercial sites only/)).toBeVisible();

  // A business's files are kept on GitLab, where nobody chose otherwise, like everyone else's.
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A business").check();
  await expect(radio(page, "GitLab")).toBeChecked();
  await expect(page.getByText(/published with GitLab Pages/)).toBeVisible();

  // The create step says it too, and Change goes back with every choice as it was.
  await continueToCreate(page);
  await page.getByRole("link", { name: "Change" }).click();
  await expect(radio(page, "A business")).toBeChecked();
  await expect(radio(page, "GitLab")).toBeChecked();

  // An address without choices sends people back to make them.
  await page.goto(CREATE, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Choose the site's options" }).click();
  await expect(page.getByRole("group", { name: "What's the site for?" })).toBeVisible();
  // One with choices that aren't any falls back to the defaults.
  await page.goto(`${CREATE}?purpose=personal&git=bitbucket&host=netlify`, { waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Your choices" })).toContainText("GitLab Pages");
});

test("creates a private project on GitLab with public GitLab Pages", async ({ page }) => {
  const gitlab = fakeGitLab({
    project: "someone/existing",
    groups: ["st-joseph"],
    tokens: { "gl-token": { username: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school or club").check();
  await radio(page, "GitLab").check();
  await openAdvanced(page);
  await radio(page, "Private").check();
  await radio(page, "Built-in blocks only").check();
  await continueToCreate(page);

  // Sign in with GitLab comes first; the token form only once it's asked for.
  await expect(page.getByRole("button", { name: "Sign in with GitLab" })).toBeVisible();
  await expect(page.getByPlaceholder("Paste the token here")).toBeHidden();
  await page.getByRole("button", { name: "paste a token" }).click();
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
  await radio(page, "A church, charity, school or club").check();
  await radio(page, "GitHub").check();
  await openAdvanced(page);
  await radio(page, "In a repository of its own").check();
  await continueToCreate(page);
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
  await radio(page, "A church, charity, school or club").check();
  await radio(page, "GitLab").check();
  await openAdvanced(page);
  await radio(page, "Private").check();
  await radio(page, "Built-in blocks only").check();
  await radio(page, "In a repository of its own").check();
  await continueToCreate(page);
  await page.getByRole("button", { name: "paste a token" }).click();
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

test("creates a site on GitLab with a sign-in page of its own, on the project's unique domain", async ({ page }) => {
  const gitlab = fakeGitLab({ project: "someone/existing", tokens: { "gl-token": { username: "someone" } } });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school or club").check();
  await openAdvanced(page);
  await radio(page, "At a sign-in page of its own").check();
  await expect(radio(page, "GitLab Pages, at an address GitLab gives it")).toBeChecked();
  await expect(page.getByText(/Editors sign in at a sign-in page of its own, on GitLab Pages/)).toBeVisible();
  await continueToCreate(page);
  await expect(page.getByRole("region", { name: "Your choices" })).toContainText("At a sign-in page of its own");

  await page.getByRole("button", { name: "paste a token" }).click();
  await signIn(page, "gl-token");
  await page.getByLabel("Name", { exact: true }).fill("parish");
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  await expect(page.getByText("Editors' sign-in page is in")).toBeVisible();

  // The broker's own project, from the released page, naming the site it signs in to.
  const broker = gitlab.created.get("someone/parish-signin");
  expect(broker?.visibility).toBe("public");
  const files = broker?.repo.files() ?? new Map();
  expect(files.has("site/index.html")).toBe(true);
  expect(JSON.parse(text(files.get("site/broker.json")))).toEqual({
    sites: [{ package: "@goodfellow-cms/gitlab", export: "gitlab", options: { project: "someone/parish" } }],
  });
  expect(text(files.get(".gitlab-ci.yml"))).toContain("publish: site");
  // The site doesn't sign in there until its address is set, once both are online.
  const site = gitlab.created.get("someone/parish")?.repo.files() ?? new Map();
  expect(text(site.get("goodfellow.config.tsx"))).not.toContain("broker:");
});

test("recommends a sign-in page of its own, or with a domain chooses an admin address", async ({ page }) => {
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school or club").check();
  await openAdvanced(page);
  const signIn = (name: string) => page.locator("label", { has: radio(page, name) });
  // Without a domain, editors sign in at the site's address unless the owner chooses otherwise.
  await expect(radio(page, "In the admin panel, at the site's address")).toBeChecked();
  await expect(signIn("At a sign-in page of its own")).toContainText("Recommended");
  await expect(signIn("At an admin address of its own")).not.toContainText("Recommended");

  await page.getByRole("checkbox", { name: "I have a domain for this site" }).check();
  await expect(radio(page, "At an admin address of its own")).toBeChecked();
  await expect(signIn("At an admin address of its own")).toContainText("Recommended");
  await expect(page.getByRole("link", { name: "Continue" })).toBeHidden();
  // GitHub Pages can't serve one, so the sign-in page is recommended there, and the choice goes back.
  await radio(page, "GitHub").check();
  await radio(page, "GitHub Pages").check();
  await expect(radio(page, "At an admin address of its own")).toHaveCount(0);
  await expect(radio(page, "In the admin panel, at the site's address")).toBeChecked();
  await expect(signIn("At a sign-in page of its own")).toContainText("Recommended");
});

test("names an admin address of its own in a new site's config", async ({ page }) => {
  const gitlab = fakeGitLab({ project: "someone/existing", tokens: { "gl-token": { username: "someone" } } });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school or club").check();
  await openAdvanced(page);
  await radio(page, "At an admin address of its own").check();
  await expect(page.getByRole("link", { name: "Continue" })).toBeHidden();
  await page.getByPlaceholder("https://admin.example.org").fill("https://admin.parish.example.org");
  await continueToCreate(page);
  await page.getByRole("button", { name: "paste a token" }).click();
  await signIn(page, "gl-token");
  await page.getByLabel("Name", { exact: true }).fill("parish");
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  const site = gitlab.created.get("someone/parish")?.repo.files() ?? new Map();
  expect(text(site.get("goodfellow.config.tsx"))).toContain('  admin: { url: "https://admin.parish.example.org" },');
});
