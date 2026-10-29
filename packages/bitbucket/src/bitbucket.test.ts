import {
  BITBUCKET_PIPELINE_NAMES,
  BITBUCKET_SCHEDULES,
  bitbucketCronAt,
  bitbucketCronInstant,
  bitbucketPipelines,
  CodeChangeError,
  ConflictError,
  formatUpdateResult,
  loadSiteContent,
  newTaskRequestId,
  openTaskAnswer,
  type StorageLike,
  sealTaskAnswer,
  TASK_BRANCH_PREFIX,
  taskKeys,
} from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { allPages, bitbucketRequest } from "./api.js";
import { type BrowserLocation, bitbucket, bitbucketSetup } from "./index.js";
import { fakeBitbucket } from "./testing.js";

const FILES = {
  "content/site.json": '{"version":1,"title":"St. Joseph"}',
  "content/pages/index.json": '{"version":1,"data":{"root":{"props":{"title":"Home"}},"content":[]}}',
  "content/pages/about.json": '{"version":1,"data":{"root":{"props":{"title":"About"}},"content":[]}}',
  "public/media/logo.svg": "<svg/>",
  "src/styles.css": "@import 'tailwindcss';",
  "bitbucket-pipelines.yml": bitbucketPipelines("goodfellow"),
};

const TOKEN = "editor@example.org:test-token";

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

function setup(options: Partial<Parameters<typeof fakeBitbucket>[0]> = {}, clientId?: string) {
  const fake = fakeBitbucket({ repo: "parish/site", files: FILES, ...options });
  const local = memoryStorage();
  const session = memoryStorage();
  const location = fakeLocation("https://parish.example/admin/#/settings/theme");
  const host = bitbucket({
    repo: "parish/site",
    clientId,
    fetch: fake.fetch,
    storage: { local, session },
    location,
  });
  return { fake, host, local, session, location };
}

async function signedIn(options: Partial<Parameters<typeof fakeBitbucket>[0]> = {}) {
  const context = setup(options);
  return { ...context, backend: await context.host.signInWithToken(TOKEN, false) };
}

describe("signing in with a token", () => {
  it("signs in with an API token and its email address, loads the site and saves it where asked", async () => {
    const { host, local, session } = setup();
    expect(host.canRedirect).toBe(false);
    expect(host.tokenLinks?.[0]?.url).toBe("https://bitbucket.org/parish/site/admin/access-tokens");
    const backend = await host.signInWithToken(TOKEN, true);
    expect(backend.user).toMatchObject({ login: "editor", name: "Test Editor" });
    expect(local.items.size).toBe(1);
    expect(session.items.size).toBe(0);
    const content = await loadSiteContent(backend);
    expect(content.pages.map((page) => page.path)).toEqual(["/", "/about"]);
    expect(await backend.list("public/media")).toEqual(["public/media/logo.svg"]);
    expect(await backend.read("src/styles.css")).toBeUndefined();
  });

  it("signs in with a repository access token, which belongs to no account", async () => {
    const { host } = setup({ tokens: { "repo-token": { nickname: "site", access: true } } });
    const backend = await host.signInWithToken("repo-token", false);
    expect(backend.user.login).toBe("access-token");
    expect(await backend.read("content/site.json")).toBe(FILES["content/site.json"]);
  });

  it("refuses accounts that can't publish, tokens Bitbucket doesn't know, and repositories it can't see", async () => {
    const { host } = setup({
      tokens: { "reader@example.org:token": { nickname: "reader", permission: "read" } },
    });
    await expect(host.signInWithToken("reader@example.org:token", false)).rejects.toMatchObject({
      problem: "cant-publish",
    });
    await expect(host.signInWithToken("nope", false)).rejects.toMatchObject({ problem: "invalid" });
    const other = bitbucket({ repo: "parish/other", fetch: setup().fake.fetch });
    await expect(other.signInWithToken(TOKEN, false)).rejects.toMatchObject({ problem: "no-access" });
  });
});

