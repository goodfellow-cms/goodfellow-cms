import {
  CodeChangeError,
  ConflictError,
  type GitBackend,
  loadSiteContent,
  SignInError,
  type StorageLike,
  writeChanges,
} from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { GitHubBackend } from "./backend.js";
import { github, githubTokenLinks } from "./index.js";
import { fakeGitHub } from "./testing.js";

const FILES = {
  "content/site.json": '{"version":1,"title":"St. Joseph"}',
  "content/pages/index.json": '{"version":1,"data":{"root":{"props":{"title":"Home"}},"content":[]}}',
  "content/pages/about.json": '{"version":1,"data":{"root":{"props":{"title":"About"}},"content":[]}}',
  "src/styles.css": "@import 'tailwindcss';",
};

function memoryStorage(): StorageLike & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  };
}

function setup(options: Partial<Parameters<typeof fakeGitHub>[0]> = {}) {
  const fake = fakeGitHub({ repo: "parish/site", files: FILES, ...options });
  const local = memoryStorage();
  const session = memoryStorage();
  const host = github({ repo: "parish/site", fetch: fake.fetch, storage: { local, session } });
  return { fake, host, local, session };
}

async function signedIn(options?: Partial<Parameters<typeof fakeGitHub>[0]>) {
  const context = setup(options);
  const backend = await context.host.signInWithToken("test-token", false);
  return { ...context, backend };
}

describe("signing in", () => {
  it("links to a token page with the right permissions filled in", () => {
    const { fineGrained, classic } = githubTokenLinks("parish/site");
    const url = new URL(fineGrained);
    expect(url.origin + url.pathname).toBe("https://github.com/settings/personal-access-tokens/new");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      target_name: "parish",
      contents: "write",
      deployments: "read",
      statuses: "read",
      expires_in: "90",
    });
    expect(new URL(classic).searchParams.get("scopes")).toBe("repo");
  });

  it("signs in with a token and remembers it only when asked", async () => {
    const { host, local, session } = setup();
    const backend = await host.signInWithToken("  test-token  ", false);
    expect(backend.user).toEqual({ login: "editor", name: "Test Editor", avatarUrl: "https://avatars.example/editor" });
    expect(session.items.get("goodfellow:github:parish/site")).toBe("test-token");
    expect(local.items.size).toBe(0);

    await host.signInWithToken("test-token", true);
    expect(local.items.get("goodfellow:github:parish/site")).toBe("test-token");
    expect(session.items.size).toBe(0);
  });

  it("restores a saved sign-in, and forgets it on sign-out", async () => {
    const { host, session } = setup();
    expect(await host.restore()).toBeNull();
    const backend = await host.signInWithToken("test-token", false);
    expect((await host.restore())?.user.login).toBe("editor");
    backend.signOut();
    expect(session.items.size).toBe(0);
    expect(await host.restore()).toBeNull();
  });

  it("explains why a sign-in didn't work", async () => {
    const { host } = setup({ tokens: { reader: { login: "reader", push: false }, editor: { login: "editor" } } });
    await expect(host.signInWithToken("wrong", false)).rejects.toMatchObject({ problem: "invalid" });
    await expect(host.signInWithToken("", false)).rejects.toMatchObject({ problem: "invalid" });
    await expect(host.signInWithToken("reader", false)).rejects.toMatchObject({ problem: "cant-publish" });

    const elsewhere = github({ repo: "someone/else", fetch: setup().fake.fetch, storage: {} });
    await expect(elsewhere.signInWithToken("test-token", false)).rejects.toMatchObject({ problem: "no-access" });
  });

  it("forgets a saved token that no longer works", async () => {
    const { host, session } = setup();
    session.setItem("goodfellow:github:parish/site", "revoked");
    await expect(host.restore()).rejects.toBeInstanceOf(SignInError);
    expect(session.items.size).toBe(0);
  });

  it("only ever sends the token in the Authorization header", async () => {
    const { fake, backend } = await signedIn();
    await loadSiteContent(backend);
    for (const request of fake.requests) {
      expect(request.url).not.toContain("test-token");
      expect(request.headers.get("authorization")).toBe("Bearer test-token");
    }
  });

  it("refuses repository names that aren't owner/name", () => {
    expect(() => github({ repo: "just-a-name" })).toThrow(/owner\/name/);
  });
});

