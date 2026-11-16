import { setupCodeHash } from "@goodfellow-cms/core";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, type Route, test } from "@playwright/test";
import { routeToFake } from "./backends.js";

// The documentation site's setup page, which creates sites in the browser: choosing on one page, creating on the next.
const SETUP = "http://localhost:4406/goodfellow-cms/new-site/";
const CREATE = "http://localhost:4406/goodfellow-cms/new-site/create/";
const FULL_STACK = "http://localhost:4406/goodfellow-cms/new-site/full-stack/";

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
  await radio(page, "A church, charity, school, or club").check();
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
  await radio(page, "A church, charity, school, or club").check();
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
  await page.goto(`${CREATE}?purpose=personal&git=bitbucket&host=nowhere`, { waitUntil: "networkidle" });
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
  await radio(page, "A church, charity, school, or club").check();
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
  await radio(page, "A church, charity, school, or club").check();
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
  await radio(page, "A church, charity, school, or club").check();
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
  expect(code.deployKeys).toEqual([expect.objectContaining({ title: "Goodfellow publishing", mayPush: true })]);
  expect(code.schedules).toHaveLength(1);
  expect(text(code.repo.files().get("goodfellow.config.tsx"))).toContain(
    'backend: gitlab({ project: "st-joseph/website-content", contentOnly: true, code: "st-joseph/website" }),',
  );
  expect(text(content.repo.files().get(".gitlab-ci.yml"))).toContain("/st-joseph/website.git");
});

test("says what's left to connect on GitLab, where it refuses a step, and where to do it", async ({ page }) => {
  const gitlab = fakeGitLab({
    project: "someone/existing",
    groups: ["st-joseph"],
    tokens: { "gl-token": { username: "someone", name: "Some One" } },
    refuseConnections: ["schedule"],
  });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school, or club").check();
  await radio(page, "GitLab").check();
  await openAdvanced(page);
  await radio(page, "Built-in blocks only").check();
  await radio(page, "In a repository of its own").check();
  await continueToCreate(page);
  await page.getByRole("button", { name: "paste a token" }).click();
  await signIn(page, "gl-token");
  await page.getByLabel("Account or group").selectOption("st-joseph");
  await page.getByLabel("Name", { exact: true }).fill("website");
  await page.getByRole("button", { name: "Create the site" }).click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  const left = page.getByRole("alert").filter({ hasText: "What's left" });
  await expect(left).toContainText("In st-joseph/website,");
  await expect(left.getByRole("link", { name: "add a pipeline schedule" })).toHaveAttribute(
    "href",
    "https://gitlab.com/st-joseph/website/-/pipeline_schedules/new",
  );
  await left.getByText("Details").click();
  await expect(left).toContainText("st-joseph/website's nightly schedule: GitLab answered 400");
  // Everything else was connected all the same.
  const code = gitlab.created.get("st-joseph/website");
  expect(code?.deployKeys).toHaveLength(1);
  expect(code?.jobTokenAllowlist).toHaveLength(1);
});

