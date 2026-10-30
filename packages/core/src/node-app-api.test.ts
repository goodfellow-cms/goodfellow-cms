import { describe, expect, it } from "vitest";
import { APP_API_HEADER, type AppEditor, isSettingsPath } from "./app-api.js";
import type { OwnersOnlyFields } from "./content/owners-only.js";
import { ConflictError, type FileChange } from "./content/store.js";
import { type CommitAuthor, encodeBase64Bytes, GitApiError, type GitBackend, type ServerGit } from "./git.js";
import { appApi } from "./node-app-api.js";
import { newTaskRequestId, PluginTaskError, type PluginTaskRequest, taskKeys } from "./plugin-tasks.js";
import { FakeRepo, fakeFileBytes } from "./testing.js";

const FILES = {
  "content/site.json": '{"version":1,"title":"St. Joseph"}',
  "content/pages/index.json": '{"version":1,"data":{"root":{"props":{}},"content":[]}}',
  "public/media/logo.png": new Uint8Array([1, 2, 3]),
  "package.json": '{"name":"secret"}',
};

/** The repository as a server reaches it, over a fake one, recording who each commit names. */
function fakeServerGit(repo: FakeRepo) {
  const authors = new Map<string, CommitAuthor>();
  const opened: string[] = [];
  const reviews: {
    from?: string;
    changes: FileChange[];
    title: string;
    author?: string;
    reviewers?: readonly string[];
  }[] = [];
  const taskRuns: { request: PluginTaskRequest; author?: string }[] = [];
  const backend = (revision: string, author?: CommitAuthor): GitBackend => {
    const text = (path: string) => {
      const file = repo.files(revision).get(path);
      return file === undefined ? undefined : new TextDecoder().decode(fakeFileBytes(file));
    };
    return {
      user: { login: author?.name ?? "site" },
      revision: async () => repo.head(),
      read: async (path) => text(path),
      readBytes: async (path) => {
        const file = repo.files(revision).get(path);
        return file === undefined ? undefined : fakeFileBytes(file);
      },
      list: async (dir) => [...repo.files(revision).keys()].filter((path) => path.startsWith(`${dir}/`)).sort(),
      async write(changes: FileChange[], { message, expectedRevision }) {
        if (repo.head() !== expectedRevision) throw new ConflictError();
        const sha = repo.commit(changes, message, { author: author?.name });
        if (author) authors.set(sha, author);
        return { revision: sha };
      },
      changedPaths: async (from, to) => repo.changedPaths(from, to),
      deployStatus: async () => ({ state: "live" }),
      history: async (path) =>
        repo.history(path, revision).map((commit) => ({
          revision: commit.sha,
          date: commit.date,
          message: commit.message,
          ...(commit.author && { author: commit.author }),
        })),
      readAt: async (path, at) => {
        const file = repo.files(at).get(path);
        return file === undefined ? undefined : new TextDecoder().decode(fakeFileBytes(file));
      },
      filesAt: (at) => backend(at),
      signOut: () => {},
      tasks: {
        supported: async () => true,
        secretsPlace: async () => ({
          kind: "github",
          url: "https://github.com/parish/site/settings/secrets/actions/new",
        }),
        async run(request) {
          taskRuns.push({ request, ...(author && { author: author.name }) });
          if (request.task === "slow") throw new PluginTaskError("timeout", "The workflow didn't answer.");
          return `sealed for ${request.id}`;
        },
      },
      drafts: {
        async create(_name, options) {
          const review: (typeof reviews)[number] = {
            ...(options?.from && { from: options.from }),
            changes: [],
            title: "",
          };
          return {
            name: _name,
            store: {
              ...backend(options?.from ?? repo.head(), author),
              revision: async () => "draft",
              async write(changes: FileChange[]) {
                review.changes.push(...changes);
                return { revision: "draft-2" };
              },
            },
            changes: async () => review.changes,
            paths: async () => review.changes.map((change) => change.path),
            publish: async () => ({ revision: "" }),
            async submitForReview({ title, reviewers }) {
              reviews.push({
                ...review,
                title,
                ...(author && { author: author.name }),
                ...(reviewers && { reviewers }),
              });
              return { url: "https://github.example/parish/site/pull/1" };
            },
            discard: async () => {},
          };
        },
        open: async () => {
          throw new Error("no drafts");
        },
        list: async () => [],
        reviews: async () => [],
      },
    };
  };
  const git: ServerGit = {
    revision: async () => repo.head(),
    at: async (revision, author) => {
      opened.push(revision);
      return backend(revision, author);
    },
  };
  return { git, authors, opened, reviews, taskRuns };
}