describe("reading", () => {
  it("loads the site's content", async () => {
    const { backend } = await signedIn();
    const content = await loadSiteContent(backend);
    expect(content.settings.title).toBe("St. Joseph");
    expect(content.pages.map((page) => page.path)).toEqual(["/", "/about"]);
  });

  it("keeps reading the revision it started from, even if someone publishes meanwhile", async () => {
    const { fake, backend } = await signedIn();
    const revision = await backend.revision();
    fake.commit([{ path: "content/site.json", content: '{"version":1,"title":"Changed"}' }], "Theirs");
    expect(await backend.read("content/site.json")).toBe(FILES["content/site.json"]);
    expect(await backend.revision()).not.toBe(revision);
    expect(await backend.read("content/site.json")).toBe('{"version":1,"title":"Changed"}');
  });

  it("lists files under a folder and reports missing files", async () => {
    const { backend } = await signedIn();
    expect(await backend.list("content/pages")).toEqual(["content/pages/about.json", "content/pages/index.json"]);
    expect(await backend.list("content/nothing")).toEqual([]);
    expect(await backend.read("content/menus.json")).toBeUndefined();
  });
});

describe("publishing", () => {
  it("saves every change in a single commit", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    const { revision } = await backend.write(
      [
        { path: "content/pages/news.json", content: '{"title":"Nouvelles ✝"}' },
        { path: "content/pages/about.json", delete: true },
        { path: "content/pages/never-existed.json", delete: true },
      ],
      { message: "Add news", expectedRevision: start },
    );
    expect(fake.repo.commitAt(revision)).toMatchObject({ parent: start, message: "Add news" });
    expect(fake.repo.files().get("content/pages/news.json")).toBe('{"title":"Nouvelles ✝"}');
    expect(fake.repo.files().has("content/pages/about.json")).toBe(false);
    expect(await backend.read("content/pages/news.json")).toBe('{"title":"Nouvelles ✝"}');
  });

  it("reads and writes the code of installed blocks", async () => {
    const { backend } = await signedIn({
      files: { ...FILES, "components/ui/button.tsx": "export function Button() {}\n" },
    });
    expect(await backend.read("components/ui/button.tsx")).toBe("export function Button() {}\n");
    await backend.write(
      [
        { path: "blocks/installed/shadcn-faq/block.tsx", content: "export default {};\n" },
        { path: "lib/utils.ts", content: "export {};\n" },
      ],
      { message: "Add the FAQ block", expectedRevision: await backend.revision() },
    );
    await backend.revision();
    expect(await backend.read("blocks/installed/shadcn-faq/block.tsx")).toBe("export default {};\n");
    expect(await backend.read("lib/utils.ts")).toBe("export {};\n");
  });

  it("uploads files that aren't text, such as images, and reads them back", async () => {
    const { fake, backend } = await signedIn();
    const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x80]);
    await backend.write([{ path: "public/media/photo.png", bytes: image }], {
      message: "Add photo.png",
      expectedRevision: await backend.revision(),
    });
    expect(fake.repo.files().get("public/media/photo.png")).toEqual(image);
    expect(await backend.list("public/media")).toContain("public/media/photo.png");
    expect(await backend.readBytes("public/media/photo.png")).toEqual(image);
    expect(await backend.readBytes("public/media/missing.png")).toBeUndefined();
  });

  it("refuses to save over someone else's newer commit", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    fake.commit([{ path: "content/site.json", content: "theirs" }], "Theirs");
    await expect(
      backend.write([{ path: "content/site.json", content: "mine" }], { message: "Mine", expectedRevision: start }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fake.repo.files().get("content/site.json")).toBe("theirs");
  });

  it("saves on top of someone else's changes to other files", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    fake.commit([{ path: "content/pages/index.json", content: "theirs" }], "Theirs");
    await writeChanges(backend, [{ path: "content/site.json", content: "mine" }], {
      message: "Mine",
      expectedRevision: start,
    });
    expect(fake.repo.files().get("content/site.json")).toBe("mine");
    expect(fake.repo.files().get("content/pages/index.json")).toBe("theirs");
  });

  it("reports which files changed between revisions", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    const end = fake.commit([{ path: "content/a.json", content: "1" }], "A");
    expect(await backend.changedPaths(start, end)).toEqual(["content/a.json"]);
  });
});

