import { describe, expect, it } from "vitest";
import type { FileVersion, GitBackend, RevisionFiles } from "../git.js";
import { FakeRepo, fakeFileBytes } from "../testing.js";
import { loadSiteContent } from "./load.js";
import {
  describeSiteChanges,
  isRestoredPath,
  siteChangesSince,
  siteHistory,
  siteRestoreChanges,
} from "./site-history.js";

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const page = (title: string) => json({ version: 1, data: { root: { props: { title } }, content: [] } });
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);

function repository() {
  const repo = new FakeRepo({
    "content/site.json": json({ version: 1, title: "St. Brendan's" }),
    "content/pages/index.json": page("Welcome"),
    "content/pages/about.json": page("About us"),
    "content/updates.json": json({ version: 1, automatic: true }),
    "package.json": "{}",
  });
  repo.commit([{ path: "public/media/church.jpg", bytes: PHOTO }], "Upload church.jpg");
  const before = repo.head();
  // A bulk change that went wrong: About rewritten, a page added, the photo deleted, and the updates turned off.
  repo.commit(
    [
      { path: "content/pages/about.json", content: page("Oops") },
      { path: "content/pages/new.json", content: page("New page") },
      { path: "public/media/church.jpg", delete: true },
      { path: "content/updates.json", content: json({ version: 1, automatic: false }) },
    ],
    "Bulk change",
  );
  // Code changes aren't the site's content.
  repo.commit([{ path: "package.json", content: '{"name":"site"}' }], "Update Goodfellow");
  return { repo, before };
}

function filesAt(repo: FakeRepo, revision: string): RevisionFiles {
  const files = () => repo.files(revision);
  return {
    read: async (path) => {
      const file = files().get(path);
      return file === undefined ? undefined : new TextDecoder().decode(fakeFileBytes(file));
    },
    readBytes: async (path) => {
      const file = files().get(path);
      return file === undefined ? undefined : fakeFileBytes(file);
    },
    list: async (dir) => [...files().keys()].filter((path) => path.startsWith(`${dir}/`)).sort(),
  };
}

function versions(repo: FakeRepo): Pick<GitBackend, "history"> & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    history: async (path, { page = 1, perPage = 20 } = {}) => {
      asked.push(`${path}:${page}`);
      return repo
        .history(path)
        .slice((page - 1) * perPage, page * perPage)
        .map((commit): FileVersion => ({ revision: commit.sha, date: commit.date, message: commit.message }));
    },
  };
}

describe("the whole site's history", () => {
  it("lists the publishes that changed content or media, newest first, once each", async () => {
    const { repo } = repository();
    const history = siteHistory(versions(repo));
    const listed = await history.more();
    expect(listed.map((version) => version.message)).toEqual(["Bulk change", "Upload church.jpg", "Initial commit"]);
    expect(history.done).toBe(true);
    expect(await history.more()).toEqual([]);
  });

  it("lists them a page at a time, in order across both folders", async () => {
    const { repo } = repository();
    for (let count = 1; count <= 3; count++) repo.write("content/pages/about.json", page(`About ${count}`));
    const source = versions(repo);
    const history = siteHistory(source, 2);
    const first = await history.more();
    expect(first.map((version) => version.message)).toEqual([
      "Edit content/pages/about.json",
      "Edit content/pages/about.json",
    ]);
    expect(history.done).toBe(false);
    const rest = [...(await history.more()), ...(await history.more()), ...(await history.more())];
    expect(rest.map((version) => version.message)).toEqual([
      "Edit content/pages/about.json",
      "Bulk change",
      "Upload church.jpg",
      "Initial commit",
    ]);
    expect(history.done).toBe(true);
    expect(source.asked).toContain("public/media:1");
  });
  it("gives pages asked for together in order, and asks again for one that couldn't be read", async () => {
    const { repo } = repository();
    const source = versions(repo);
    let failing = true;
    const flaky: Pick<GitBackend, "history"> = {
      history: async (path, options) => {
        if (failing && path === "public/media") {
          failing = false;
          throw new Error("offline");
        }
        return source.history(path, options);
      },
    };
    const history = siteHistory(flaky, 1);
    await expect(history.more()).rejects.toThrow("offline");
    const [first, second, third] = await Promise.all([history.more(), history.more(), history.more()]);
    expect([first, second, third].map((page) => page.map((version) => version.message))).toEqual([
      ["Bulk change"],
      ["Upload church.jpg"],
      ["Initial commit"],
    ]);
  });
});