const ALICE: AppEditor = { login: "alice", name: "Alice Editor", email: "alice@example.org", role: "editor" };
const OWEN: AppEditor = { ...ALICE, login: "owen", name: "Owen Owner", email: "owen@example.org", role: "owner" };

function setup(
  editor: AppEditor | null | false = ALICE,
  {
    contentOnly = false,
    codeChanges,
    ownersOnly,
  }: { contentOnly?: boolean; codeChanges?: "review" | "publish"; ownersOnly?: OwnersOnlyFields } = {},
) {
  const repo = new FakeRepo(FILES);
  const server = fakeServerGit(repo);
  const errors: unknown[] = [];
  let signedIn = editor;
  const api = appApi({
    git: contentOnly ? { ...server.git, contentOnly } : server.git,
    authorize: () => signedIn,
    signIn: "/sign-in?next=/admin/",
    signOut: "/sign-out",
    onError: (error) => errors.push(error),
    ...(codeChanges && { codeChanges }),
    ...(ownersOnly && { ownersOnly }),
  });
  const call = (endpoint: string, init: RequestInit & { query?: Record<string, string> } = {}) => {
    const url = new URL(`https://parish.example/api/goodfellow/${endpoint}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    return api(
      new Request(url, {
        ...init,
        headers: { [APP_API_HEADER]: "1", "sec-fetch-site": "same-origin", ...init.headers },
      }),
      endpoint,
    );
  };
  const post = (endpoint: string, body: unknown) =>
    call(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    repo,
    ...server,
    errors,
    call,
    post,
    signIn: (next: AppEditor | null | false) => {
      signedIn = next;
    },
  };
}

describe("appApi", () => {
  it("says who's signed in, or where to sign in", async () => {
    const { call, signIn } = setup();
    expect(await (await call("session")).json()).toEqual({
      signedIn: true,
      user: { login: "alice", name: "Alice Editor" },
      role: "editor",
      ai: [],
      codeReview: true,
      signOut: "/sign-out",
    });
    signIn(null);
    expect(await (await call("session/")).json()).toEqual({
      signedIn: false,
      signIn: "/sign-in?next=/admin/",
      signOut: "/sign-out",
    });
    signIn(false);
    expect(await (await call("session")).json()).toMatchObject({ signedIn: false, notAllowed: true });
  });

  it("never writes code to a repository that holds only the site's content", async () => {
    const { call, post, repo } = setup(OWEN, { contentOnly: true });
    expect(await (await call("session")).json()).toMatchObject({ signedIn: true, contentOnly: true });
    const response = await post("write", {
      changes: [{ path: "blocks/installed/index.ts", content: "export {};" }],
      message: "Add a block",
      expectedRevision: repo.head(),
    });
    expect(response.status).toBe(400);
    expect(repo.files(repo.head()).has("blocks/installed/index.ts")).toBe(false);

    const saved = await post("write", {
      changes: [{ path: "content/pages/about.json", content: "{}" }],
      message: "Add About",
      expectedRevision: repo.head(),
    });
    expect(saved.status).toBe(200);
  });

  it("answers nothing else to people who aren't signed in or allowed", async () => {
    const { call, signIn } = setup(null);
    expect((await call("revision")).status).toBe(401);
    signIn(false);
    const response = await call("revision");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "not-allowed" });
  });

  it("refuses requests another site could have made", async () => {
    const { call } = setup();
    expect((await call("revision", { headers: { [APP_API_HEADER]: "" } })).status).toBe(403);
    expect((await call("revision", { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(403);
    expect((await call("revision", { headers: { "sec-fetch-site": "same-site" } })).status).toBe(403);
    // Without Sec-Fetch-Site, the origin must be the site's own.
    const noFetchSite = (origin: string) =>
      appApi({ git: setup().git, authorize: () => ALICE, signIn: "/" })(
        new Request("https://parish.example/api/goodfellow/revision", {
          headers: { [APP_API_HEADER]: "1", origin },
        }),
        "revision",
      );
    expect((await noFetchSite("https://evil.example")).status).toBe(403);
    expect((await noFetchSite("https://parish.example")).status).toBe(200);
  });

  it("reads the revision the browser loaded, even after someone publishes", async () => {
    const { call, repo } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    repo.write("content/site.json", '{"version":1,"title":"Changed"}');
    const file = await call("file", { query: { path: "content/site.json", revision } });
    expect(await file.json()).toEqual({ content: FILES["content/site.json"] });
    const bytes = await call("file", { query: { path: "public/media/logo.png", revision, as: "bytes" } });
    expect(await bytes.json()).toEqual({ base64: encodeBase64Bytes(new Uint8Array([1, 2, 3])) });
    const missing = await call("file", { query: { path: "content/menus.json", revision } });
    expect(missing.status).toBe(404);
    const files = await call("files", { query: { dir: "content/pages", revision } });
    expect(await files.json()).toEqual({ files: ["content/pages/index.json"] });
  });

  it("keeps one backend for each revision read, rather than one for each file", async () => {
    const { call, opened } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    await call("file", { query: { path: "content/site.json", revision } });
    await call("file", { query: { path: "content/pages/index.json", revision } });
    await call("files", { query: { dir: "content", revision } });
    expect(opened).toEqual([revision]);
  });

  it("reads several files at once", async () => {
    const { call, post } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const response = await post("files", { revision, paths: ["content/site.json", "content/menus.json"] });
    expect(await response.json()).toEqual({ files: { "content/site.json": FILES["content/site.json"] } });
  });

  it("reads and lists only the folders the admin panel edits", async () => {
    const { call, post } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    for (const path of ["package.json", "../content/site.json", "content/../package.json", "/etc/passwd"]) {
      expect((await call("file", { query: { path, revision } })).status).toBe(400);
      expect((await call("version", { query: { path, revision } })).status).toBe(400);
    }
    expect((await call("files", { query: { dir: "", revision } })).status).toBe(400);
    expect((await call("files", { query: { dir: "src", revision } })).status).toBe(400);
    expect((await post("files", { revision, paths: ["package.json"] })).status).toBe(400);
    expect((await call("file", { query: { path: "content/site.json", revision: "main" } })).status).toBe(400);
  });

  it("publishes in the editor's name, and refuses to save over someone else's change", async () => {
    const { call, post, repo, authors } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const saved = await post("write", {
      changes: [
        { path: "content/pages/about.json", content: "{}" },
        { path: "public/media/photo.png", base64: encodeBase64Bytes(new Uint8Array([9])) },
      ],
      message: "Add About",
      expectedRevision: revision,
    });
    const { revision: next } = (await saved.json()) as { revision: string };
    expect(authors.get(next)).toEqual({ name: "Alice Editor", email: "alice@example.org" });
    expect([...fakeFileBytes(repo.files().get("public/media/photo.png") ?? "")]).toEqual([9]);

    const late = await post("write", {
      changes: [{ path: "content/pages/index.json", content: "{}" }],
      message: "Late",
      expectedRevision: revision,
    });
    expect(late.status).toBe(409);
  });

  it("lets only owners change settings, whatever the browser sends", async () => {
    const { call, post, signIn } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const settings = { changes: [{ path: "content/site.json", content: "{}" }], message: "Retitle" };
    const refused = await post("write", { ...settings, expectedRevision: revision });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "owners-only" });
    const outside = await post("write", {
      changes: [{ path: "package.json", content: "{}" }],
      message: "Sneaky",
      expectedRevision: revision,
    });
    expect(outside.status).toBe(400);

    signIn(OWEN);
    expect((await post("write", { ...settings, expectedRevision: revision })).status).toBe(200);
  });

  it("lets only owners change settings blocks mark as theirs", async () => {
    const ownersOnly: OwnersOnlyFields = { "custom-html": { fields: ["sanitize"], defaults: { sanitize: true } } };
    const { call, post, signIn } = setup(ALICE, { ownersOnly });
    const page = (sanitize?: boolean, html = "<p>Hi</p>") =>
      JSON.stringify({
        version: 1,
        data: {
          root: { props: { title: "About" } },
          content: [
            { type: "custom-html", props: { id: "html-1", html, ...(sanitize !== undefined && { sanitize }) } },
          ],
        },
      });
    const write = async (content: string) => {
      const { revision } = (await (await call("revision")).json()) as { revision: string };
      return post("write", {
        changes: [{ path: "content/pages/about.json", content }],
        message: "Edit About",
        expectedRevision: revision,
      });
    };

    expect((await write(page())).status).toBe(200);
    expect((await write(page(undefined, "<p>Hello</p>"))).status).toBe(200);
    const refused = await write(page(false, "<script>alert(1)</script>"));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "owners-only", paths: ["content/pages/about.json"] });

    signIn(OWEN);
    expect((await write(page(false))).status).toBe(200);
    signIn(ALICE);
    // The owner's block used as written is theirs whole: its HTML would run as the editor wrote it.
    expect((await write(page(false, "<p>Changed</p>"))).status).toBe(403);
    expect((await write(page(true))).status).toBe(403);
    // Sent as bytes, the page is read all the same.
    signIn(OWEN);
    expect((await write(page())).status).toBe(200);
    signIn(ALICE);
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const bytes = await post("write", {
      changes: [
        {
          path: "content/pages/about.json",
          base64: encodeBase64Bytes(new TextEncoder().encode(page(false, "<script>x</script>"))),
        },
      ],
      message: "Edit About",
      expectedRevision: revision,
    });
    expect(bytes.status).toBe(403);
  });

  it("refuses media the site can't use, and SVGs that skipped the admin panel's cleaning", async () => {
    const { call, post, repo } = setup(OWEN);
    const write = async (path: string, text: string) => {
      const { revision } = (await (await call("revision")).json()) as { revision: string };
      return post("write", {
        changes: [{ path, base64: encodeBase64Bytes(new TextEncoder().encode(text)) }],
        message: "Upload",
        expectedRevision: revision,
      });
    };
    const page = await write("public/media/x.html", "<script>fetch('/api/goodfellow/write')</script>");
    expect(page.status).toBe(400);
    expect(await page.json()).toEqual({ error: "unsafe-media", paths: ["public/media/x.html"] });
    const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    expect((await write("public/media/x.svg", svg("<script>alert(1)</script>"))).status).toBe(400);
    expect((await write("public/media/x.Svg", svg('<rect onload="alert(1)"/>'))).status).toBe(400);
    expect((await write("public/media/logo.svg", svg('<rect width="4" height="4"/>'))).status).toBe(200);
    expect(repo.files(repo.head()).has("public/media/x.html")).toBe(false);
  });

  it("lets editors add files to the media storage, but not move it", async () => {
    const storage = (url: string, files: Record<string, unknown> = {}) =>
      JSON.stringify({ version: 1, plugin: "goodfellow-plugin-s3", url, files });
    const { call, post, signIn } = setup(OWEN);
    const write = async (content: string) => {
      const { revision } = (await (await call("revision")).json()) as { revision: string };
      return post("write", {
        changes: [{ path: "content/media-storage.json", content }],
        message: "Storage",
        expectedRevision: revision,
      });
    };
    expect((await write(storage("https://media.example.org"))).status).toBe(200);
    signIn(ALICE);
    expect((await write(storage("https://media.example.org", { "/media/a.mp4": { size: 4 } }))).status).toBe(200);
    const moved = await write(storage("https://evil.example", { "/media/a.mp4": { size: 4 } }));
    expect(moved.status).toBe(403);
    expect(await moved.json()).toEqual({ error: "owners-only", paths: ["content/media-storage.json"] });
  });

  it("never takes settings from editors for review either", async () => {
    const { call, post } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const response = await post("review", {
      changes: [{ path: "content/site.json", content: "{}" }],
      title: "New address",
      from: revision,
    });
    expect(response.status).toBe(403);
  });

  it("adds plugins only through a review, which only owners can ask for", async () => {
    const { call, post, signIn, reviews } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const install = {
      changes: [
        { path: "package.json", content: '{"dependencies":{"goodfellow-plugin-guestbook":"1.0.0"}}' },
        { path: "plugins/installed/index.ts", content: "export const installedPlugins = [];" },
      ],
      title: "Install the Guestbook plugin",
      description: "It asks to reach https://guestbook.example.com.",
      from: revision,
    };
    expect((await post("review", install)).status).toBe(403);
    expect((await call("version", { query: { path: "package.json", revision } })).status).toBe(400);
    signIn(OWEN);
    const direct = await post("write", {
      changes: [{ path: "plugins/installed/index.ts", content: "" }],
      message: "Sneaky",
      expectedRevision: revision,
    });
    expect(await direct.json()).toEqual({ error: "review-only" });
    const read = await call("version", { query: { path: "package.json", revision } });
    expect(await read.json()).toEqual({ content: '{"name":"secret"}' });
    const outside = await post("review", {
      ...install,
      changes: [...install.changes, { path: "goodfellow.config.tsx.bak", content: "" }],
    });
    expect(outside.status).toBe(400);
    const answer = await post("review", install);
    expect(await answer.json()).toEqual({ url: "https://github.example/parish/site/pull/1" });
    expect(reviews).toEqual([
      {
        from: revision,
        changes: install.changes,
        title: "Install the Guestbook plugin",
        author: "Owen Owner",
      },
    ]);
  });

  it("sends owners' changes to the site's code for review, unless the site lets them publish it", async () => {
    const { call, post, reviews, signIn } = setup(OWEN);
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const block = {
      changes: [
        { path: "blocks/installed/index.ts", content: "export const installedBlocks = {};" },
        { path: "content/pages/index.json", content: "{}" },
      ],
    };
    const direct = await post("write", { ...block, message: "Add a block", expectedRevision: revision });
    expect(direct.status).toBe(403);
    expect(await direct.json()).toEqual({ error: "review-only" });
    for (const path of ["components/ui/button.tsx", "lib/utils.ts", "hooks/use-mobile.ts"]) {
      const answer = await post("write", {
        changes: [{ path, content: "" }],
        message: "x",
        expectedRevision: revision,
      });
      expect(answer.status, path).toBe(403);
    }

    const answer = await post("review", { ...block, title: "Add the Hero block", from: revision });
    expect(await answer.json()).toEqual({ url: "https://github.example/parish/site/pull/1" });
    // For a developer, never the site's reviewers.
    expect(reviews).toEqual([
      { from: revision, changes: block.changes, title: "Add the Hero block", author: "Owen Owner" },
    ]);
    signIn(ALICE);
    expect((await post("review", { ...block, title: "Add the Hero block", from: revision })).status).toBe(403);

    const publishing = setup(OWEN, { codeChanges: "publish" });
    expect(await (await publishing.call("session")).json()).not.toHaveProperty("codeReview");
    const saved = await publishing.post("write", { ...block, message: "Add a block", expectedRevision: revision });
    expect(saved.status).toBe(200);
  });

  it("holds editors to their limits, and sends what's outside them to the site's reviewers", async () => {
    const { repo, call, post, reviews } = setup();
    repo.commit(
      [
        { path: "content/pages/about.json", content: '{"version":1,"data":{"root":{"props":{}},"content":[]}}' },
        {
          path: "content/permissions.json",
          content: JSON.stringify({ version: 1, people: { Alice: { pages: ["/about"] } }, reviewers: ["owen"] }),
        },
      ],
      "Limits",
    );
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const page = (path: string) => ({
      path,
      content: '{"version":1,"data":{"root":{"props":{"title":"New"}},"content":[]}}',
    });
    const home = await post("write", {
      changes: [page("content/pages/index.json")],
      message: "Home",
      expectedRevision: revision,
    });
    expect(home.status).toBe(403);
    expect(await home.json()).toEqual({ error: "outside-limits", paths: ["content/pages/index.json"] });
    const about = await post("write", {
      changes: [page("content/pages/about.json")],
      message: "About",
      expectedRevision: revision,
    });
    expect(about.status).toBe(200);

    const review = await post("review", { changes: [page("content/pages/index.json")], title: "Home", from: revision });
    expect(review.status).toBe(200);
    expect(reviews).toEqual([
      {
        from: revision,
        changes: [page("content/pages/index.json")],
        title: "Home",
        author: "Alice Editor",
        reviewers: ["owen"],
      },
    ]);
  });

  it("gives versions, changes between revisions and whether the site is live", async () => {
    const { call, post } = setup();
    const { revision } = (await (await call("revision")).json()) as { revision: string };
    const { revision: next } = (await (
      await post("write", {
        changes: [{ path: "content/pages/index.json", content: "{}" }],
        message: "Edit home",
        expectedRevision: revision,
      })
    ).json()) as { revision: string };
    const history = await call("history", { query: { path: "content/pages/index.json", revision: next } });
    expect(((await history.json()) as { versions: unknown[] }).versions).toHaveLength(2);
    // A folder's history is the whole site's, for restoring it.
    const site = await call("history", { query: { path: "content", revision: next } });
    expect(((await site.json()) as { versions: unknown[] }).versions).toHaveLength(2);
    expect((await call("history", { query: { path: "src", revision: next } })).status).toBe(400);
    const version = await call("version", { query: { path: "content/pages/index.json", revision } });
    expect(await version.json()).toEqual({ content: FILES["content/pages/index.json"] });
    const changed = await call("changed", { query: { from: revision, to: next } });
    expect(await changed.json()).toEqual({ paths: ["content/pages/index.json"] });
    expect(await (await call("deploy", { query: { revision: next } })).json()).toEqual({ state: "live" });
  });

  it("passes plugins' tasks on to the site's CI, with the answer still sealed", async () => {
    const { call, post, taskRuns } = setup();
    // Secrets go on the server, for plugins' server modules, or in the CI it names.
    expect(await (await call("task")).json()).toEqual({
      supported: true,
      place: {
        kind: "server",
        ci: { kind: "github", url: "https://github.com/parish/site/settings/secrets/actions/new" },
      },
    });
    const request = {
      id: newTaskRequestId(),
      plugin: "goodfellow-plugin-s3",
      task: "sign",
      input: "{}",
      key: (await taskKeys()).publicKey,
    };
    expect(await (await post("task", request)).json()).toEqual({ result: `sealed for ${request.id}` });
    expect(taskRuns).toEqual([{ request, author: "Alice Editor" }]);
    // Why it couldn't run, without the host's own words.
    const slow = await post("task", { ...request, task: "slow" });
    expect(slow.status).toBe(502);
    expect(await slow.json()).toEqual({ error: "task", problem: "timeout" });
    expect((await post("task", { ...request, key: '{"kty":"EC","crv":"P-256","d":"private"}' })).status).toBe(400);
  });

  it("keeps the repository's errors on the server", async () => {
    const errors: unknown[] = [];
    const api = appApi({
      git: {
        revision: async () => {
          throw new GitApiError(401, "GitHub answered 401: Bad credentials ghp_secret");
        },
        at: async () => {
          throw new Error("unused");
        },
      },
      authorize: () => ALICE,
      signIn: "/",
      onError: (error) => errors.push(error),
    });
    const response = await api(
      new Request("https://parish.example/api/goodfellow/revision", {
        headers: { [APP_API_HEADER]: "1", "sec-fetch-site": "same-origin" },
      }),
      "revision",
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("ghp_secret");
    expect(errors).toHaveLength(1);
  });

  it("sends AI requests on only for the services the server has keys for", async () => {
    const forwarded: string[] = [];
    const api = appApi({
      git: setup().git,
      authorize: () => ALICE,
      signIn: "/",
      ai: {
        services: ["anthropic"],
        forward: async (_request, service, path) => {
          forwarded.push(`${service} ${path}`);
          return new Response("{}");
        },
      },
    });
    const ask = (endpoint: string) =>
      api(
        new Request(`https://parish.example/api/goodfellow/${endpoint}`, {
          method: "POST",
          headers: { [APP_API_HEADER]: "1", "sec-fetch-site": "same-origin" },
        }),
        endpoint,
      );
    expect((await ask("ai/anthropic/v1/messages")).status).toBe(200);
    expect((await ask("ai/openai/chat/completions")).status).toBe(404);
    expect(forwarded).toEqual(["anthropic v1/messages"]);
  });
});