describe("deploy status", () => {
  async function published(
    deployAfterChecks?: number,
  ): Promise<{ backend: GitBackend; revision: string; fake: ReturnType<typeof fakeGitHub> }> {
    const { backend, fake } = await signedIn({ deployAfterChecks });
    const { revision } = await backend.write([{ path: "content/site.json", content: "{}" }], {
      message: "Publish",
      expectedRevision: await backend.revision(),
    });
    return { backend, revision, fake };
  }

  it("follows the deployment until it's live", async () => {
    const { backend, revision } = await published(1);
    expect(await backend.deployStatus(revision)).toEqual({ state: "building", detailsUrl: undefined });
    expect(await backend.deployStatus(revision)).toEqual({
      state: "live",
      detailsUrl: "https://github.com/parish/site/actions/runs/1",
    });
  });

  it("reports unknown when the site has never been deployed", async () => {
    const { backend, revision } = await published();
    expect(await backend.deployStatus(revision)).toEqual({ state: "unknown" });
  });

  it("says which step of a failed build failed, though a failed build never deploys", async () => {
    const { backend, revision, fake } = await published();
    fake.failBuild(revision, "Run npx goodfellow build --base /site/");
    expect(await backend.deployStatus(revision)).toEqual({
      state: "failed",
      detailsUrl: "https://github.com/parish/site/actions/runs/1",
      problem: { step: "build", detail: "build: Run npx goodfellow build --base /site/" },
    });
  });

  it("follows the newer publish's build where it replaced this one's, and reports a cancelled build otherwise", async () => {
    const { backend, revision, fake } = await published(0);
    fake.cancelBuild(revision);
    expect(await backend.deployStatus(revision)).toMatchObject({ state: "failed" });
    const newer = fake.commit([{ path: "content/pages/index.json", content: "{}" }], "Someone else's publish");
    expect(await backend.deployStatus(revision)).toMatchObject({ state: "live" });
    expect(await backend.deployStatus(newer)).toMatchObject({ state: "live" });
  });

  it.each([
    ["Run npm ci", "build", "install"],
    ["Run actions/configure-pages@v5", "build", "pages"],
    ["Run actions/deploy-pages@v4", "deploy", "deploy"],
    [undefined, "build", "not-started"],
  ])("tells a failed %s step apart", async (step, job, expected) => {
    const { backend, revision, fake } = await published();
    fake.failBuild(revision, step, job);
    expect((await backend.deployStatus(revision)).problem?.step).toBe(expected);
  });

  async function publishedOnCloudflare(options: Partial<Parameters<typeof fakeGitHub>[0]>) {
    const { backend, fake } = await signedIn(options);
    const write = async () =>
      (
        await backend.write([{ path: "content/site.json", content: String(Math.random()) }], {
          message: "Publish",
          expectedRevision: await backend.revision(),
        })
      ).revision;
    return { backend, fake, write };
  }

  it("follows Cloudflare Pages' build, from its GitHub App's check run", async () => {
    const { backend, write } = await publishedOnCloudflare({ cloudflare: { afterChecks: 1 } });
    const revision = await write();
    const detailsUrl = `https://dash.cloudflare.com/builds/${revision}`;
    expect(await backend.deployStatus(revision)).toEqual({ state: "building", detailsUrl });
    expect(await backend.deployStatus(revision)).toEqual({ state: "live", detailsUrl });
  });

  it("reads Cloudflare's commit status where the token can't read check runs, as fine-grained tokens can't", async () => {
    const { backend, fake, write } = await publishedOnCloudflare({
      cloudflare: { afterChecks: 0, report: "statuses" },
      checkRunsForbidden: true,
    });
    const revision = await write();
    expect(await backend.deployStatus(revision)).toEqual({
      state: "live",
      detailsUrl: `https://dash.cloudflare.com/builds/${revision}`,
    });
    fake.failCloudflare(revision);
    expect(await backend.deployStatus(revision)).toEqual({
      state: "failed",
      detailsUrl: `https://dash.cloudflare.com/builds/${revision}`,
      problem: { step: "build", detail: "Build failed" },
    });
  });

  it("counts a commit as building before Cloudflare reports on it, if it reported on the one before", async () => {
    const { backend, fake, write } = await publishedOnCloudflare({ cloudflare: { afterChecks: 0 } });
    await write();
    const revision = await write();
    // Cloudflare hasn't started this one yet.
    fake.cloudflareBuilds.delete(revision);
    expect(await backend.deployStatus(revision)).toEqual({ state: "building" });
  });

  it("doesn't need Actions, for tokens that can't see it", async () => {
    const { backend, fake } = await signedIn({ tokens: { "test-token": { login: "editor", actions: false } } });
    const { revision } = await backend.write([{ path: "content/site.json", content: "{}" }], {
      message: "Publish",
      expectedRevision: await backend.revision(),
    });
    fake.failBuild(revision, "Run npm ci");
    expect(await backend.deployStatus(revision)).toEqual({ state: "unknown" });
  });
});