describe("signing in with Bitbucket", () => {
  const oauth = {
    clientId: "consumer-key",
    callback: "https://parish.example/admin/",
    user: { nickname: "owner", displayName: "Parish Owner" },
  };

  it("sends the browser to Bitbucket and finishes signing in with the token it sends back", async () => {
    const { fake, host, location, session } = setup({ oauth }, "consumer-key");
    expect(host.canRedirect).toBe(true);
    await host.startRedirect(false);
    const sent = new URL(location.assigned[0] ?? "");
    expect(`${sent.origin}${sent.pathname}`).toBe("https://bitbucket.org/site/oauth2/authorize");
    expect(sent.searchParams.get("response_type")).toBe("token");

    const answer = await fake.handle(new Request(sent));
    location.current = answer.headers.get("location") ?? "";
    const backend = await host.restore();
    expect(backend?.user.login).toBe("owner");
    // The token is taken out of the address, which goes back to the screen sign-in started from.
    expect(location.current).toBe("https://parish.example/admin/#/settings/theme");
    expect(session.items.size).toBe(1);
  });

  it("refuses a return whose state doesn't match", async () => {
    const { host, location } = setup({ oauth }, "consumer-key");
    await host.startRedirect(false);
    location.current = "https://parish.example/admin/#access_token=stolen&state=other&expires_in=7200";
    await expect(host.restore()).rejects.toMatchObject({ problem: "redirect-failed" });
  });

  it("forgets a sign-in that has expired", async () => {
    const { host, local } = setup({ oauth }, "consumer-key");
    local.setItem(
      "goodfellow:bitbucket:parish/site",
      JSON.stringify({ type: "oauth", access: "oauth-1", expiresAt: Date.now() - 1000 }),
    );
    await expect(host.restore()).rejects.toMatchObject({ problem: "invalid" });
    expect(local.items.size).toBe(0);
  });
});

describe("the API", () => {
  it("never sends the sign-in to an address outside Bitbucket's API, even one Bitbucket names", async () => {
    const asked: string[] = [];
    const api = {
      apiUrl: "https://api.bitbucket.org/2.0",
      authorization: async () => "Bearer secret",
      fetch: (async (input: RequestInfo | URL) => {
        asked.push(String(input));
        return Response.json({ values: [1], next: "https://cdn.example/page/2" });
      }) as typeof fetch,
    };
    await expect(bitbucketRequest(api, "https://api.bitbucket.org.example/2.0/user")).rejects.toThrow(
      /outside its API/,
    );
    await expect(allPages(api, "/repositories/parish/site/refs/branches")).rejects.toThrow(/outside its API/);
    expect(asked).toEqual(["https://api.bitbucket.org/2.0/repositories/parish/site/refs/branches"]);
  });

  it("refuses a repository that isn't a workspace and a name", () => {
    expect(() => bitbucket({ repo: "parish/site/.." })).toThrow(/workspace\/repository/);
    expect(() => bitbucket({ repo: "parish/site", contentOnly: true, code: "code" })).toThrow(/workspace\/repository/);
  });
});

