import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { expect, test } from "@playwright/test";
import { files, GITHUB_SITE, GITLAB_SITE, routeToFake } from "./backends.js";

test("an owner invites, changes, and removes editors on a GitHub site with an owner token", async ({ page }) => {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: files(),
    tokens: {
      "test-token": { login: "maria", name: "Maria", admin: true },
      "owner-token": { login: "maria", admin: true, administration: true },
      "joseph-token": { login: "joseph" },
    },
    accounts: ["anne"],
  });
  await routeToFake(page, "https://api.github.com", fake.handle);

  await page.goto(`${GITHUB_SITE}/admin/#/settings/editors`);
  await page.getByLabel("Access token").fill("test-token");
  await page.getByRole("button", { name: "Sign in" }).click();

  const rows = page.locator(".gfa-editors tbody tr");
  await expect(rows.filter({ hasText: "maria" })).toContainText("Owner");
  await expect(rows.filter({ hasText: "maria" })).toContainText("You");
  await expect(rows.filter({ hasText: "joseph" })).toContainText("Editor");
  // Signing in can't change editors on GitHub, so the screen asks for an owner token first.
  await expect(page.getByRole("button", { name: "Invite" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Create an owner token on GitHub" })).toHaveAttribute(
    "href",
    /administration=write/,
  );
  await page.getByLabel("Owner token").fill("owner-token");
  await page.getByRole("button", { name: "Use this token" }).click();
  await expect(page.getByText("This tab is using an owner token.")).toBeVisible();

  await page.getByLabel("Their GitHub username").fill("anne");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(rows.filter({ hasText: "anne" })).toContainText("Invited, hasn't accepted yet");
  expect(fake.invitations.map((invitation) => invitation.login)).toEqual(["anne"]);

  await page.getByLabel("What joseph can do").selectOption("owner");
  await expect.poll(() => fake.collaborators.get("joseph")).toBe("admin");
  await rows.filter({ hasText: "joseph" }).getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(rows.filter({ hasText: "joseph" })).toHaveCount(0);
  expect(fake.collaborators.has("joseph")).toBe(false);
});

test("a Maintainer lets editors publish and invites someone by email on a GitLab site", async ({ page }) => {
  const fake = fakeGitLab({
    project: "parish/site",
    files: files(),
    tokens: {
      "glpat-test": { username: "maria", name: "Maria", accessLevel: 40 },
      "glpat-joseph": { username: "joseph", name: "Joseph", accessLevel: 30 },
    },
  });
  await routeToFake(page, "https://gitlab.com/api", fake.handle);

  await page.goto(`${GITLAB_SITE}/admin/#/settings/editors`);
  await page.getByText("Or sign in with an access token").click();
  await page.getByLabel("Access token").fill("glpat-test");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const rows = page.locator(".gfa-editors tbody tr");
  await expect(rows.filter({ hasText: "Joseph" })).toContainText("Editor");
  await expect(page.getByText(/^Editors can't publish yet/)).toBeVisible();
  await page.getByRole("button", { name: "Let editors publish" }).click();
  await expect(page.getByText(/^Editors can't publish yet/)).toHaveCount(0);
  expect(fake.protectedBranches.get("main")).toMatchObject({ push: 30, forcePush: false });

  await page.getByLabel("Their email address or GitLab username").fill("pat@example.org");
  await page.getByLabel("Can", { exact: true }).selectOption("owner");
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(rows.filter({ hasText: "pat@example.org" })).toContainText("Owner");
  expect(fake.invitations.get("pat@example.org")).toBe(40);
  await rows.filter({ hasText: "pat@example.org" }).getByRole("button", { name: "Withdraw invitation" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Withdraw invitation" }).click();
  await expect(rows.filter({ hasText: "pat@example.org" })).toHaveCount(0);
});