describe("version history", () => {
  it("lists a file's published versions, newest first, and reads each one", async () => {
    const { fake, backend } = await signedIn();
    const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;
    fake.repo.write("content/pages/about.json", about("About us"), "Update About", "Maria");
    fake.repo.write("content/site.json", '{"version":1,"title":"St. Joseph Parish"}', "Update site settings");
    await backend.revision();
    await writeChanges(backend, [{ path: "content/pages/about.json", content: about("Who we are") }], {
      message: "Update Who we are",
      expectedRevision: await backend.revision(),
    });

    const versions = await backend.history("content/pages/about.json");
    expect(versions.map((version) => [version.message, version.author])).toEqual([
      ["Update Who we are", "Test Editor"],
      ["Update About", "Maria"],
      ["Initial commit", "GitHub"],
    ]);
    expect(versions[0]?.date).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await backend.readAt("content/pages/about.json", versions[1]?.revision ?? "")).toBe(about("About us"));
    expect(await backend.readAt("content/pages/new.json", versions[1]?.revision ?? "")).toBeUndefined();
    expect(await backend.history("content/pages/about.json", { perPage: 2, page: 2 })).toHaveLength(1);
  });

  it("lists the whole site's publishes and reads the site as it was at one", async () => {
    const { fake, backend } = await signedIn();
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 7]);
    fake.repo.commit([{ path: "public/media/church.jpg", bytes: photo }], "Upload church.jpg");
    fake.repo.write("content/pages/about.json", '{"version":1}', "Update About");
    fake.repo.commit([{ path: "public/media/church.jpg", delete: true }], "Delete church.jpg");
    await backend.revision();

    expect((await backend.history("content")).map((version) => version.message)).toEqual([
      "Update About",
      "Initial commit",
    ]);
    const media = await backend.history("public/media");
    expect(media.slice(0, 2).map((version) => version.message)).toEqual(["Delete church.jpg", "Upload church.jpg"]);

    const then = backend.filesAt(media[1]?.revision ?? "");
    expect(await then.list("public/media")).toContain("public/media/church.jpg");
    expect(await then.readBytes("public/media/church.jpg")).toEqual(photo);
    expect(await then.read("content/pages/about.json")).toBe(
      await backend.readAt("content/pages/about.json", media[1]?.revision ?? ""),
    );
    expect(await then.readFiles?.(["content/site.json", "content/pages/missing.json"])).toEqual(
      new Map([["content/site.json", await backend.readAt("content/site.json", media[1]?.revision ?? "")]]),
    );
    // Reading an earlier revision doesn't move the backend's own reads.
    expect(await backend.list("public/media")).not.toContain("public/media/church.jpg");
  });

  it("lists versions up to the revision it's reading", async () => {
    const { fake, backend } = await signedIn();
    await backend.revision();
    fake.repo.write("content/pages/about.json", "{}", "Someone else's change");
    expect((await backend.history("content/pages/about.json")).map((version) => version.message)).toEqual([
      "Initial commit",
    ]);
  });
});

