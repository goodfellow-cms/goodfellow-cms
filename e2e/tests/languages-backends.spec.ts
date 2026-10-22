import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, type Page, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";

/** The starter with a second language, Spanish. */
function spanishFiles(): Record<string, string> {
  const all = files();
  const settings = JSON.parse(all["content/site.json"] ?? "{}");
  return {
    ...all,
    "content/site.json": `${JSON.stringify(
      { ...settings, languages: [{ code: "es", name: "Español" }], translations: { es: { title: "Mi sitio" } } },
      null,
      2,
    )}\n`,
  };
}

interface Host {
  name: string;
  site: string;
  /** Signs in with a token, and gives the files on the fake host. */
  signIn: (page: Page) => Promise<() => ReadonlyMap<string, unknown>>;
}

const hosts: Host[] = [
  {
    name: "GitHub",
    site: GITHUB_SITE,
    signIn: async (page) => {
      const fake = fakeGitHub({
        repo: "parish/site",
        files: spanishFiles(),
        tokens: { "good-token": { login: "maria" } },
      });
      await routeToFake(page, "https://api.github.com", fake.handle);
      await page.goto(`${GITHUB_SITE}/admin/`);
      await page.getByLabel("Access token").fill("good-token");
      await page.getByRole("button", { name: "Sign in" }).click();
      return () => fake.repo.files();
    },
  },
  {
    name: "GitLab",
    site: GITLAB_SITE,
    signIn: async (page) => {
      const fake = fakeGitLab({
        project: "parish/site",
        files: spanishFiles(),
        tokens: { "glpat-test": { username: "maria" } },
      });
      await routeToFake(page, "https://gitlab.com/api", fake.handle);
      await page.goto(`${GITLAB_SITE}/admin/`);
      await page.getByText("Or sign in with an access token").click();
      await page.getByLabel("Access token").fill("glpat-test");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      return () => fake.repo.files();
    },
  },
];

/** The editor's language menu, beside Publish. */
const language = (page: Page) => page.locator(".gfa-header-actions").getByLabel("Language");
const canvas = (page: Page) => page.frameLocator("iframe#preview-frame");

for (const host of hosts) {
  test(`translates a page from its editor, and gives Spanish a footer of its own, on ${host.name}`, async ({
    page,
  }) => {
    const repo = await host.signIn(page);
    await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();

    // The editor's language menu offers to translate the page.
    await page.goto(`${host.site}/admin/#/pages/edit?path=%2Fabout`);
    await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
    await expect(language(page).locator("option")).toHaveText(["English", "Translate into Español…"]);
    await language(page).selectOption("es");
    await page.getByRole("dialog").getByRole("button", { name: "Make the copy" }).click();

    // The copy opens, in Spanish, and the menu goes back to the English page.
    await expect(page).toHaveURL(/path=%2Fes%2Fabout/);
    await expect(canvas(page).getByRole("heading", { name: "About us" })).toBeVisible();
    expect(JSON.parse(String(repo().get("content/pages/es/about.json")))).toMatchObject({ translationOf: "/about" });
    await expect(language(page)).toHaveValue("es");
    await language(page).selectOption("en");
    await expect(page).toHaveURL(/path=%2Fabout$/);
    await expect(language(page).locator("option")).toHaveText(["English", "Español"]);

    // Spanish starts with the main language's footer, until it has one of its own.
    await page.goto(`${host.site}/admin/#/layout/footer?language=es`);
    await page.getByRole("button", { name: "Make a footer for Español" }).click();
    await expect(canvas(page).getByText("Built with Goodfellow")).toBeVisible();
    expect(repo().get("content/layout/footer.es.json")).toBe(repo().get("content/layout/footer.json"));
  });
}