describe("publishing", () => {
  const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;

  it("creates, updates and deletes files in one commit that names the editor", async () => {
    const { fake, backend } = await signedIn();
    const before = fake.repo.head();
    const { revision } = await backend.write(
      [
        { path: "content/pages/about.json", content: about("About us") },
        { path: "content/pages/new.json", content: about("New") },
        { path: "content/pages/index.json", delete: true },
        { path: "content/pages/missing.json", delete: true },
      ],
      { message: "Update pages", expectedRevision: await backend.revision() },
    );
    expect(revision).toBe(fake.repo.head());
    expect(fake.repo.commitAt(revision)?.parent).toBe(before);
    expect(fake.repo.commitAt(revision)?.message).toBe("Update pages");
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("About us"));
    expect(fake.repo.files().has("content/pages/index.json")).toBe(false);
    expect(await backend.list("content/pages")).toEqual(["content/pages/about.json", "content/pages/new.json"]);
  });

  it("uploads files that aren't text, such as images, and reads them back", async () => {
    const { fake, backend } = await signedIn();
    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x9f]);
    await backend.write([{ path: "public/media/photo.jpg", bytes: photo }], {
      message: "Upload",
      expectedRevision: await backend.revision(),
    });
    expect(fake.repo.files().get("public/media/photo.jpg")).toEqual(photo);
    expect(await backend.readBytes("public/media/photo.jpg")).toEqual(photo);
    expect((await backend.fileSizes?.("public/media"))?.get("public/media/photo.jpg")).toBe(5);
  });

  it("changes the site's config, which isn't in the folders it reads", async () => {
    const { fake, backend } = await signedIn();
    await backend.write([{ path: "goodfellow.config.tsx", content: "export default {};\n" }], {
      message: "Config",
      expectedRevision: await backend.revision(),
    });
    expect(fake.repo.files().get("goodfellow.config.tsx")).toBe("export default {};\n");
  });

  it("refuses to save over someone else's commit", async () => {
    const { fake, backend } = await signedIn();
    const loaded = await backend.revision();
    fake.commit("content/pages/about.json", about("Theirs"));
    await expect(
      backend.write([{ path: "content/pages/about.json", content: about("Mine") }], {
        message: "Mine",
        expectedRevision: loaded,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("Theirs"));
  });

  it("reads what others changed when its own commit is too far down the branch to find", async () => {
    const fake = fakeBitbucket({ repo: "parish/site", files: FILES });
    const host = bitbucket({
      repo: "parish/site",
      fetch: async (input, init) => {
        const response = await fake.fetch(input, init);
        // Others publish many times while the save is answered.
        if (init?.method === "POST" && String(input).endsWith("/src")) {
          for (let n = 0; n < 25; n++) fake.commit("content/site.json", `{"version":1,"title":"Theirs ${n}"}`);
        }
        return response;
      },
      storage: { local: memoryStorage(), session: memoryStorage() },
      location: fakeLocation("https://parish.example/admin/"),
    });
    const backend = await host.signInWithToken(TOKEN, false);
    await loadSiteContent(backend);
    const { revision } = await backend.write([{ path: "content/pages/about.json", content: about("About us") }], {
      message: "Update",
      expectedRevision: await backend.revision(),
    });
    expect(revision).toBe(fake.repo.head());
    expect(await backend.read("content/site.json")).toBe('{"version":1,"title":"Theirs 24"}');
    expect(await backend.read("content/pages/about.json")).toBe(about("About us"));
  });

  it("reads files nobody changed from what it read before, after a publish", async () => {
    const { fake, backend } = await signedIn();
    await loadSiteContent(backend);
    await backend.write([{ path: "content/pages/about.json", content: about("About us") }], {
      message: "Update",
      expectedRevision: await backend.revision(),
    });
    const before = fake.requests.length;
    await backend.read("content/site.json");
    await backend.read("content/pages/about.json");
    const reads = fake.requests
      .slice(before)
      .filter((request) => /\/src\/[0-9a-f]{40}\/content\/(site|pages\/about)/.test(request.path));
    expect(reads.map((request) => request.path.split("/").at(-1))).toEqual(["about.json"]);
  });

  it("reports deploys from Vercel's build status, counting a commit it hasn't reported on yet as building", async () => {
    const { fake, backend } = await signedIn({ deployAfterChecks: 1 });
    const { revision } = await backend.write([{ path: "content/pages/about.json", content: about("New") }], {
      message: "Update",
      expectedRevision: await backend.revision(),
    });
    expect((await backend.deployStatus(revision)).state).toBe("building");
    const live = await backend.deployStatus(revision);
    expect(live).toMatchObject({ state: "live", detailsUrl: expect.stringContaining("vercel.com") });
    fake.failBuild(revision);
    expect((await backend.deployStatus(revision)).state).toBe("failed");
  });
});

describe("version history", () => {
  it("lists a file's versions, newest first, a page at a time, and reads each one", async () => {
    const { fake, backend } = await signedIn();
    const first = fake.commit(
      "content/pages/about.json",
      '{"version":1,"data":{"root":{"props":{"title":"A"}},"content":[]}}',
      "First",
    );
    fake.commit(
      "content/pages/about.json",
      '{"version":1,"data":{"root":{"props":{"title":"B"}},"content":[]}}',
      "Second",
    );
    await backend.revision();
    const versions = await backend.history("content/pages/about.json", { perPage: 2 });
    expect(versions.map((version) => version.message)).toEqual(["Second", "First"]);
    expect((await backend.history("content/pages/about.json", { perPage: 2, page: 2 })).map((v) => v.message)).toEqual([
      "Initial commit",
    ]);
    expect(await backend.readAt("content/pages/about.json", first)).toContain('"A"');
    expect(await backend.readAt("content/pages/gone.json", first)).toBeUndefined();
    expect(await backend.changedPaths(first, await backend.revision())).toEqual(["content/pages/about.json"]);
    expect(await backend.filesAt(first).read("content/pages/about.json")).toContain('"A"');
  });
});