describe("updates", () => {
  const packageJson = (version: string) => JSON.stringify({ dependencies: { "@goodfellow-cms/react": version } });

  async function site(workflow = "run: npx goodfellow update --publish") {
    const fake = fakeGitHub({
      repo: "parish/site",
      files: { ...FILES, "package.json": packageJson("0.4.1"), ".github/workflows/deploy.yml": workflow },
      tokens: {
        "test-token": { login: "maria", admin: true },
        owner: { login: "maria", admin: true, administration: true },
      },
    });
    const backend = await github({ repo: "parish/site", fetch: fake.fetch }).signInWithToken("test-token", false);
    if (!backend.updates || !backend.ownerAccess) throw new Error("No updates");
    return { fake, backend, updates: backend.updates, owner: backend.ownerAccess };
  }

  it("says whether the site's workflow updates Goodfellow", async () => {
    expect(await (await site()).updates.setup()).toBe("ready");
    expect(await (await site("run: npx goodfellow update --commit")).updates.setup()).toBe("ready");
    expect(await (await site("run: npx goodfellow build")).updates.setup()).toBe("missing");
  });

  it("runs the update with an owner token", async () => {
    const { fake, updates, owner } = await site();
    await expect(updates.start("fixes")).rejects.toMatchObject({ problem: "not-allowed" });
    await owner.applyToken("owner");
    await updates.start("0.5.0");
    expect(fake.runs.at(-1)).toMatchObject({ event: "workflow_dispatch", inputs: { update: "0.5.0" } });
    expect(await updates.lastRun()).toMatchObject({ state: "running" });
  });

  it("rebuilds the site without updating, with an owner token", async () => {
    const { fake, updates, owner } = await site();
    await expect(updates.rebuild?.()).rejects.toMatchObject({ problem: "not-allowed" });
    await owner.applyToken("owner");
    await updates.rebuild?.();
    expect(fake.runs.at(-1)).toMatchObject({ event: "workflow_dispatch", inputs: {} });
  });

  it("keeps when the site rebuilds overnight in the repository variable its workflow reads", async () => {
    const { fake, updates, owner } = await site("run: npx goodfellow nightly\nvars.GOODFELLOW_NIGHTLY");
    const nightly = updates.nightly;
    if (!nightly) throw new Error("No nightly setting");
    expect(await nightly.supported()).toBe(true);
    expect(await (await site()).updates.nightly?.supported()).toBe(false);
    // Signing in can't read or change Actions variables; the owner's sign-in can.
    expect(await nightly.get()).toBeUndefined();
    await expect(nightly.set("off")).rejects.toMatchObject({ problem: "not-allowed" });
    await owner.applyToken("owner");
    expect(await nightly.get()).toBe("changed");
    await nightly.set("off");
    expect(fake.variables.get("GOODFELLOW_NIGHTLY")).toBe("off");
    await nightly.set("always");
    expect(await nightly.get()).toBe("always");
    // The workflow's default needs no variable.
    await nightly.set("changed");
    expect(fake.variables.has("GOODFELLOW_NIGHTLY")).toBe(false);
    expect(await nightly.get()).toBe("changed");
  });

  it("tells an update that published a new version from one with nothing to do, and a failed one", async () => {
    const { fake, backend, updates } = await site();
    const run = (conclusion: string) => ({
      id: fake.runs.length + 1,
      sha: fake.repo.head(),
      event: "schedule",
      status: "completed" as const,
      conclusion: conclusion === "success" ? ("success" as const) : ("failure" as const),
      jobs: [{ name: "update", conclusion, steps: [] }],
    });
    expect(await updates.lastRun()).toBeUndefined();

    fake.runs.push(run("success"));
    expect(await updates.lastRun()).toMatchObject({ state: "up-to-date" });

    fake.runs.push(run("success"));
    fake.repo.write("package.json", packageJson("0.4.3"), "Update Goodfellow to 0.4.3", "Goodfellow updates");
    await backend.revision();
    expect(await updates.lastRun()).toMatchObject({
      state: "updated",
      result: { state: "updated", from: "0.4.1", to: "0.4.3" },
    });

    fake.runs.push(run("failure"));
    expect(await updates.lastRun()).toMatchObject({ state: "failed" });

    // An update the site built with, which the job that publishes it couldn't publish.
    fake.runs.push({
      ...run("success"),
      jobs: [...run("success").jobs, { name: "publish-update", conclusion: "failure", steps: [] }],
    });
    expect(await updates.lastRun()).toMatchObject({ state: "failed" });
    // One that had nothing to publish.
    fake.runs.push({
      ...run("success"),
      jobs: [...run("success").jobs, { name: "publish-update", conclusion: "skipped", steps: [] }],
    });
    expect(await updates.lastRun()).toMatchObject({ state: "up-to-date" });
  });
});

