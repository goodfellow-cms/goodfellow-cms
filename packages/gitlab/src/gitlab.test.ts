import { CodeChangeError, ConflictError, loadSiteContent, type StorageLike, writeChanges } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { type BrowserLocation, gitlab, redirectUri } from "./index.js";
import { fakeGitLab } from "./testing.js";

const FILES = {
  "content/site.json": '{"version":1,"title":"St. Joseph"}',
  "content/pages/index.json": '{"version":1,"data":{"root":{"props":{"title":"Home"}},"content":[]}}',
  "content/pages/about.json": '{"version":1,"data":{"root":{"props":{"title":"About"}},"content":[]}}',
  "public/media/logo.svg": "<svg/>",
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

function fakeLocation(start: string): BrowserLocation & { current: string; assigned: string[] } {
  const location = {
    current: start,
    assigned: [] as string[],
    href: () => location.current,
    assign: (url: string) => void location.assigned.push(url),
    replace: (url: string) => {
      location.current = url;
    },
  };
  return location;
}

function setup(options: Partial<Parameters<typeof fakeGitLab>[0]> = {}, clientId?: string) {
  const fake = fakeGitLab({ project: "parish/web/site", files: FILES, ...options });
  const local = memoryStorage();
  const session = memoryStorage();
  const location = fakeLocation("https://parish.example/admin/#/settings/theme");
  const host = gitlab({
    project: "parish/web/site",
    clientId,
    fetch: fake.fetch,
    storage: { local, session },
    location,
  });
  return { fake, host, local, session, location };
}

describe("signing in with a token", () => {
  it("signs in, loads the site and saves the token where asked", async () => {
    const { host, local, session } = setup();
    expect(host.canRedirect).toBe(false);
    expect(host.tokenLinks?.[0]?.url).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens?name=Goodfellow+admin&scopes=api",
    );

    const backend = await host.signInWithToken("test-token", true);
    expect(backend.user.login).toBe("editor");
    expect(local.items.size).toBe(1);
    expect(session.items.size).toBe(0);
    const content = await loadSiteContent(backend);
    expect(content.pages.map((page) => page.path)).toEqual(["/", "/about"]);
    expect(await backend.list("public/media")).toEqual(["public/media/logo.svg"]);
    expect(await backend.read("src/styles.css")).toBeUndefined();
  });

  it("refuses accounts that can't publish", async () => {
    const { host } = setup({ tokens: { reporter: { username: "reporter", accessLevel: 20 } } });
    await expect(host.signInWithToken("reporter", false)).rejects.toMatchObject({ problem: "cant-publish" });
    await expect(host.signInWithToken("nope", false)).rejects.toMatchObject({ problem: "invalid" });
  });
});