describe("drafts", () => {
  const about = (title: string) => `{"version":1,"data":{"root":{"props":{"title":"${title}"}},"content":[]}}`;

  async function withDraft() {
    const context = await signedIn();
    const drafts = context.backend.drafts;
    if (!drafts) throw new Error("No drafts");
    const draft = await drafts.create("20261014-abc123");
    await draft.store.write([{ path: "content/pages/about.json", content: about("About us") }], {
      message: "Draft changes",
      expectedRevision: await draft.store.revision(),
    });
    return { ...context, drafts, draft };
  }

  it("keeps changes on a branch of their own, and publishes them in one commit", async () => {
    const { fake, draft, drafts } = await withDraft();
    expect(fake.repo.files().get("content/pages/about.json")).toBe(FILES["content/pages/about.json"]);
    expect(await draft.paths()).toEqual(["content/pages/about.json"]);
    expect(await drafts.list()).toEqual(["20261014-abc123"]);
    const { revision } = await draft.publish("Update About");
    expect(fake.repo.head()).toBe(revision);
    expect(fake.repo.files().get("content/pages/about.json")).toBe(about("About us"));
    await expect(drafts.open("20261014-abc123")).rejects.toMatchObject({ problem: "not-found" });
  });

  it("submits a draft for review as a pull request, once", async () => {
    const { fake, draft } = await withDraft();
    const first = await draft.submitForReview({ title: "New About page" });
    expect(first.url).toBe("https://bitbucket.org/parish/site/pull-requests/1");
    expect(await draft.submitForReview({ title: "Again" })).toEqual(first);
    expect(fake.repo.reviews).toEqual([
      expect.objectContaining({ branch: "goodfellow-draft-20261014-abc123", target: "main", title: "New About page" }),
    ]);
  });

  it("asks workspace members for their review, lists drafts waiting for it, and declines it when the draft is thrown away", async () => {
    const context = await signedIn({ members: ["olivia"] });
    const drafts = context.backend.drafts;
    if (!drafts) throw new Error("No drafts");
    const draft = await drafts.create("20261014-abc123");
    await draft.store.write([{ path: "content/pages/about.json", content: about("About us") }], {
      message: "Draft changes",
      expectedRevision: await draft.store.revision(),
    });
    // Its author, and people outside the workspace, aren't asked.
    await draft.submitForReview({ title: "New About page", reviewers: ["olivia", "editor", "stranger"] });
    expect(context.fake.repo.reviews[0]?.reviewers).toEqual(["olivia"]);
    expect(await drafts.reviews()).toEqual([
      { name: "20261014-abc123", url: "https://bitbucket.org/parish/site/pull-requests/1", title: "New About page" },
    ]);
    await draft.discard();
    expect(context.fake.repo.reviews[0]?.state).toBe("closed");
  });

  it("discards a draft, and refuses names it has already", async () => {
    const { fake, draft, drafts } = await withDraft();
    await expect(drafts.create("20261014-abc123")).rejects.toMatchObject({ problem: "exists" });
    await draft.discard();
    expect(fake.repo.branches.has("goodfellow-draft-20261014-abc123")).toBe(false);
  });
});