describe("updates in a code repository of their own", () => {
  const packageJson = (version: string) => JSON.stringify({ dependencies: { "@goodfellow-cms/react": version } });

  /** The content repository's backend, whose updates run in the code repository, which the fake serves. */
  function contentBackend(fake: ReturnType<typeof fakeGitHub>, token?: string) {
    const api = (value: string) => ({ apiUrl: "https://api.github.com", token: value, fetch: fake.fetch });
    return new GitHubBackend({
      api: api("test-token"),
      repo: "parish/site-content",
      branch: "main",
      contentOnly: true,
      code: { repo: "parish/site", webUrl: "https://github.com", ...(token && { api: api(token) }) },
      user: { login: "maria" },
      onSignOut: () => {},
      ownerTokenLink: { url: "https://github.com/settings/personal-access-tokens/new", label: "owner.token.create" },
    });
  }

  it("follows the code repository's update workflow, and reads the site's release there", async () => {
    const fake = fakeGitHub({
      repo: "parish/site",
      files: {
        "package.json": packageJson("0.4.1"),
        ".github/workflows/update.yml": "run: npx goodfellow update --publish",
      },
      tokens: { "test-token": { login: "maria" }, owner: { login: "maria", admin: true, administration: true } },
    });
    const backend = contentBackend(fake, "test-token");
    const updates = backend.updates;
    if (!updates?.code) throw new Error("No code repository");
    expect(updates.code).toMatchObject({ repo: "parish/site", webUrl: "https://github.com/parish/site" });
    expect(await updates.code.read("package.json")).toBe(packageJson("0.4.1"));
    expect(await updates.setup()).toBe("ready");

    await expect(updates.start("fixes")).rejects.toMatchObject({ problem: "not-allowed" });
    backend.useOwnerSignIn(
      async () => "owner",
      () => {},
      async () => "owner",
    );
    await updates.start("0.5.0");
    expect(fake.runs.at(-1)).toMatchObject({
      event: "workflow_dispatch",
      inputs: { update: "0.5.0" },
      path: ".github/workflows/update.yml",
    });
    expect(await updates.lastRun()).toMatchObject({ state: "running" });

    fake.runs.push({
      id: fake.runs.length + 1,
      sha: fake.repo.head(),
      event: "schedule",
      status: "completed",
      conclusion: "success",
      path: ".github/workflows/update.yml",
      jobs: [{ name: "update", conclusion: "success", steps: [] }],
    });
    fake.repo.write("package.json", packageJson("0.4.3"), "Update Goodfellow to 0.4.3", "Goodfellow updates");
    expect(await updates.lastRun()).toMatchObject({ state: "updated", result: { from: "0.4.1", to: "0.4.3" } });
    // The site's release changed in the code repository, which is read again each time.
    expect(await updates.code.read("package.json")).toBe(packageJson("0.4.3"));
  });

  it("says when the sign-in has no token for the code repository", async () => {
    const fake = fakeGitHub({ repo: "parish/site" });
    const updates = contentBackend(fake).updates;
    expect(await updates?.setup()).toBe("no-access");
    expect(await updates?.lastRun()).toBeUndefined();
  });
});

