import { type StorageLike, separateSetupLinks } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { gitlabSetup } from "./setup.js";
import { fakeGitLab } from "./testing.js";

const files = [
  { path: "package.json", content: "{}\n" },
  { path: ".gitlab-ci.yml", content: "pages:\n" },
  { path: "public/media/logo.png", bytes: new Uint8Array([137, 80, 78, 71, 0, 255]) },
];

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe("gitlabSetup", () => {
  it("creates a private project with public Pages and every file in one commit", async () => {
    const fake = fakeGitLab({
      project: "someone/existing",
      groups: ["st-joseph"],
      tokens: { t: { username: "someone" } },
    });
    const account = await gitlabSetup({ fetch: fake.fetch }).signInWithToken("t");
    const owners = await account.owners();
    expect(owners.map((owner) => [owner.path, owner.kind])).toEqual([
      ["someone", "personal"],
      ["st-joseph", "organization"],
    ]);
    const group = owners[1];
    if (!group) throw new Error("no group");
    const steps: string[] = [];
    const result = await account.createSite(
      { owner: group, name: "parish", private: true, pages: true, files, message: "Create the site" },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["repository", "files"]);
    expect(result).toEqual({
      repo: "st-joseph/parish",
      webUrl: "https://gitlab.com/st-joseph/parish",
      buildsUrl: "https://gitlab.com/st-joseph/parish/-/pipelines",
      pagesUrl: "https://gitlab.com/st-joseph/parish/pages",
      warnings: [],
    });
    const project = fake.created.get("st-joseph/parish");
    expect(project?.visibility).toBe("private");
    expect(project?.pagesAccessLevel).toBe("public");
    const head = project?.repo.commitAt(project.repo.head("main"));
    expect(head?.message).toBe("Create the site");
    expect(head?.files.get("public/media/logo.png")).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
    await expect(
      account.createSite({ owner: group, name: "parish", private: true, pages: true, files, message: "Again" }),
    ).rejects.toMatchObject({ problem: "name-taken" });
  });

  it("gives a project's Pages a domain of its own, such as a token broker's, warning when GitLab won't take it", async () => {
    const fake = fakeGitLab({
      project: "someone/existing",
      tokens: { t: { username: "someone" } },
      takenDomains: ["taken.example.org"],
    });
    const account = await gitlabSetup({ fetch: fake.fetch }).signInWithToken("t");
    const [owner] = await account.owners();
    if (!owner) throw new Error("no owner");
    const site = { owner, private: false, pages: true, files, message: "Add the sign-in page" };
    const result = await account.createSite({ ...site, name: "signin", domain: "signin.example.org" });
    expect(result.siteUrl).toBe("https://signin.example.org/");
    expect(fake.created.get("someone/signin")?.pagesDomains).toEqual(["signin.example.org"]);
    const taken = await account.createSite({ ...site, name: "other", domain: "taken.example.org" });
    expect(taken.siteUrl).toBeUndefined();
    expect(taken.warnings).toEqual(["domain-unavailable"]);
  });

  it("connects a site's code and content projects: job token allowlists, pushes and a nightly schedule", async () => {
    const fake = fakeGitLab({
      project: "someone/existing",
      groups: ["st-joseph"],
      tokens: { t: { username: "someone" } },
    });
    const account = await gitlabSetup({ fetch: fake.fetch }).signInWithToken("t");
    const group = (await account.owners())[1];
    if (!group) throw new Error("no group");
    const base = { owner: group, private: false, files, message: "Create" };
    await account.createSite({ ...base, name: "site", pages: false, more: true });
    const steps: string[] = [];
    const result = await account.createSite(
      {
        ...base,
        name: "site-content",
        pages: true,
        link: {
          code: "st-joseph/site",
          content: "st-joseph/site-content",
          private: false,
          links: separateSetupLinks({ git: "gitlab", host: "gitlab-pages", build: "content" }),
        },
      },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["repository", "connect", "files"]);
    expect(result.warnings).toEqual([]);
    const code = fake.created.get("st-joseph/site");
    const content = fake.created.get("st-joseph/site-content");
    if (!code || !content) throw new Error("not created");
    // Each pipeline clones the other project with its job token, even where the projects are public.
    expect(code.jobTokenAllowlist).toEqual([content.id]);
    expect(content.jobTokenAllowlist).toEqual([code.id]);
    expect(code.jobTokenPush).toBe(true);
    expect(content.jobTokenPush).toBe(false);
    expect(code.schedules).toEqual([expect.objectContaining({ ref: "main", cron: "17 4 * * *", active: true })]);
    expect(content.schedules).toEqual([]);
  });

  it("signs in by redirect with PKCE, keeping nothing but the pending sign-in", async () => {
    const fake = fakeGitLab({
      project: "someone/existing",
      oauth: { clientId: "app", user: { username: "someone", name: "Some One" } },
    });
    let href = "https://docs.example/new-site/";
    const location = {
      href: () => href,
      assign: (url: string) => {
        href = fake.authorize(url);
      },
      replace: (url: string) => {
        href = url;
      },
    };
    const session = memoryStorage();
    const local = memoryStorage();
    const host = gitlabSetup({ clientId: "app", fetch: fake.fetch, location, storage: { session, local } });
    expect(host.canRedirect).toBe(true);
    expect(await host.restore()).toBeNull();
    await host.startRedirect();
    expect(href).toContain("code=");
    const account = await host.restore();
    expect(account?.user).toMatchObject({ login: "someone", name: "Some One" });
    expect(href).toBe("https://docs.example/new-site/");
    expect(session.getItem("goodfellow:gitlab-setup:pending")).toBeNull();
    expect(local.getItem("goodfellow:gitlab-setup:pending")).toBeNull();
  });
});