describe("signing in with GitLab (OAuth with PKCE)", () => {
  it("sends the browser to GitLab and finishes signing in when it comes back", async () => {
    const { fake, host, location, session } = setup(
      { oauth: { clientId: "app-1", user: { username: "oauth-editor" } } },
      "app-1",
    );
    expect(host.canRedirect).toBe(true);
    expect(await host.restore()).toBeNull();

    await host.startRedirect(false);
    const authorize = new URL(location.assigned[0] ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://gitlab.com/oauth/authorize");
    expect(authorize.searchParams.get("redirect_uri")).toBe("https://parish.example/admin/");
    expect(authorize.searchParams.get("scope")).toBe("api");

    // GitLab sends the browser back with a code.
    location.current = fake.authorize(authorize.toString());
    const backend = await host.restore();
    expect(backend?.user.login).toBe("oauth-editor");
    expect(location.current).toBe("https://parish.example/admin/#/settings/theme");
    // The saved sign-in now works without redirecting again.
    expect(session.items.size).toBe(1);
    expect((await host.restore())?.user.login).toBe("oauth-editor");
  });

  it("rejects a return whose state doesn't match", async () => {
    const { fake, host, location } = setup({ oauth: { clientId: "app-1", user: { username: "u" } } }, "app-1");
    await host.startRedirect(false);
    const back = new URL(fake.authorize(location.assigned[0] ?? ""));
    back.searchParams.set("state", "forged");
    location.current = back.toString();
    await expect(host.restore()).rejects.toMatchObject({ problem: "redirect-failed" });
  });

  it("refreshes the access token when it expires", async () => {
    const { fake, host, location } = setup(
      { oauth: { clientId: "app-1", user: { username: "u" }, expiresIn: 1 } },
      "app-1",
    );
    await host.startRedirect(true);
    location.current = fake.authorize(location.assigned[0] ?? "");
    const backend = await host.restore();
    await backend?.revision();
    const refreshes = fake.requests.filter((request) => request.url.endsWith("/oauth/token")).length;
    expect(refreshes).toBeGreaterThanOrEqual(2);
  });

  it("builds a redirect address that matches whether or not the address ends in a slash", () => {
    expect(redirectUri("https://parish.example/admin#/pages")).toBe("https://parish.example/admin/");
    expect(redirectUri("https://parish.example/repo/admin/?code=1")).toBe("https://parish.example/repo/admin/");
  });
});

describe("publishing", () => {
  async function signedIn(options?: Partial<Parameters<typeof fakeGitLab>[0]>) {
    const context = setup(options);
    return { ...context, backend: await context.host.signInWithToken("test-token", false) };
  }

  it("creates, updates and deletes files in one commit", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    const { revision } = await backend.write(
      [
        { path: "content/pages/news.json", content: "{}" },
        { path: "content/site.json", content: '{"version":1,"title":"New"}' },
        { path: "content/pages/about.json", delete: true },
        { path: "content/pages/missing.json", delete: true },
      ],
      { message: "Edit", expectedRevision: start },
    );
    expect(fake.repo.commitAt(revision)).toMatchObject({ parent: start, message: "Edit" });
    expect([...fake.repo.files().keys()].filter((path) => path.startsWith("content/")).sort()).toEqual([
      "content/pages/index.json",
      "content/pages/news.json",
      "content/site.json",
    ]);
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

  it("refuses to save over someone else's commit", async () => {
    const { fake, backend } = await signedIn();
    const start = await backend.revision();
    fake.commit([{ path: "content/site.json", content: "theirs" }], "Theirs");
    await expect(
      backend.write([{ path: "content/site.json", content: "mine" }], { message: "Mine", expectedRevision: start }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fake.repo.files().get("content/site.json")).toBe("theirs");
  });

  it("saves on top of changes to other files", async () => {
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

  it("reports deploys from the commit's pipeline", async () => {
    const { backend } = await signedIn({ deployAfterChecks: 1 });
    expect(await backend.deployStatus("0".repeat(40))).toEqual({ state: "unknown" });
    const { revision } = await backend.write([{ path: "content/site.json", content: "{}" }], {
      message: "Publish",
      expectedRevision: await backend.revision(),
    });
    expect((await backend.deployStatus(revision)).state).toBe("building");
    expect(await backend.deployStatus(revision)).toEqual({
      state: "live",
      detailsUrl: "https://gitlab.com/parish/web/site/-/jobs/1",
    });
  });
});

describe("version history", () => {
  it("lists a file's published versions, newest first, and reads each one", async () => {
    const { fake, host } = setup();
    const backend = await host.signInWithToken("test-token", false);
    const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;
    fake.repo.write("content/pages/about.json", about("About us"), "Update About", "Maria");
    fake.repo.write("content/site.json", '{"version":1,"title":"St. Joseph Parish"}', "Update site settings");
    await writeChanges(backend, [{ path: "content/pages/about.json", content: about("Who we are") }], {
      message: "Update Who we are",
      expectedRevision: await backend.revision(),
    });

    const versions = await backend.history("content/pages/about.json");
    expect(versions.map((version) => [version.message, version.author])).toEqual([
      ["Update Who we are", "Test Editor"],
      ["Update About", "Maria"],
      ["Initial commit", "GitLab"],
    ]);
    expect(versions[0]?.date).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await backend.readAt("content/pages/about.json", versions[1]?.revision ?? "")).toBe(about("About us"));
    expect(await backend.readAt("content/pages/new.json", versions[1]?.revision ?? "")).toBeUndefined();
    expect(await backend.history("content/pages/about.json", { perPage: 2, page: 2 })).toHaveLength(1);
  });

  it("lists versions up to the revision it's reading", async () => {
    const { fake, host } = setup();
    const backend = await host.signInWithToken("test-token", false);
    await backend.revision();
    fake.repo.write("content/pages/about.json", "{}", "Someone else's change");
    expect((await backend.history("content/pages/about.json")).map((version) => version.message)).toEqual([
      "Initial commit",
    ]);
  });
});

describe("failed rebuilds", () => {
  async function published(failure: Parameters<ReturnType<typeof fakeGitLab>["failBuild"]>[1]) {
    const { fake, host } = setup();
    const backend = await host.signInWithToken("test-token", false);
    const { revision } = await backend.write([{ path: "content/site.json", content: "{}" }], {
      message: "Publish",
      expectedRevision: await backend.revision(),
    });
    fake.failBuild(revision, failure);
    return backend.deployStatus(revision);
  }

  it("finds what goodfellow build said in the job's log", async () => {
    const status = await published({
      trace: [
        "\u001b[32;1m$ npm ci --cache .npm --prefer-offline\u001b[0;m",
        "added 300 packages",
        "\u001b[32;1m$ npx goodfellow build\u001b[0;m",
        'goodfellow-build-problem {"kind":"content","file":"content/pages/about.json","message":"isn\'t valid JSON."}',
        "ERROR: Job failed: exit code 1",
      ].join("\n"),
    });
    expect(status).toMatchObject({
      state: "failed",
      problem: {
        step: "build",
        cause: { kind: "content", file: "content/pages/about.json", message: "isn't valid JSON." },
        detail: "pages: script_failure",
      },
    });
  });

  it("tells installing packages, GitLab's own problems and used-up minutes apart", async () => {
    expect((await published({ trace: "$ npm ci --cache .npm\nnpm ERR! code ERESOLVE\n" })).problem?.step).toBe(
      "install",
    );
    expect((await published({ failureReason: "runner_system_failure" })).problem?.step).toBe("host");
    expect((await published({ failureReason: "ci_quota_exceeded" })).problem?.step).toBe("not-started");
    expect((await published({ job: "pages:deploy" })).problem?.step).toBe("deploy");
  });
});

describe("updates", () => {
  async function site(ci = "pages:\n  script:\n    - npx goodfellow update --publish\n", token = "test-token") {
    const fake = fakeGitLab({
      project: "parish/site",
      files: { ...FILES, ".gitlab-ci.yml": ci },
      tokens: { "test-token": { username: "maria" }, developer: { username: "joseph", accessLevel: 30 } },
    });
    const backend = await gitlab({ project: "parish/site", fetch: fake.fetch }).signInWithToken(token, false);
    if (!backend.updates) throw new Error("No updates");
    return { fake, updates: backend.updates };
  }

  it("lets job tokens publish and adds a nightly schedule", async () => {
    const { fake, updates } = await site();
    expect(await updates.setup()).toBe("needs-setup");
    await updates.enable?.();
    expect(fake.updateSettings).toMatchObject({ jobTokenPush: true, schedules: [{ ref: "main", cron: "17 4 * * *" }] });
    expect(await updates.setup()).toBe("ready");
    await updates.enable?.();
    expect(fake.updateSettings.schedules).toHaveLength(1);
    expect(await (await site("pages:\n  script: [npx goodfellow build]\n")).updates.setup()).toBe("missing");
    await expect((await site(undefined, "developer")).updates.enable?.()).rejects.toMatchObject({
      problem: "not-allowed",
    });
  });

  it("runs the update with the release asked for, and reads what it did from the log", async () => {
    const { fake, updates } = await site();
    await updates.start("0.5.0");
    expect(fake.updateRuns[0]?.variables).toEqual([
      { key: "GOODFELLOW_UPDATE", variable_type: "env_var", value: "0.5.0" },
    ]);
    expect(await updates.lastRun()).toMatchObject({ state: "running" });

    fake.addUpdateRun({
      trace:
        'Updating…\ngoodfellow-update {"state":"updated","from":"0.4.1","to":"0.4.3","kept":[]}\n$ npx goodfellow build',
    });
    expect(await updates.lastRun()).toMatchObject({
      state: "updated",
      result: { from: "0.4.1", to: "0.4.3" },
      detailsUrl: "https://gitlab.com/parish/site/-/pipelines/1001",
    });
  });
});

describe("drafts", () => {
  const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;
  const photo = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x9f]);

  async function withDraft() {
    const context = setup();
    const backend = await context.host.signInWithToken("test-token", false);
    const drafts = backend.drafts;
    if (!drafts) throw new Error("No drafts");
    const draft = await drafts.create("20261014-abc123");
    await draft.store.write(
      [
        { path: "content/pages/about.json", content: about("About us") },
        { path: "public/media/photo.jpg", bytes: photo },
        { path: "content/pages/index.json", delete: true },
      ],
      { message: "Draft changes", expectedRevision: await draft.store.revision() },
    );
    return { ...context, drafts, draft };
  }

  it("keeps changes on a branch of their own, uploads included", async () => {
    const { fake, draft } = await withDraft();
    expect(fake.repo.files().get("content/pages/about.json")).toBe(FILES["content/pages/about.json"]);
    expect(await draft.changes()).toEqual([
      { path: "content/pages/about.json", content: about("About us") },
      { path: "content/pages/index.json", delete: true },
      { path: "public/media/photo.jpg", bytes: photo },
    ]);
  });

  it("publishes a draft in one commit, on top of other people's changes to other files, then removes it", async () => {
    const { fake, draft, drafts } = await withDraft();
    fake.repo.write("src/styles.css", "@import 'tailwindcss'; /* changed */");
    const { revision } = await draft.publish("Update About");
    expect(fake.repo.head()).toBe(revision);
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("About us"));
    expect(fake.repo.files().get("public/media/photo.jpg")).toEqual(photo);
    expect(fake.repo.files().has("content/pages/index.json")).toBe(false);
    await expect(drafts.open("20261014-abc123")).rejects.toMatchObject({ problem: "not-found" });
  });

  it("refuses to publish over someone else's change to the same page, and keeps the draft", async () => {
    const { fake, draft, drafts } = await withDraft();
    fake.repo.write("content/pages/about.json", about("About the parish"));
    await expect(draft.publish("Update About")).rejects.toBeInstanceOf(ConflictError);
    expect((await drafts.open("20261014-abc123")).name).toBe("20261014-abc123");
  });

  it("submits a draft for review as a merge request, once", async () => {
    const { fake, draft } = await withDraft();
    const first = await draft.submitForReview({ title: "New About page" });
    expect(first.url).toBe("https://gitlab.com/parish/web/site/-/merge_requests/1");
    expect(await draft.submitForReview({ title: "Again" })).toEqual(first);
    expect(fake.repo.reviews).toEqual([
      expect.objectContaining({ branch: "goodfellow-draft-20261014-abc123", target: "main", title: "New About page" }),
    ]);
  });

  it("discards a draft, and refuses names it doesn't have", async () => {
    const { fake, draft, drafts } = await withDraft();
    await expect(drafts.create("20261014-abc123")).rejects.toMatchObject({ problem: "exists" });
    await draft.discard();
    expect(fake.repo.branches.has("goodfellow-draft-20261014-abc123")).toBe(false);
    await expect(drafts.open("20261014-abc123")).rejects.toMatchObject({ problem: "not-found" });
  });
});

describe("reading many files", () => {
  it("reads them in one request rather than one each", async () => {
    const { host, fake } = setup();
    const backend = await host.signInWithToken("test-token", false);
    const files = await backend.readFiles?.(["content/site.json", "content/pages/about.json", "content/missing.json"]);
    expect(files).toEqual(
      new Map([
        ["content/site.json", FILES["content/site.json"]],
        ["content/pages/about.json", FILES["content/pages/about.json"]],
      ]),
    );
    expect(fake.graphqlReads).toBe(1);
    await backend.readFiles?.(["content/site.json"]);
    expect(fake.graphqlReads).toBe(1);
  });

  it("says how large files are without reading them", async () => {
    const { host } = setup();
    const backend = await host.signInWithToken("test-token", false);
    const sizes = await backend.fileSizes?.("content");
    expect(sizes?.get("content/site.json")).toBe(new TextEncoder().encode(FILES["content/site.json"]).length);
    expect([...(sizes?.keys() ?? [])].every((path) => path.startsWith("content/"))).toBe(true);
  });
});

describe("a project of content only", () => {
  it("publishes content, and never the site's code, which is kept in a project of its own", async () => {
    const fake = fakeGitLab({ project: "parish/web/site-content", files: FILES });
    const host = gitlab({
      project: "parish/web/site-content",
      contentOnly: true,
      fetch: fake.fetch,
      storage: {},
      location: fakeLocation("https://parish.example/admin/"),
    });
    const backend = await host.signInWithToken("test-token", false);
    expect(backend.contentOnly).toBe(true);
    // Goodfellow's updates run where the code is.
    expect(backend.updates).toBeUndefined();

    const revision = await backend.revision();
    await expect(
      backend.write([{ path: "lib/utils.ts", content: "export {};" }], {
        message: "Add a helper",
        expectedRevision: revision,
      }),
    ).rejects.toBeInstanceOf(CodeChangeError);
    await backend.write([{ path: "content/pages/about.json", content: "{}" }], {
      message: "Update About",
      expectedRevision: revision,
    });
    expect(await (await host.signInWithToken("test-token", false)).read("content/pages/about.json")).toBe("{}");

    const git = host.server?.({ token: "test-token" });
    expect(git?.contentOnly).toBe(true);
    expect((await git?.at(await backend.revision()))?.contentOnly).toBe(true);
  });
});

describe("deploy status of a project that only asks Vercel to rebuild the site", () => {
  it("says nothing of it", async () => {
    const { host } = setup({ deployAfterChecks: 0, deployJob: "rebuild" });
    const backend = await host.signInWithToken("test-token", false);
    const { revision } = await backend.write([{ path: "content/pages/about.json", content: "{}" }], {
      message: "Update About",
      expectedRevision: await backend.revision(),
    });
    expect(await backend.deployStatus(revision)).toEqual({ state: "unknown" });
  });
});

describe("on a full-stack site's server", () => {
  const ALICE = { name: "Alice Editor", email: "alice@example.org" };

  function server() {
    const fake = fakeGitLab({ project: "parish/web/site", files: FILES });
    const git = gitlab({ project: "parish/web/site", fetch: fake.fetch }).server?.({ token: "test-token" });
    if (!git) throw new Error("gitlab() has no server access");
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
    const saved = await (await git.at(revision, ALICE)).write([{ path: "content/pages/about.json", content: "{}" }], {
      message: "Update About",
      expectedRevision: revision,
    });
    expect(fake.commitAuthors.get(saved.revision)).toEqual(ALICE);
    expect((await (await git.at(saved.revision)).history("content/pages/about.json"))[0]?.author).toBe(ALICE.name);

    await expect(
      (await git.at(revision, ALICE)).write([{ path: "content/site.json", content: "{}" }], {
        message: "Late",
        expectedRevision: revision,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