describe("drafts", () => {
  const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;

  async function withDraft() {
    const context = await signedIn();
    const drafts = context.backend.drafts;
    if (!drafts) throw new Error("No drafts");
    const draft = await drafts.create("20261014-abc123");
    const revision = await draft.store.revision();
    await draft.store.write(
      [
        { path: "content/pages/about.json", content: about("About us") },
        { path: "content/pages/new.json", content: about("New") },
        { path: "content/pages/index.json", delete: true },
      ],
      { message: "Draft changes", expectedRevision: revision },
    );
    return { ...context, drafts, draft };
  }

  it("keeps changes on a branch of their own, away from the live site", async () => {
    const { fake, draft } = await withDraft();
    expect(fake.repo.files("goodfellow-draft-20261014-abc123").get("content/pages/about.json")).toBe(about("About us"));
    expect(fake.repo.files().get("content/pages/about.json")).toBe(FILES["content/pages/about.json"]);
    expect(await draft.changes()).toEqual([
      { path: "content/pages/about.json", content: about("About us") },
      { path: "content/pages/index.json", delete: true },
      { path: "content/pages/new.json", content: about("New") },
    ]);
  });

  it("lists the drafts there are, newest first, and the files each changed", async () => {
    const { drafts, draft, fake } = await withDraft();
    await drafts.create("20261015-def456");
    fake.repo.branches.set("feature", fake.repo.head());
    expect(await drafts.list()).toEqual(["20261015-def456", "20261014-abc123"]);
    expect(await draft.paths()).toEqual([
      "content/pages/about.json",
      "content/pages/index.json",
      "content/pages/new.json",
    ]);
  });

  it("opens a draft again by name, and refuses names it doesn't have", async () => {
    const { drafts } = await withDraft();
    const again = await drafts.open("20261014-abc123");
    expect(await again.store.read("content/pages/about.json")).toBe(about("About us"));
    await expect(drafts.open("20261014-zzz999")).rejects.toMatchObject({ problem: "not-found" });
    await expect(drafts.open("../main")).rejects.toMatchObject({ problem: "not-found" });
    await expect(drafts.create("20261014-abc123")).rejects.toMatchObject({ problem: "exists" });
  });

  it("publishes a draft in one commit, on top of other people's changes to other files, then removes it", async () => {
    const { fake, draft } = await withDraft();
    fake.repo.write("src/styles.css", "@import 'tailwindcss'; /* changed */");
    const { revision } = await draft.publish("Update About");
    expect(fake.repo.head()).toBe(revision);
    expect(fake.repo.commitAt(revision)?.message).toBe("Update About");
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("About us"));
    expect(fake.repo.files().has("content/pages/index.json")).toBe(false);
    expect(fake.repo.files().get("src/styles.css")).toContain("changed");
    expect(fake.repo.branches.has("goodfellow-draft-20261014-abc123")).toBe(false);
  });

  it("refuses to publish over someone else's change to the same page, and keeps the draft", async () => {
    const { fake, draft } = await withDraft();
    fake.repo.write("content/pages/about.json", about("About the parish"));
    await expect(draft.publish("Update About")).rejects.toBeInstanceOf(ConflictError);
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("About the parish"));
    expect(fake.repo.branches.has("goodfellow-draft-20261014-abc123")).toBe(true);
  });

  it("submits a draft for review as a pull request, once", async () => {
    const { fake, draft } = await withDraft();
    const first = await draft.submitForReview({ title: "New About page", description: "Written with Claude." });
    expect(first.url).toBe("https://github.com/parish/site/pull/1");
    expect(fake.repo.reviews).toEqual([
      expect.objectContaining({
        branch: "goodfellow-draft-20261014-abc123",
        target: "main",
        title: "New About page",
        description: "Written with Claude.",
      }),
    ]);
    expect(await draft.submitForReview({ title: "Again" })).toEqual(first);
    expect(fake.repo.reviews).toHaveLength(1);
  });

  it("discards a draft", async () => {
    const { fake, draft, drafts } = await withDraft();
    await draft.discard();
    expect(fake.repo.branches.has("goodfellow-draft-20261014-abc123")).toBe(false);
    await expect(drafts.open("20261014-abc123")).rejects.toMatchObject({ problem: "not-found" });
  });
});

describe("reading many files", () => {
  it("reads them in one request rather than one each", async () => {
    const { backend, fake } = await signedIn();
    const files = await backend.readFiles?.(["content/site.json", "content/pages/about.json", "content/missing.json"]);
    expect(files).toEqual(
      new Map([
        ["content/site.json", FILES["content/site.json"]],
        ["content/pages/about.json", FILES["content/pages/about.json"]],
      ]),
    );
    expect(fake.graphqlReads).toBe(1);
    // Read once: they're cached by their content, which never changes.
    expect(await backend.read("content/site.json")).toBe(FILES["content/site.json"]);
    await backend.readFiles?.(["content/site.json"]);
    expect(fake.graphqlReads).toBe(1);
  });

  it("says how large files are without reading them", async () => {
    const { backend } = await signedIn();
    const sizes = await backend.fileSizes?.("content");
    expect(sizes?.get("content/site.json")).toBe(new TextEncoder().encode(FILES["content/site.json"]).length);
    expect([...(sizes?.keys() ?? [])].every((path) => path.startsWith("content/"))).toBe(true);
  });
});