describe("restoring the whole site", () => {
  it("finds what has changed since, and puts it all back in one set of changes", async () => {
    const { repo, before } = repository();
    const then = filesAt(repo, before);
    const now = filesAt(repo, repo.head());
    // Hosts list at most a few hundred changed files, so content is compared by its text instead.
    const files = await siteChangesSince(then, now, []);
    expect(files).toEqual([
      { path: "content/pages/about.json", since: "changed" },
      { path: "content/pages/new.json", since: "added" },
      { path: "public/media/church.jpg", since: "removed" },
    ]);

    const changes = await siteRestoreChanges(then, files);
    expect(changes).toEqual([
      { path: "content/pages/about.json", content: page("About us") },
      { path: "content/pages/new.json", delete: true },
      { path: "public/media/church.jpg", bytes: PHOTO },
    ]);
    repo.commit(changes, "Restore");
    expect(await siteChangesSince(then, filesAt(repo, repo.head()), [])).toEqual([]);
    // The update settings and the code stay as they are.
    expect(repo.files().get("content/updates.json")).toContain('"automatic": false');
    expect(repo.files().get("package.json")).toBe('{"name":"site"}');
  });

  it("finds media replaced in place where the host says it changed", async () => {
    const { repo } = repository();
    const before = repo.head();
    repo.commit([{ path: "public/media/logo.png", bytes: new Uint8Array([1]) }], "Upload logo");
    const middle = repo.head();
    repo.commit([{ path: "public/media/logo.png", bytes: new Uint8Array([2]) }], "Replace logo");
    const then = filesAt(repo, middle);
    const now = filesAt(repo, repo.head());
    expect(await siteChangesSince(then, now, repo.changedPaths(middle, repo.head()))).toEqual([
      { path: "public/media/logo.png", since: "changed" },
    ]);
    expect(await siteChangesSince(filesAt(repo, before), now, [])).toEqual([
      { path: "public/media/logo.png", since: "added" },
    ]);
  });

  it("says what changed as pages, settings and media", async () => {
    const { repo, before } = repository();
    repo.commit(
      [
        { path: "content/site.json", content: json({ version: 1, title: "St. Brendan's Parish" }) },
        { path: "content/code/head.html", content: "<meta name=x>" },
        { path: "content/code/body.html", content: "<script></script>" },
      ],
      "Settings",
    );
    const thenFiles = filesAt(repo, before);
    const nowFiles = filesAt(repo, repo.head());
    const [then, now] = await Promise.all([loadSiteContent(thenFiles), loadSiteContent(nowFiles)]);
    const changes = describeSiteChanges(then, now, await siteChangesSince(thenFiles, nowFiles, []));
    expect(
      changes.map(({ subject, since }) => [
        subject.kind === "page" ? subject.page.path : subject.kind === "media" ? subject.url : subject.kind,
        since,
      ]),
    ).toEqual([
      ["code", "changed"],
      ["/about", "changed"],
      ["/new", "added"],
      ["settings", "changed"],
      ["/media/church.jpg", "removed"],
    ]);
  });

  it("leaves the code and the update settings alone", () => {
    expect(isRestoredPath("content/pages/index.json")).toBe(true);
    expect(isRestoredPath("public/media/church.jpg")).toBe(true);
    expect(isRestoredPath("content/updates.json")).toBe(false);
    expect(isRestoredPath("blocks/installed/installed.json")).toBe(false);
    expect(isRestoredPath("package.json")).toBe(false);
  });
});