describe("editors", () => {
  it("lists the repository's people, and gives someone in the workspace permission to edit", async () => {
    const { fake, backend } = await signedIn({ members: ["helper"] });
    const editors = backend.editors;
    if (!editors) throw new Error("No editors");
    const list = await editors.list();
    expect(list.manage).toBe("yes");
    expect(list.editors).toEqual([expect.objectContaining({ login: "editor", role: "owner", self: true })]);
    // An Admin's own sign-in can change editors, with no owner token.
    await editors.invite("helper", "editor");
    expect(fake.permissions.get("{helper}")?.permission).toBe("write");
    await expect(editors.invite("helper", "editor")).rejects.toMatchObject({ problem: "already" });
    await expect(editors.invite("stranger", "editor")).rejects.toMatchObject({ problem: "not-found" });
    const helper = (await editors.list()).editors.find((editor) => editor.login === "helper");
    if (!helper) throw new Error("No helper");
    await editors.setRole(helper, "owner");
    expect(fake.permissions.get("{helper}")?.permission).toBe("admin");
    await editors.remove(helper);
    expect(fake.permissions.has("{helper}")).toBe(false);
  });

  it("asks for an owner token where the sign-in can't see everyone's permissions", async () => {
    const { backend } = await signedIn({
      tokens: { [TOKEN]: { nickname: "editor", permission: "write" } },
    });
    const list = await backend.editors?.list();
    expect(list).toMatchObject({ manage: "no", editors: [expect.objectContaining({ self: true, role: "editor" })] });
    await expect(backend.ownerAccess?.applyToken(TOKEN)).rejects.toMatchObject({ problem: "not-allowed" });
  });
});

describe("updates and scheduled changes", () => {
  it("turns on Pipelines and adds the nightly schedule", async () => {
    const { fake, backend } = await signedIn();
    const { updates } = backend;
    if (!updates) throw new Error("No updates");
    expect(await updates.setup()).toBe("needs-setup");
    await updates.enable?.();
    expect(fake.settings.pipelines).toBe(true);
    expect(fake.schedules.map(({ pattern, cron, branch }) => ({ pattern, cron, branch }))).toEqual([
      { pattern: BITBUCKET_PIPELINE_NAMES.update, cron: BITBUCKET_SCHEDULES.update, branch: "main" },
    ]);
    expect(await updates.setup()).toBe("ready");
  });

  it("puts scheduled changes live at their time, with a schedule pinned to each, and removes those that passed", async () => {
    const { fake, backend } = await signedIn();
    const scheduledBuilds = backend.scheduledBuilds;
    expect(await scheduledBuilds?.timing()).toBe("exact");
    const soon = new Date(Date.now() + 3_600_000);
    soon.setUTCSeconds(0, 0);
    const later = new Date(Date.UTC(soon.getUTCFullYear() + 1, 2, 4, 9, 30));
    // The nightly schedule isn't the admin panel's to remove.
    fake.schedules.push({
      uuid: "{nightly}",
      pattern: BITBUCKET_PIPELINE_NAMES.update,
      branch: "main",
      cron: BITBUCKET_SCHEDULES.update,
      enabled: true,
    });
    await scheduledBuilds?.sync?.([soon, later, new Date(Date.now() - 60_000)]);
    const ours = () =>
      fake.schedules.filter((schedule) => schedule.pattern === BITBUCKET_PIPELINE_NAMES.scheduled).map((s) => s.cron);
    expect(ours()).toEqual([bitbucketCronAt(soon), bitbucketCronAt(later)]);
    expect(bitbucketCronAt(later)).toBe(`0 30 9 4 3 ? ${later.getUTCFullYear()}`);
    expect(bitbucketCronInstant(bitbucketCronAt(later))).toEqual(later);

    await scheduledBuilds?.sync?.([later]);
    expect(ours()).toEqual([bitbucketCronAt(later)]);
    expect(fake.schedules.some((schedule) => schedule.uuid === "{nightly}")).toBe(true);
  });

  it("says when the sign-in can't add schedules, and has changes go live with the nightly update without the pipeline", async () => {
    const { fake, backend } = await signedIn({ tokens: { [TOKEN]: { nickname: "editor", permission: "write" } } });
    await expect(backend.scheduledBuilds?.sync?.([new Date(Date.now() + 3_600_000)])).rejects.toMatchObject({
      problem: "not-allowed",
    });
    fake.commit(
      "bitbucket-pipelines.yml",
      "pipelines:\n  custom:\n    update:\n      - step:\n          script: [npx goodfellow nightly --output x]\n",
    );
    await backend.revision();
    expect(await backend.scheduledBuilds?.timing()).toBe("nightly");
  });

  it("says the setup has no update without the pipelines", async () => {
    const { fake, backend } = await signedIn();
    fake.commit("bitbucket-pipelines.yml", "pipelines: {}\n");
    await backend.revision();
    expect(await backend.updates?.setup()).toBe("missing");
  });

  it("runs the update with the release asked for, rebuilds, and reads what the last run did from its log", async () => {
    const { fake, backend } = await signedIn({ pipelines: true });
    const updates = backend.updates;
    if (!updates) throw new Error("No updates");
    await updates.start("0.6.0");
    await updates.rebuild?.();
    expect(fake.pipelines.map(({ pattern, variables }) => ({ pattern, variables }))).toEqual([
      { pattern: "update", variables: { GOODFELLOW_UPDATE: "0.6.0" } },
      { pattern: "update", variables: { GOODFELLOW_REBUILD: "true" } },
    ]);
    fake.addUpdateRun(`Installing\n${formatUpdateResult({ state: "updated", from: "0.5.0", to: "0.5.1" })}\n`);
    expect(await updates.lastRun()).toMatchObject({ state: "updated", result: { to: "0.5.1" } });
    fake.addUpdateRun("", "IN_PROGRESS");
    expect((await updates.lastRun())?.state).toBe("running");
  });

  it("keeps when the site rebuilds overnight in the nightly schedule and a repository variable", async () => {
    const { fake, backend } = await signedIn();
    const nightly = backend.updates?.nightly;
    if (!nightly) throw new Error("No nightly setting");
    expect(await nightly.supported()).toBe(true);
    expect(await nightly.get()).toBeUndefined();
    await backend.updates?.enable?.();
    expect(await nightly.get()).toBe("changed");
    await nightly.set("always");
    expect(fake.variables.get("GOODFELLOW_NIGHTLY")?.value).toBe("always");
    expect(await nightly.get()).toBe("always");
    await nightly.set("off");
    expect(fake.schedules[0]?.enabled).toBe(false);
    expect(fake.variables.has("GOODFELLOW_NIGHTLY")).toBe(false);
    expect(await nightly.get()).toBe("off");
  });
});