describe("a repository of content only", () => {
  it("publishes content, and never the site's code, which is kept in a repository of its own", async () => {
    const fake = fakeGitHub({ repo: "parish/site-content", files: FILES });
    const host = github({ repo: "parish/site-content", contentOnly: true, fetch: fake.fetch, storage: {} });
    const backend = await host.signInWithToken("test-token", false);
    expect(backend.contentOnly).toBe(true);
    // Goodfellow's updates run where the code is.
    expect(backend.updates).toBeUndefined();

    const revision = await backend.revision();
    await expect(
      backend.write([{ path: "blocks/installed/index.ts", content: "export {};" }], {
        message: "Add a block",
        expectedRevision: revision,
      }),
    ).rejects.toBeInstanceOf(CodeChangeError);
    await backend.write([{ path: "content/pages/about.json", content: "{}" }], {
      message: "Update About",
      expectedRevision: revision,
    });
    expect(fake.repo.files().get("content/pages/about.json")).toBe("{}");

    const git = host.server?.({ token: "test-token" });
    expect(git?.contentOnly).toBe(true);
    expect((await git?.at(await backend.revision()))?.contentOnly).toBe(true);
  });

  it("says nothing of a workflow that only asks Vercel to rebuild the site", async () => {
    const { fake, backend } = await signedIn();
    const revision = await backend.revision();
    fake.runs.push({
      id: 1,
      sha: revision,
      status: "completed",
      conclusion: "success",
      jobs: [],
      path: ".github/workflows/rebuild.yml",
    });
    expect(await backend.deployStatus(revision)).toEqual({ state: "unknown" });
  });

  it("is a repository of the whole site otherwise", async () => {
    const { backend } = await signedIn();
    expect(backend.contentOnly).toBe(false);
    expect(backend.updates).toBeDefined();
  });
});

describe("on a full-stack site's server", () => {
  const ALICE = { name: "Alice Editor", email: "alice@example.org" };

  function server() {
    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    const host = github({ repo: "parish/site", fetch: fake.fetch });
    const git = host.server?.({ token: "test-token" });
    if (!git) throw new Error("github() has no server access");
    return { fake, git };
  }

  it("reads the revision a browser loaded, even after someone publishes", async () => {
    const { fake, git } = server();
    const revision = await git.revision();
    fake.commit([{ path: "content/site.json", content: '{"version":1,"title":"Changed"}' }], "Theirs");
    expect(await (await git.at(revision)).read("content/site.json")).toBe(FILES["content/site.json"]);
    expect(await git.revision()).not.toBe(revision);
  });

  it("publishes in the editor's name, and refuses to save over a newer commit", async () => {
    const { fake, git } = server();
    const revision = await git.revision();
    const backend = await git.at(revision, ALICE);
    const saved = await backend.write([{ path: "content/pages/about.json", content: "{}" }], {
      message: "Update About",
      expectedRevision: revision,
    });
    expect(fake.commitAuthors.get(saved.revision)).toMatchObject(ALICE);
    expect(fake.repo.files().get("content/pages/about.json")).toBe("{}");

    const stale = await git.at(revision, ALICE);
    await expect(
      stale.write([{ path: "content/site.json", content: "{}" }], { message: "Late", expectedRevision: revision }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("asks a token function for the token on each request", async () => {
    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    let asked = 0;
    const git = github({ repo: "parish/site", fetch: fake.fetch }).server?.({
      token: async () => {
        asked++;
        return "test-token";
      },
    });
    await git?.revision();
    expect(asked).toBeGreaterThan(0);
  });
});

describe("scheduled builds", () => {
  async function site(files: Record<string, string>, options: { private?: boolean } = {}) {
    const fake = fakeGitHub({
      repo: "parish/site",
      files: { ...FILES, ...files },
      tokens: { "test-token": { login: "maria", admin: true } },
      ...options,
    });
    return github({ repo: "parish/site", fetch: fake.fetch }).signInWithToken("test-token", false);
  }
  // As the starters' workflows have them.
  const deploy = 'on:\n  push:\n    branches: [main]\n  schedule:\n    - cron: "17 4 * * *"\n';
  const scheduled =
    'on:\n  schedule:\n    - cron: "47 * * * *"\njobs:\n  check:\n    steps:\n      - run: npx goodfellow due\n';

  it("go live within the hour with the starters' hourly check, or else with the nightly build", async () => {
    const backend = await site({
      ".github/workflows/deploy.yml": deploy,
      ".github/workflows/scheduled.yml": scheduled,
    });
    expect(await backend.scheduledBuilds?.timing()).toBe("hourly");
    expect(backend.scheduledBuilds?.sync).toBeUndefined();
    expect(await (await site({ ".github/workflows/deploy.yml": deploy })).scheduledBuilds?.timing()).toBe("nightly");
    expect(await (await site({})).scheduledBuilds?.timing()).toBe("none");
  });

  it("says who can read the repository", async () => {
    expect(await (await site({})).repositoryVisibility?.()).toBe("public");
    expect(await (await site({}, { private: true })).repositoryVisibility?.()).toBe("private");
  });
});
