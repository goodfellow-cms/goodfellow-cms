import { describe, expect, it } from "vitest";
import { ConflictError, type ContentStore, type FileChange, isEditablePath, writeChanges } from "./store.js";

describe("isEditablePath", () => {
  it.each(["content/site.json", "content/pages/about/team.json", "content/styles/custom.css", "public/media/logo.png"])(
    "allows %s",
    (path) => {
      expect(isEditablePath(path)).toBe(true);
    },
  );

  it.each([
    "goodfellow.config.tsx",
    "package.json",
    "content",
    "public/index.html",
    "/content/site.json",
    "content/../package.json",
    "content/./site.json",
    "content//site.json",
    "content\\site.json",
    "contents/site.json",
  ])("refuses %s", (path) => {
    expect(isEditablePath(path)).toBe(false);
  });
});

/** A store with history: each write makes a new revision; writes must name the current one. */
function historyStore(initial: Record<string, string>) {
  const revisions: Array<Record<string, string>> = [initial];
  const head = () => String(revisions.length - 1);
  const store: Required<Omit<ContentStore, "readFiles">> = {
    read: async (path) => revisions.at(-1)?.[path],
    list: async (dir) => Object.keys(revisions.at(-1) ?? {}).filter((path) => path.startsWith(`${dir}/`)),
    revision: async () => head(),
    readBytes: async () => undefined,
    write: async (changes, { expectedRevision }) => {
      if (expectedRevision !== head()) throw new ConflictError();
      const next = { ...revisions.at(-1) };
      for (const change of changes) {
        if ("delete" in change) delete next[change.path];
        else if ("content" in change) next[change.path] = change.content;
      }
      revisions.push(next);
      return { revision: head() };
    },
    changedPaths: async (from, to) => {
      const a = revisions[Number(from)] ?? {};
      const b = revisions[Number(to)] ?? {};
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => a[path] !== b[path]);
    },
  };
  return { store, revisions, head };
}

const save = (path: string, content: string): FileChange[] => [{ path, content }];

describe("writeChanges", () => {
  it("saves normally when nothing changed meanwhile", async () => {
    const { store } = historyStore({ "content/a.json": "1" });
    expect(await writeChanges(store, save("content/a.json", "2"), { message: "m", expectedRevision: "0" })).toEqual({
      revision: "1",
    });
  });

  it("saves on top of other people's changes to other files", async () => {
    const { store, revisions } = historyStore({ "content/a.json": "1", "content/b.json": "1" });
    await store.write(save("content/b.json", "theirs"), { message: "theirs", expectedRevision: "0" });

    await writeChanges(store, save("content/a.json", "mine"), { message: "mine", expectedRevision: "0" });
    expect(revisions.at(-1)).toEqual({ "content/a.json": "mine", "content/b.json": "theirs" });
  });

  it("refuses to save over other people's changes to the same file", async () => {
    const { store, revisions } = historyStore({ "content/a.json": "1" });
    await store.write(save("content/a.json", "theirs"), { message: "theirs", expectedRevision: "0" });

    await expect(
      writeChanges(store, save("content/a.json", "mine"), { message: "mine", expectedRevision: "0" }),
    ).rejects.toThrow(ConflictError);
    expect(revisions.at(-1)).toEqual({ "content/a.json": "theirs" });
  });

  it("treats a deleted or newly created file as a change to it", async () => {
    const { store } = historyStore({ "content/a.json": "1" });
    await store.write(save("content/new.json", "theirs"), { message: "theirs", expectedRevision: "0" });
    await expect(
      writeChanges(store, save("content/new.json", "mine"), { message: "mine", expectedRevision: "0" }),
    ).rejects.toThrow(ConflictError);
  });

  it("doesn't retry stores without history", async () => {
    const { store } = historyStore({});
    const { changedPaths: _none, ...withoutHistory } = store;
    await store.write(save("content/b.json", "theirs"), { message: "theirs", expectedRevision: "0" });
    await expect(
      writeChanges(withoutHistory, save("content/a.json", "mine"), { message: "mine", expectedRevision: "0" }),
    ).rejects.toThrow(ConflictError);
  });
});