describe("isSettingsPath", () => {
  it("covers Site Settings, collections' settings and templates, and blocks' code", () => {
    for (const path of [
      "content/site.json",
      "content/redirects.json",
      "content/updates.json",
      "content/permissions.json",
      "content/styles/custom.css",
      "content/code/head.html",
      "content/collections/news/_collection.json",
      "blocks/installed/index.ts",
      "components/ui/button.tsx",
      "lib/utils.ts",
      "hooks/use-mobile.ts",
    ]) {
      expect(isSettingsPath(path), path).toBe(true);
    }
    for (const path of [
      "content/pages/index.json",
      "content/collections/news/first.json",
      "content/menus.json",
      "content/layout/header.json",
      "content/media.json",
      "public/media/logo.png",
    ]) {
      expect(isSettingsPath(path), path).toBe(false);
    }
  });
});

describe("plugins' server modules", () => {
  function pluginApi(editor: AppEditor | null) {
    const seen: { path: string; editor: string | null }[] = [];
    const api = appApi({
      git: fakeServerGit(new FakeRepo(FILES)).git,
      authorize: () => editor,
      signIn: "/sign-in",
      plugins: {
        "goodfellow-plugin-storage": (_request, context) => {
          seen.push({ path: context.path, editor: context.editor?.login ?? null });
          return new Response("signed");
        },
      },
    });
    return { api, seen };
  }

  it("answer their own addresses, told who's signed in only for the site's own pages", async () => {
    const { api, seen } = pluginApi(ALICE);
    const own = new Request("https://example.org/api/goodfellow/plugins/goodfellow-plugin-storage/sign", {
      headers: { [APP_API_HEADER]: "1", "sec-fetch-site": "same-origin" },
    });
    expect(await (await api(own, "plugins/goodfellow-plugin-storage/sign")).text()).toBe("signed");
    const webhook = new Request("https://example.org/api/goodfellow/plugins/goodfellow-plugin-storage/hook", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect((await api(webhook, "plugins/goodfellow-plugin-storage/hook")).status).toBe(200);
    expect(seen).toEqual([
      { path: "sign", editor: "alice" },
      { path: "hook", editor: null },
    ]);
    const other = new Request("https://example.org/api/goodfellow/plugins/goodfellow-plugin-other/x");
    expect((await api(other, "plugins/goodfellow-plugin-other/x")).status).toBe(404);
  });
});
