import { decodeBase64, SetupError, separateSetupLinks } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { githubSetup } from "./setup.js";
import { fakeGitHub } from "./testing.js";

const files = [
  { path: "package.json", content: "{}\n" },
  { path: ".github/workflows/deploy.yml", content: "name: Deploy\non:\n  workflow_dispatch:\n" },
  { path: "public/media/logo.png", bytes: new Uint8Array([137, 80, 78, 71, 0, 255]) },
];

/** The fake's fetch, refusing every request whose address matches. */
function refusing(fetch: typeof globalThis.fetch, address: RegExp): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!address.test(url)) return fetch(input, init);
    return new Response('{"message":"Server Error"}', { status: 500, headers: { "content-type": "application/json" } });
  };
}

function setup(options: Parameters<typeof fakeGitHub>[0] = { repo: "someone/existing" }) {
  const fake = fakeGitHub(options);
  return { fake, host: githubSetup({ fetch: fake.fetch }) };
}

describe("githubSetup", () => {
  it("says which repository it made as soon as GitHub has made it, before the rest of its setup can fail", async () => {
    const fake = fakeGitHub({ repo: "someone/existing", newRepoBranch: "master", tokens: { t: { login: "someone" } } });
    const account = await githubSetup({ fetch: refusing(fake.fetch, /\/git\/ref\//) }).signInWithToken("t");
    const [owner] = await account.owners();
    if (!owner) throw new Error("no owner");
    const made: string[] = [];
    await expect(
      account.createSite(
        { owner, name: "parish", private: false, pages: false, files, message: "Create the site" },
        undefined,
        (repo) => made.push(repo),
      ),
    ).rejects.toThrow();
    expect(fake.created.has("someone/parish")).toBe(true);
    expect(made).toEqual(["someone/parish"]);
  });

  it("lists the person's own account first, then their organizations", async () => {
    const { host } = setup({ repo: "someone/existing", orgs: ["st-joseph"], tokens: { t: { login: "someone" } } });
    const account = await host.signInWithToken(" t ");
    expect(account.user.login).toBe("someone");
    expect((await account.owners()).map((owner) => [owner.path, owner.kind])).toEqual([
      ["someone", "personal"],
      ["st-joseph", "organization"],
    ]);
  });

  it("creates a public repository on main with Pages, every file in one commit, and protected history", async () => {
    const { fake, host } = setup({
      repo: "someone/existing",
      newRepoBranch: "master",
      tokens: { t: { login: "someone" } },
    });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    expect(await account.isAvailable(owner, "parish")).toBe(true);
    const steps: string[] = [];
    const result = await account.createSite(
      { owner, name: "parish", private: false, pages: true, files, message: "Create the site" },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["repository", "pages", "files", "protection"]);
    expect(result).toEqual({
      repo: "someone/parish",
      webUrl: "https://github.com/someone/parish",
      siteUrl: "https://someone.github.io/parish/",
      buildsUrl: "https://github.com/someone/parish/actions",
      pagesUrl: "https://github.com/someone/parish/settings/pages",
      warnings: [],
    });

    const site = fake.created.get("someone/parish");
    if (!site) throw new Error("not created");
    expect(site.repo.defaultBranch).toBe("main");
    expect([...site.repo.branches.keys()]).toEqual(["main"]);
    const head = site.repo.commitAt(site.repo.head());
    // The first commit replaces the README GitHub starts the repository with.
    expect(head?.parent).toBeUndefined();
    expect(head?.message).toBe("Create the site");
    expect([...(head?.files.keys() ?? [])].sort()).toEqual([
      ".github/workflows/deploy.yml",
      "package.json",
      "public/media/logo.png",
    ]);
    expect(head?.files.get("public/media/logo.png")).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
    expect(site.pages).toEqual({ build_type: "workflow" });
    expect(site.rulesets).toHaveLength(1);
    expect(await account.isAvailable(owner, "parish")).toBe(false);
  });

  it("still creates a private repository on the free plan, warning that Pages and protection aren't available", async () => {
    const { host } = setup({ repo: "someone/existing", tokens: { t: { login: "someone" } } });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    const result = await account.createSite({
      owner,
      name: "private-site",
      private: true,
      pages: true,
      files,
      message: "Create",
    });
    expect(result.siteUrl).toBeUndefined();
    expect(result.warnings).toEqual(["pages-unavailable", "protection-unavailable"]);
  });

  it("gives a repository's Pages a domain of its own, such as a token broker's, warning when GitHub won't take it", async () => {
    const { fake, host } = setup({
      repo: "someone/existing",
      tokens: { t: { login: "someone" } },
      takenDomains: ["taken.example.org"],
    });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    const site = { owner, private: false, pages: true, files, message: "Add the sign-in page" };
    const result = await account.createSite({ ...site, name: "signin", domain: "signin.example.org" });
    expect(result.siteUrl).toBe("https://signin.example.org/");
    expect(fake.created.get("someone/signin")?.pages?.cname).toBe("signin.example.org");
    const taken = await account.createSite({ ...site, name: "other", domain: "taken.example.org" });
    expect(taken.siteUrl).toBe("https://someone.github.io/other/");
    expect(taken.warnings).toContain("domain-unavailable");
  });

  it("says when the name is taken, or the token can't write the build setup", async () => {
    const { host } = setup({
      repo: "someone/existing",
      tokens: { t: { login: "someone" }, narrow: { login: "someone", workflow: false } },
    });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    const site = { owner, name: "existing", private: false, pages: false, files, message: "Create" };
    await expect(account.createSite(site)).rejects.toMatchObject({ problem: "name-taken" });
    const narrow = await host.signInWithToken("narrow");
    await expect(narrow.createSite({ ...site, name: "new-site" })).rejects.toBeInstanceOf(SetupError);
    await expect(narrow.createSite({ ...site, name: "another" })).rejects.toMatchObject({ problem: "not-allowed" });
  });

  it("connects a site's private code and content repositories with deploy keys and secrets", async () => {
    const { fake, host } = setup({ repo: "someone/existing", paidPlan: true, tokens: { t: { login: "someone" } } });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    const base = { owner, private: true, files, message: "Create" };
    await account.createSite({ ...base, name: "site", pages: false, more: true });
    const steps: string[] = [];
    const result = await account.createSite(
      {
        ...base,
        name: "site-content",
        pages: true,
        link: {
          code: "someone/site",
          content: "someone/site-content",
          private: true,
          links: separateSetupLinks({ git: "github", host: "github-pages", build: "content" }),
        },
      },
      (step) => steps.push(step),
    );
    // Connected before the files, whose first build reads the code.
    expect(steps).toEqual(["repository", "pages", "connect", "files", "protection"]);
    expect(result.warnings).toEqual([]);

    const code = fake.created.get("someone/site");
    const content = fake.created.get("someone/site-content");
    if (!code || !content) throw new Error("not created");
    const keyFor = (privateKey: string | undefined) => {
      const body = decodeBase64((privateKey ?? "").replace(/-----[^-]+-----|\n/g, ""));
      return new TextDecoder("latin1").decode(body);
    };
    for (const [reader, read, secret] of [
      [content, code, "GOODFELLOW_CODE_KEY"],
      [code, content, "GOODFELLOW_CONTENT_KEY"],
    ] as const) {
      const [deployKey] = read.deployKeys;
      expect(deployKey?.read_only).toBe(true);
      const privateKey = reader.secrets.get(secret);
      expect(privateKey).toMatch(/^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
      // The secret is the private half of the deploy key on the repository it reads.
      const blob = new TextDecoder("latin1").decode(decodeBase64(deployKey?.key.split(" ")[1] ?? ""));
      expect(keyFor(privateKey)).toContain(blob);
    }
  });

  it("warns when the sign-in can't connect the repositories, and leaves public ones as they are", async () => {
    const { fake, host } = setup({
      repo: "someone/existing",
      paidPlan: true,
      tokens: { t: { login: "someone", secrets: false } },
    });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    const link = {
      code: "someone/site",
      content: "someone/site-content",
      private: true,
      links: separateSetupLinks({ git: "github", host: "github-pages", build: "content" }),
    };
    const base = { owner, pages: false, files, message: "Create" };
    await account.createSite({ ...base, name: "site", private: true });
    const result = await account.createSite({ ...base, name: "site-content", private: true, link });
    expect(result.warnings).toContain("connect-unavailable");

    await account.createSite({ ...base, name: "open", private: false });
    const open = await account.createSite({
      ...base,
      name: "open-content",
      private: false,
      link: { ...link, code: "someone/open", content: "someone/open-content", private: false },
    });
    expect(open.warnings).toEqual([]);
    expect(fake.created.get("someone/open")?.deployKeys).toEqual([]);
  });

  it("saves secrets, starts workflows, and reads files of the repositories it created, and only those", async () => {
    const { fake, host } = setup({ repo: "someone/existing", tokens: { t: { login: "someone", actionsWrite: true } } });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    // With a workflow that runs only on its schedule, which can't be started by hand.
    // Its comment and a job's name mention workflow_dispatch, which doesn't make it one.
    const scheduled = {
      path: ".github/workflows/scheduled.yml",
      content:
        "name: Scheduled\n# Not workflow_dispatch: it runs only on its schedule.\non:\n  schedule: []\njobs:\n  workflow_dispatch:\n    runs-on: ubuntu-latest\n",
    };
    await account.createSite({
      owner,
      name: "site",
      private: true,
      pages: false,
      files: [
        ...files,
        scheduled,
        { path: ".github/workflows/listed.yml", content: "on: [push, workflow_dispatch] # by hand too\n" },
      ],
      message: "Create",
    });
    await account.saveSecrets?.("someone/site", { CLOUDFLARE_API_TOKEN: "cf-token", GOODFELLOW_APP_ID: "5001" });
    const code = fake.created.get("someone/site");
    expect(code?.secrets.get("CLOUDFLARE_API_TOKEN")).toBe("cf-token");
    expect(code?.secrets.get("GOODFELLOW_APP_ID")).toBe("5001");
    expect(await account.startWorkflow?.("someone/site", "deploy.yml")).toBe(true);
    expect(code?.dispatched).toEqual([{ workflow: ".github/workflows/deploy.yml", ref: "main" }]);
    // A workflow it doesn't have, or one that can't be started by hand.
    expect(await account.startWorkflow?.("someone/site", "setup-cloudflare.yml")).toBe(false);
    expect(await account.startWorkflow?.("someone/site", "scheduled.yml")).toBe(false);
    expect(await account.startWorkflow?.("someone/site", "listed.yml")).toBe(true);
    expect(await account.readFile?.("someone/site", "package.json")).toBe("{}\n");
    expect(await account.readFile?.("someone/site", "wrangler.jsonc")).toBeUndefined();
    // Not one it created.
    await expect(account.saveSecrets?.("someone/existing", { A: "b" })).rejects.toThrow(/wasn't created/);
    await expect(account.saveSecrets?.("someone/site", { "bad name": "b" })).rejects.toThrow(/isn't a secret/);
  });

  it("says the same once GitHub stops taking the sign-in, which it answers with a 401", async () => {
    const fake = fakeGitHub({ repo: "someone/existing", tokens: { t: { login: "someone", actionsWrite: true } } });
    let expired = false;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) =>
      expired
        ? Response.json({ message: "Bad credentials" }, { status: 401 })
        : fake.fetch(input, init)) as typeof fetch;
    const account = await githubSetup({ fetch: fetcher }).signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    await account.createSite({ owner, name: "site", private: true, pages: false, files, message: "Create" });
    expired = true;
    await expect(account.saveSecrets?.("someone/site", { A: "b" })).rejects.toMatchObject({ problem: "not-allowed" });
    expect(await account.startWorkflow?.("someone/site", "deploy.yml")).toBe(false);
  });

  it("says when the sign-in can't save secrets or start workflows", async () => {
    const { host } = setup({
      repo: "someone/existing",
      // A token without Actions write, which it has only where it says so (or has Administration).
      tokens: { t: { login: "someone", secrets: false } },
    });
    const account = await host.signInWithToken("t");
    const owner = (await account.owners())[0];
    if (!owner) throw new Error("no owner");
    await account.createSite({ owner, name: "site", private: true, pages: false, files, message: "Create" });
    await expect(account.saveSecrets?.("someone/site", { A: "b" })).rejects.toMatchObject({ problem: "not-allowed" });
    expect(await account.startWorkflow?.("someone/site", "deploy.yml")).toBe(false);
  });
});