test("creates a site on GitLab with a sign-in page of its own, on the project's unique domain", async ({ page }) => {
  const gitlab = fakeGitLab({ project: "someone/existing", tokens: { "gl-token": { username: "someone" } } });
  await routeToFake(page, "https://gitlab.com", gitlab.handle);
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await radio(page, "A church, charity, school, or club").check();
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
  await radio(page, "A church, charity, school, or club").check();
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
  await radio(page, "A church, charity, school, or club").check();
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

test("creates a full-stack site's code and content on a page of its own, with a setup code shown once", async ({
  page,
}) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // The static sites' page links to it, and it back.
  await page.goto(SETUP, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Create a full-stack site" }).click();
  await expect(page).toHaveURL(FULL_STACK);
  await expect(page.getByRole("link", { name: "create a static site" })).toBeVisible();

  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  // An address that isn't https:// and a domain alone can't be used; an empty one can (see the next test).
  const create = page.getByRole("button", { name: "Create the site" });
  await page.getByLabel("The site's address").fill("http://acme.example/page");
  await expect(page.getByText(/is https:\/\/ and a domain/)).toBeVisible();
  await expect(create).toBeDisabled();
  await page.getByLabel("The site's address").fill("https://www.acme.example");
  await create.click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  const setupCode =
    (await page
      .locator("code")
      .filter({ hasText: /^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/ })
      .textContent()) ?? "";
  expect(setupCode).not.toBe("");

  // The publishing app: made on GitHub's page in a new tab, which comes back to the return page, which tells this one.
  const manifests = new Map<string, { redirect_url: string; setup_url: string }>();
  await page.context().route("https://github.com/settings/apps/new?*", async (route) => {
    const state = new URL(route.request().url()).searchParams.get("state") ?? "";
    const manifest = JSON.parse(new URLSearchParams(route.request().postData() ?? "").get("manifest") ?? "{}");
    expect(manifest.default_permissions).toEqual({ contents: "write", metadata: "read" });
    expect(manifest.public).toBe(false);
    const { code, app } = await github.createApp(manifest, "someone");
    manifests.set(app.slug, manifest);
    await route.fulfill({ status: 302, headers: { location: `${manifest.redirect_url}?code=${code}&state=${state}` } });
  });
  // Installing it: first on the code too, as someone might, then on the content alone.
  let installOn = ["someone/acme-content", "someone/acme"];
  await page.context().route("https://github.com/apps/*/installations/new?*", async (route) => {
    const url = new URL(route.request().url());
    const slug = url.pathname.split("/")[2] ?? "";
    const { installation } = github.install(slug, "someone", installOn);
    const back = `${manifests.get(slug)?.setup_url}?installation_id=${installation}&setup_action=install&state=${url.searchParams.get("state")}`;
    await route.fulfill({ status: 302, headers: { location: back } });
  });
  const online = page.getByRole("button", { name: "Put the site online" });
  await expect(online).toBeDisabled();
  const madeTab = page.context().waitForEvent("page");
  await page.getByRole("button", { name: "Make the publishing app" }).click();
  const returned = await madeTab;
  await expect(returned.getByText("The app is made.")).toBeVisible();
  // The return page takes GitHub's code out of its address.
  expect(new URL(returned.url()).search).toBe("");
  await returned.close();
  await expect(page.getByText(/Made, and its key saved in someone\/acme's secrets/)).toBeVisible();
  const code = github.created.get("someone/acme");
  const app = github.apps.at(-1);
  expect(code?.secrets.get("GOODFELLOW_APP_ID")).toBe(app?.id);
  expect(code?.secrets.get("GOODFELLOW_APP_KEY")).toContain("BEGIN RSA PRIVATE KEY");
  const installTab = page.context().waitForEvent("page");
  await page.getByRole("link", { name: "Install it on someone/acme-content" }).click();
  await (await installTab).close();
  await expect(page.getByText(/installed on other repositories besides someone\/acme-content/)).toBeVisible();
  // Put right on GitHub, then checked again.
  const installed = app?.installations.at(-1);
  if (installed) installed.repositories = ["someone/acme-content"];
  installOn = ["someone/acme-content"];
  await page.getByRole("button", { name: "I've installed it: check again" }).click();
  await expect(page.getByText(/Installed on someone\/acme-content alone/)).toBeVisible();
  // The check's tokens are revoked.
  expect(github.issued.filter((issued) => issued.app === app?.slug).every((issued) => issued.revoked)).toBe(true);

  // Cloudflare's token, pasted and saved as the code's secret.
  await page.getByPlaceholder("Paste the Cloudflare token here").fill("cloudflare-token");
  await page.getByRole("button", { name: "Save it" }).click();
  await expect(page.getByText("Saved in someone/acme's secrets.")).toBeVisible();
  expect(code?.secrets.get("CLOUDFLARE_API_TOKEN")).toBe("cloudflare-token");
  await online.click();
  await expect(page.getByText(/Started: follow it on/)).toBeVisible();
  expect(code?.dispatched).toEqual([{ workflow: ".github/workflows/setup-cloudflare.yml", ref: "main" }]);
  // The first admin's link carries the setup code where browsers never send it.
  await expect(page.getByRole("link", { name: "open https://www.acme.example/setup/" })).toHaveAttribute(
    "href",
    `https://www.acme.example/setup/#code=${setupCode}`,
  );

  const content = github.created.get("someone/acme-content");
  // Private by default, so the code's Deploy workflow reads the content with a key of its own.
  expect(code?.private).toBe(true);
  expect(content?.private).toBe(true);
  expect(code?.pages).toBeUndefined();
  expect(content?.deployKeys).toEqual([expect.objectContaining({ read_only: true })]);
  expect(code?.secrets.get("GOODFELLOW_CONTENT_KEY")).toContain("OPENSSH PRIVATE KEY");
  const codeFiles = code?.repo.files() ?? new Map();
  const contentFiles = content?.repo.files() ?? new Map();
  expect(text(codeFiles.get("goodfellow.config.tsx"))).toContain(
    'github({ repo: "someone/acme-content", contentOnly: true })',
  );
  expect(text(codeFiles.get(".github/workflows/deploy.yml"))).toContain("repository: someone/acme-content");
  expect(codeFiles.has(".github/workflows/setup-cloudflare.yml")).toBe(true);
  expect(text(codeFiles.get("README.md"))).toContain("Goodfellow's setup page made this site");
  // Only the setup code's hash is kept, which the code the page showed matches.
  const wrangler = text(codeFiles.get("wrangler.jsonc"));
  expect(wrangler).toContain('"name": "acme"');
  expect(wrangler).toContain('"GOODFELLOW_SITE_URL": "https://www.acme.example"');
  expect(wrangler).toContain(`"GOODFELLOW_SETUP_CODE_HASH": "${await setupCodeHash(setupCode)}"`);
  expect(wrangler).not.toContain(setupCode);
  expect([...codeFiles.keys()].some((path) => path.startsWith("content/"))).toBe(false);
  expect(contentFiles.has("content/site.json")).toBe(true);
  // The content runs no workflows and holds no secrets.
  expect([...contentFiles.keys()].some((path) => path.startsWith(".github/"))).toBe(false);
  expect(content?.secrets.size).toBe(0);
});

test("creates a full-stack site at the Worker's own address, and carries on with what it made after a failure", async ({
  page,
}) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // GitHub refuses the content's repository once, and every repository named "other".
  let refusedContent = false;
  await page.route("https://api.github.com/user/repos", async (route) => {
    const name = (route.request().postDataJSON() as { name?: string } | null)?.name;
    if (name === "other" || (name === "acme-content" && !refusedContent)) {
      refusedContent ||= name === "acme-content";
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
      return;
    }
    await route.fallback();
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  const name = page.getByLabel("Name", { exact: true });
  const create = page.getByRole("button", { name: "Create the site" });
  await name.fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  // No address: the Worker's own, on workers.dev, which Set up Cloudflare writes in.
  await expect(page.getByText(/https:\/\/acme\.<your-subdomain>\.workers\.dev/)).toBeVisible();
  await create.click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  expect(github.created.has("someone/acme")).toBe(true);
  // Made already: trying again makes only its content, with what the code's has, so its settings aren't asked again.
  await expect(page.getByText(/someone\/acme is created already/)).toBeVisible();
  await expect(page.getByLabel("The site's address")).toBeHidden();
  // Another name that fails, then the first again, keeps the first's setup code.
  await name.fill("other");
  await expect(page.getByLabel("The site's address")).toBeVisible();
  await page.getByLabel("The site's address").fill("https://www.other.example");
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  await name.fill("acme");
  await create.click();

  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  const setupCode =
    (await page
      .locator("code")
      .filter({ hasText: /^[A-Z2-7]{4}(-[A-Z2-7]{4}){5}$/ })
      .textContent()) ?? "";
  const wrangler = text(github.created.get("someone/acme")?.repo.files().get("wrangler.jsonc"));
  expect(wrangler).toContain(`"GOODFELLOW_SETUP_CODE_HASH": "${await setupCodeHash(setupCode)}"`);
  // Still the example's address, which Set up Cloudflare replaces with the Worker's own.
  expect(wrangler).toContain('"GOODFELLOW_SITE_URL": "https://www.example.com"');
  await expect(page.getByText("https://acme.<your-subdomain>.workers.dev", { exact: true })).toBeVisible();
  await expect(page.getByText("The domain.")).toHaveCount(0);
  await expect(page.getByText(/To use a domain of your own later/)).toBeVisible();
  expect(github.created.has("someone/acme-content")).toBe(true);
});

test("never takes a name's availability from an answer about a name typed before", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // "taken" exists, and GitHub says so slowly.
  await page.route(/https:\/\/api\.github\.com\/repos\/someone\/taken(-content)?$/, async (route) => {
    await new Promise((done) => setTimeout(done, 2_000));
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"full_name":"someone/taken"}' });
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  const name = page.getByLabel("Name", { exact: true });
  await name.fill("taken");
  // Past the wait before asking, so GitHub has been asked about "taken".
  await page.waitForTimeout(700);
  await name.fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await page.waitForTimeout(2_500);
  await expect(page.getByText("That name is free.")).toBeVisible();
  await expect(page.getByText(/There's already one called/)).toHaveCount(0);
});

test("says what to do about a code repository it made before a reload, which it can't finish", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  await page.route("https://api.github.com/user/repos", async (route) => {
    const name = (route.request().postDataJSON() as { name?: string } | null)?.name;
    if (name === "acme-content") {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
      return;
    }
    await route.fallback();
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  // The tab keeps which repositories were made, never the setup code, which only the page's memory has.
  const kept = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
  expect(kept).toContain("someone/acme");
  expect(kept).not.toMatch(/[A-Z2-7]{4}(-[A-Z2-7]{4}){5}|setupCode|[0-9a-f]{64}/);
  // A reload, or signing in again, which leave the page.
  await page.reload({ waitUntil: "networkidle" });
  const unfinished = page.getByRole("alert").filter({ hasText: "for a site it didn't finish" });
  await expect(unfinished).toContainText("This page created someone/acme");
  await expect(unfinished).toContainText("Delete someone/acme on GitHub");
  await expect(unfinished.getByRole("link", { name: "someone/acme" })).toBeVisible();
  await signIn(page, "gh-token");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("acme");
  await unfinished.getByRole("button", { name: /I've deleted it/ }).click();
  await expect(unfinished).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("for a site it didn't finish")).toHaveCount(0);
});

test("says what it may have made where it was reloaded before GitHub answered", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // GitHub takes the request to make the repository, and the page is left before it answers.
  let asked = false;
  await page.route("https://api.github.com/user/repos", async (route) => {
    if ((route.request().postDataJSON() as { name?: string } | null)?.name !== "acme") return route.fallback();
    asked = true;
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect.poll(() => asked).toBe(true);
  await page.reload({ waitUntil: "networkidle" });
  const unfinished = page.getByRole("alert").filter({ hasText: "may have created" });
  await expect(unfinished).toContainText("This page may have created someone/acme");
  await expect(unfinished).toContainText("Look on GitHub at who made it and when");
  await expect(unfinished).not.toContainText("for a site it didn't finish");
  await unfinished.getByRole("button", { name: /I've deleted it/ }).click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("may have created")).toHaveCount(0);
});

test("says what it may have made where the name check hadn't answered and GitHub's answer was lost", async ({
  page,
}) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  const refuse = (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
  // Whether acme is free doesn't answer while it's typed, and GitHub makes acme but its answer is lost.
  let answering = false;
  await page.route("https://api.github.com/repos/someone/acme", (route) =>
    answering ? route.fallback() : refuse(route),
  );
  await page.route("https://api.github.com/user/repos", async (route) => {
    const request = route.request();
    if ((request.postDataJSON() as { name?: string } | null)?.name !== "acme") return route.fallback();
    await github.handle(
      new Request(request.url(), { method: "POST", headers: request.headers(), body: request.postData() ?? "" }),
    );
    await refuse(route);
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await page.getByLabel("The site's address").fill("https://www.acme.example");
  await page.waitForTimeout(1000);
  answering = true;
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  expect(github.created.has("someone/acme")).toBe(true);
  // The name check afterwards finds it there, but it never said the name was free, so it may be anyone's.
  const unfinished = page.getByRole("alert").filter({ hasText: "may have created" });
  await expect(unfinished).toContainText("This page may have created someone/acme, which GitHub never confirmed");
  await expect(unfinished).not.toContainText("for a site it didn't finish");
  await page.reload({ waitUntil: "networkidle" });
  await expect(unfinished).toContainText("This page may have created someone/acme");
});

test("never says it made a repository GitHub refused as someone else's", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // Whether "existing" is free doesn't answer while it's typed, then does when the site is created: it's taken.
  let answering = false;
  await page.route("https://api.github.com/repos/someone/existing", (route) =>
    answering
      ? route.fallback()
      : route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' }),
  );
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("existing");
  await page.getByLabel("The site's address").fill("https://www.existing.example");
  await page.waitForTimeout(1000);
  answering = true;
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /already/ })).toBeVisible();
  await expect(page.getByText(/created someone\/existing|may have created/)).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText(/created someone\/existing|may have created/)).toHaveCount(0);
});

test("never says it made a repository that was there before, where no check answered until after", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // Whether "existing" is free doesn't answer while it's typed, nor as the site is created, so it's never asked for;
  // only the check after the failure answers: it's there.
  let clicked = false;
  let asked = 0;
  await page.route("https://api.github.com/repos/someone/existing", (route) => {
    if (clicked && ++asked > 1) return route.fallback();
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("existing");
  await page.getByLabel("The site's address").fill("https://www.existing.example");
  await page.waitForTimeout(1000);
  clicked = true;
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect.poll(() => asked).toBeGreaterThan(1);
  const unfinished = page.getByRole("alert").filter({ hasText: "may have created" });
  await expect(unfinished).toContainText("This page may have created someone/existing");
  await expect(page.getByText("This page created someone/existing")).toHaveCount(0);
});

test("makes the site afresh where the code's repository it would carry on with was deleted", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  let refusedContent = false;
  await page.route("https://api.github.com/user/repos", async (route) => {
    const name = (route.request().postDataJSON() as { name?: string } | null)?.name;
    if (name === "acme-content" && !refusedContent) {
      refusedContent = true;
      return route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
    }
    await route.fallback();
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await page.getByLabel("The site's address").fill("https://www.acme.example");
  await expect(page.getByText("That name is free.")).toBeVisible();
  const create = page.getByRole("button", { name: "Create the site" });
  await create.click();
  await expect(page.getByText(/someone\/acme is created already/)).toBeVisible();
  // Deleted on GitHub, as the page says to do to change the site's settings.
  github.created.delete("someone/acme");
  // Where GitHub can't say whether it's there, the page makes nothing, and asks again.
  let unanswered = true;
  await page.route("https://api.github.com/repos/someone/acme", (route) =>
    unanswered
      ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' })
      : route.fallback(),
  );
  await create.click();
  await expect(page.getByText("GitHub couldn't say whether someone/acme is still there")).toBeVisible();
  expect(github.created.has("someone/acme-content")).toBe(false);
  unanswered = false;
  await create.click();
  await expect(page.getByText("someone/acme isn't on GitHub any more, so the site will be made afresh")).toBeVisible();
  expect(github.created.has("someone/acme-content")).toBe(false);
  // Its settings are asked again, and both repositories are made with what's typed now.
  await page.getByLabel("The site's address").fill("https://www.acme.example.org");
  await create.click();
  await expect(page.getByRole("heading", { name: "Your site has been created" })).toBeVisible();
  expect(text(github.created.get("someone/acme")?.repo.files().get("wrangler.jsonc"))).toContain(
    '"GOODFELLOW_SITE_URL": "https://www.acme.example.org"',
  );
  expect(github.created.has("someone/acme-content")).toBe(true);
});

test("never says it made a repository someone else made after the name was checked", async ({ page }) => {
  const github = fakeGitHub({
    repo: "someone/existing",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  // acme is free while it's typed. As the site is created, someone else makes it and the check before creating
  // fails, so the page never asks for it; the check after the failure finds theirs.
  let clicked = false;
  let asked = 0;
  await page.route("https://api.github.com/repos/someone/acme", async (route) => {
    if (!clicked || ++asked > 1) return route.fallback();
    await github.handle(
      new Request("https://api.github.com/user/repos", {
        method: "POST",
        headers: { authorization: "Bearer gh-token", "content-type": "application/json" },
        body: JSON.stringify({ name: "acme", auto_init: true }),
      }),
    );
    await route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
  });
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  await page.getByLabel("Name", { exact: true }).fill("acme");
  await page.getByLabel("The site's address").fill("https://www.acme.example");
  await expect(page.getByText("That name is free.")).toBeVisible();
  clicked = true;
  await page.getByRole("button", { name: "Create the site" }).click();
  await expect.poll(() => asked).toBeGreaterThan(1);
  expect(github.created.has("someone/acme")).toBe(true);
  const unfinished = page.getByRole("alert").filter({ hasText: "may have created" });
  await expect(unfinished).toContainText("This page may have created someone/acme");
  await expect(page.getByText("This page created someone/acme")).toHaveCount(0);
});

test("never carries on with another sign-in, and says what GitHub made where a repository's setup stopped part way", async ({
  page,
}) => {
  // New repositories start on master, so their setup moves them to main first.
  const github = fakeGitHub({
    repo: "someone/existing",
    newRepoBranch: "master",
    tokens: { "gh-token": { login: "someone", name: "Some One" } },
  });
  await routeToFake(page, "https://api.github.com", github.handle);
  const refuse = (route: Route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Server Error"}' });
  // GitHub makes every repository, but refuses acme-content's once. Once it has made other, it refuses moving it to
  // main, and then saying whether the name is taken, so only being told it was made can say so.
  let refusedContent = false;
  let madeOther = false;
  await page.route("https://api.github.com/user/repos", async (route) => {
    const name = (route.request().postDataJSON() as { name?: string } | null)?.name;
    if (name === "acme-content" && !refusedContent) {
      refusedContent = true;
      return refuse(route);
    }
    madeOther ||= name === "other";
    await route.fallback();
  });
  await page.route(/^https:\/\/api\.github\.com\/repos\/someone\/other(\/git\/ref\/.*)?$/, (route) =>
    madeOther ? refuse(route) : route.fallback(),
  );
  await page.goto(FULL_STACK, { waitUntil: "networkidle" });
  await signIn(page, "gh-token");
  const name = page.getByLabel("Name", { exact: true });
  const create = page.getByRole("button", { name: "Create the site" });
  await name.fill("acme");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await create.click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  await expect(page.getByText(/someone\/acme is created already/)).toBeVisible();
  // Another sign-in can't connect the repository this one made, so the page says what's left rather than carry on.
  await page.getByRole("button", { name: "Use another account" }).click();
  await signIn(page, "gh-token");
  const unfinished = page.getByRole("alert").filter({ hasText: "for a site it didn't finish" });
  await expect(unfinished).toContainText("This page created someone/acme");
  await expect(page.getByText(/someone\/acme is created already/)).toHaveCount(0);
  // A repository GitHub made whose setup stopped straight after is listed too, beside the first.
  await name.fill("other");
  await page.getByLabel("The site's address").fill("https://www.other.example");
  await expect(page.getByText("That name is free.")).toBeVisible();
  await create.click();
  await expect(page.getByRole("alert").filter({ hasText: "Something went wrong" })).toBeVisible();
  expect(github.created.has("someone/other")).toBe(true);
  await expect(unfinished).toContainText("This page created someone/acme and someone/other");
  await page.reload({ waitUntil: "networkidle" });
  await expect(unfinished).toContainText("This page created someone/acme and someone/other");
});