describe("plugins' tasks", () => {
  async function request() {
    const keys = await taskKeys();
    return {
      keys,
      sent: { id: newTaskRequestId(), plugin: "goodfellow-plugin-s3", task: "sign", input: "{}", key: keys.publicKey },
    };
  }

  it("runs the task pipeline and reads the sealed answer from its branch, then deletes it", async () => {
    const { fake, backend } = await signedIn({
      pipelines: true,
      tasks: async (given) =>
        JSON.stringify(await sealTaskAnswer({ ok: true, output: "signed" }, given.GOODFELLOW_TASK_KEY ?? "")),
    });
    const { tasks } = backend;
    if (!tasks) throw new Error("No tasks");
    expect(await tasks.supported()).toBe(true);
    expect(await tasks.secretsPlace()).toEqual({
      kind: "bitbucket",
      url: "https://bitbucket.org/parish/site/admin/pipelines/repository-variables",
    });
    const { keys, sent } = await request();
    const answer = await tasks.run(sent);
    expect(await openTaskAnswer(answer, keys.privateKey)).toEqual({ ok: true, output: "signed" });
    expect(fake.pipelines[0]?.variables).toMatchObject({
      GOODFELLOW_TASK_REQUEST: sent.id,
      GOODFELLOW_TASK_NAME: "sign",
    });
    expect(fake.repo.branches.has(`${TASK_BRANCH_PREFIX}${sent.id}`)).toBe(false);
  });

  it("says when the task couldn't run, or the site doesn't run Pipelines", async () => {
    const { backend, fake } = await signedIn({ pipelines: true });
    const { sent } = await request();
    await expect(backend.tasks?.run(sent)).rejects.toMatchObject({ problem: "failed" });
    fake.settings.pipelines = false;
    await expect(backend.tasks?.run(sent)).rejects.toMatchObject({ problem: "missing" });
  });
});

