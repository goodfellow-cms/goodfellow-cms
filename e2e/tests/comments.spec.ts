import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, test } from "@playwright/test";
import { files, GITHUB_SITE, routeToFake } from "./backends.js";

test("an owner sets up comments in a project of their own and moderates them on a GitHub site", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    orgs: ["parish"],
    tokens: {
      // Like the sign-in service's tokens, it reaches only the site's own repository.
      "test-token": { login: "maria", name: "Maria", admin: true, repositories: ["parish/site"] },
      "comments-token": { login: "maria", name: "Maria" },
    },
  });
  await routeToFake(page, "https://api.github.com", fake.handle);

  await page.goto(`${GITHUB_SITE}/admin/#/settings/comments`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByLabel("Name of the new project")).toHaveValue("site-comments");
  await page.getByRole("button", { name: "Set up comments" }).click();
  // The site's sign-in can't make a repository, so the screen asks for a token that can.
  await expect(page.getByRole("link", { name: "Create a token on GitHub" })).toHaveAttribute(
    "href",
    /scopes=public_repo/,
  );
  await page.getByLabel("GitHub token").fill("comments-token");
  await page.getByRole("button", { name: "Use this token" }).click();
  await expect(page.getByText("This tab is using a GitHub token of your own for comments.")).toBeVisible();
  await page.getByRole("button", { name: "Set up comments" }).click();

  await expect(page.getByText("Last step: install Giscus")).toBeVisible();
  await expect(page.getByRole("link", { name: "Install Giscus" })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/apps\/giscus\/installations\/new\/permissions\?target_id=\d+$/,
  );
  const made = fake.created.get("parish/site-comments");
  expect(made).toMatchObject({ private: false, discussions: true });
  const settings = JSON.parse(String(fake.repo.files().get("content/site.json") ?? "{}"));
  expect(settings.comments).toEqual({
    repo: "parish/site-comments",
    repoId: `R_${made?.id}`,
    category: "Announcements",
    categoryId: made?.categories.find((category) => category.name === "Announcements")?.id,
  });
  await expect(page.getByText("No one has commented yet.")).toBeVisible();

  // Visitors comment through Giscus; coming back to the screen lists what they wrote.
  fake.addDiscussion("parish/site-comments", {
    title: "news/parish-fair",
    comments: [
      { login: "joseph", text: "See you there!", replies: [{ login: "anne", text: "Me too." }] },
      { login: "spammer", text: "Cheap watches" },
    ],
  });
  await page.evaluate(() => {
    location.hash = "#/settings/history";
  });
  await expect(page.getByRole("heading", { name: "Site history" })).toBeVisible();
  await page.evaluate(() => {
    location.hash = "#/settings/comments";
  });
  const thread = page.locator(".gfa-comments-thread");
  await expect(thread).toContainText("/news/parish-fair");
  await expect(thread).toContainText("Comments: 3");
  await thread.locator("summary").click();
  const spam = thread.locator(".gfa-comment").filter({ hasText: "Cheap watches" });
  await spam.getByRole("button", { name: "Hide" }).click();
  await page.getByRole("dialog").getByLabel("spam").check();
  await page.getByRole("dialog").getByRole("button", { name: "Hide" }).click();
  await expect(spam).toContainText("Hidden as spam");
  await spam.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("It's removed for good.");
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(spam).toHaveCount(0);
  await thread.getByRole("button", { name: "Close to new comments" }).click();
  await expect(thread).toContainText("Closed to new comments");
  const discussion = [...(fake.created.get("parish/site-comments")?.threads ?? [])][0];
  expect(discussion?.locked).toBe(true);
  expect(discussion?.comments.map((comment) => comment.text)).toEqual(["See you there!"]);
});