describe("a repository of content only", () => {
  it("publishes content, and never the site's code", async () => {
    const fake = fakeBitbucket({ repo: "parish/site", files: FILES });
    const host = bitbucket({ repo: "parish/site", contentOnly: true, fetch: fake.fetch, storage: {} });
    const backend = await host.signInWithToken(TOKEN, false);
    expect(backend.contentOnly).toBe(true);
    expect(backend.updates).toBeUndefined();
    await expect(
      backend.write([{ path: "blocks/x.tsx", content: "" }], {
        message: "Code",
        expectedRevision: await backend.revision(),
      }),
    ).rejects.toBeInstanceOf(CodeChangeError);
  });

  it("follows the code repository's version, with the same sign-in, where the config names it", async () => {
    const fake = fakeBitbucket({
      repo: "parish/site-content",
      files: FILES,
      tokens: { [TOKEN]: { nickname: "editor" }, "content-token": { nickname: "content", access: true } },
    });
    fake.addRepo("parish/site", {
      "package.json": JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.5.0" } }),
    });
    const host = () =>
      bitbucket({
        repo: "parish/site-content",
        contentOnly: true,
        code: "parish/site",
        fetch: fake.fetch,
        storage: {},
      });
    const backend = await host().signInWithToken(TOKEN, false);
    const updates = backend.updates;
    expect(updates?.code?.repo).toBe("parish/site");
    expect(updates?.code?.webUrl).toBe("https://bitbucket.org/parish/site");
    expect(await updates?.code?.read("package.json")).toContain("0.5.0");
    // The code repository has no update pipeline of its own: Vercel rebuilds the site, as on GitHub and GitLab.
    expect(await updates?.setup()).toBe("missing");

    // A repository access token reaches only the content repository.
    const tokenBackend = await host().signInWithToken("content-token", false);
    expect(await tokenBackend.updates?.setup()).toBe("no-access");
  });
});

describe("on a full-stack site's server", () => {
  it("reads the revision a browser loaded, and publishes in the editor's name", async () => {
    const fake = fakeBitbucket({
      repo: "parish/site",
      files: FILES,
      tokens: { "site-token": { nickname: "site", access: true } },
    });
    const server = bitbucket({ repo: "parish/site", fetch: fake.fetch }).server?.({ token: "site-token" });
    if (!server) throw new Error("No server");
    const loaded = await server.revision();
    fake.commit("content/pages/index.json", "{}");
    const backend = await server.at(loaded, { name: "Ana Editor", email: "ana@example.org" });
    expect(await backend.read("content/pages/index.json")).toBe(FILES["content/pages/index.json"]);
    await expect(
      backend.write([{ path: "content/pages/index.json", content: "{}\n" }], {
        message: "Mine",
        expectedRevision: loaded,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const current = await bitbucket({ repo: "parish/site", fetch: fake.fetch })
      .server?.({ token: "site-token" })
      .revision();
    const author = await server.at(current ?? "", { name: "Ana Editor", email: "ana@example.org" });
    const { revision } = await author.write([{ path: "content/pages/about.json", content: "{}\n" }], {
      message: "About",
      expectedRevision: current ?? "",
    });
    expect(fake.commitAuthors.get(revision)).toBe("Ana Editor <ana@example.org>");
  });
});

describe("creating a repository", () => {
  it("creates it with every file in its first commit, on main", async () => {
    const fake = fakeBitbucket({ repo: "parish/site" });
    const account = await bitbucketSetup({ fetch: fake.fetch }).signInWithToken(TOKEN);
    const [owner] = await account.owners();
    if (!owner) throw new Error("No owner");
    expect(owner).toMatchObject({ path: "editor", kind: "personal" });
    expect(await account.isAvailable(owner, "broker")).toBe(true);
    const created = await account.createSite({
      owner,
      name: "broker",
      private: false,
      pages: false,
      files: [{ path: "site/broker.json", content: "{}\n" }],
      message: "Add the token broker",
    });
    expect(created).toMatchObject({ repo: "editor/broker", warnings: [] });
    expect(fake.created.get("editor/broker")?.repo.files("main").get("site/broker.json")).toBe("{}\n");
    expect(await account.isAvailable(owner, "broker")).toBe(false);
    await expect(
      account.createSite({ owner, name: "broker", private: false, pages: false, files: [], message: "Again" }),
    ).rejects.toMatchObject({ problem: "name-taken" });
  });
});
