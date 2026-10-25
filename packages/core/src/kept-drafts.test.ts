import { describe, expect, it } from "vitest";
import { ConflictError, type ContentStore, type FileChange } from "./content/store.js";
import { keptDrafts, memoryKeeper } from "./kept-drafts.js";

/** The live site's files, in memory, whose revision counts its saves. */
function liveSite(files: Record<string, string | Uint8Array>) {
  const current = new Map(Object.entries(files));
  let revision = 0;
  const writes: FileChange[][] = [];
  const store: ContentStore = {
    revision: async () => String(revision),
    read: async (path) => {
      const file = current.get(path);
      return typeof file === "string" ? file : undefined;
    },
    readBytes: async (path) => {
      const file = current.get(path);
      return file instanceof Uint8Array ? file : undefined;
    },
    list: async (dir) => [...current.keys()].filter((path) => path.startsWith(`${dir}/`)).sort(),
    write: async (changes, { expectedRevision }) => {
      if (expectedRevision !== String(revision)) throw new ConflictError();
      for (const change of changes) {
        if ("delete" in change) current.delete(change.path);
        else current.set(change.path, "bytes" in change ? change.bytes : change.content);
      }
      writes.push(changes);
      revision++;
      return { revision: String(revision) };
    },
  };
  /** Someone else publishing. */
  /** The live site where it can list what changed between revisions, as git hosts and full-stack sites' servers can. */
  const changed = new Map<number, string>();
  const withHistory: ContentStore = {
    ...store,
    changedPaths: async (from, to) =>
      [...changed].filter(([at]) => at > Number(from) && at <= Number(to)).map(([, path]) => path),
  };
  const publish = (path: string, content: string) => {
    current.set(path, content);
    revision++;
    changed.set(revision, path);
  };
  return { store, withHistory, current, writes, publish };
}

const photo = new Uint8Array([1, 2, 3]);

describe("drafts kept in the browser", () => {
  it("keep changes over the live site's files until they're published in one save", async () => {
    const live = liveSite({ "content/pages/index.json": "home", "content/pages/about.json": "about" });
    const drafts = keptDrafts(live.store, memoryKeeper());
    expect(await drafts.list()).toEqual([]);
    const draft = await drafts.create("20261024-abc123");
    await expect(drafts.create("20261024-def456")).rejects.toMatchObject({ problem: "exists" });

    await draft.store.write(
      [
        { path: "content/pages/about.json", content: "about, edited" },
        { path: "public/media/photo.jpg", bytes: photo },
      ],
      { message: "Edit", expectedRevision: await draft.store.revision() },
    );
    await draft.store.write([{ path: "content/pages/index.json", delete: true }], {
      message: "Delete",
      expectedRevision: await draft.store.revision(),
    });
    // A save from a tab that loaded the draft before is refused, as a publish would be.
    await expect(
      draft.store.write([{ path: "content/pages/about.json", content: "stale" }], {
        message: "Edit",
        expectedRevision: "draft:20261024-abc123:0",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(await draft.store.read("content/pages/about.json")).toBe("about, edited");
    expect(await draft.store.read("content/pages/index.json")).toBeUndefined();
    expect(await draft.store.readBytes("public/media/photo.jpg")).toEqual(photo);
    expect(await draft.store.list("content/pages")).toEqual(["content/pages/about.json"]);
    expect(await draft.paths()).toEqual([
      "content/pages/about.json",
      "public/media/photo.jpg",
      "content/pages/index.json",
    ]);
    expect(live.current.get("content/pages/about.json")).toBe("about");
    expect(await drafts.list()).toEqual(["20261024-abc123"]);

    // Someone else's publish to another file doesn't stop it.
    live.publish("content/site.json", "settings");
    await draft.publish("Publish the draft");
    expect(live.writes).toHaveLength(1);
    expect(live.current.get("content/pages/about.json")).toBe("about, edited");
    expect(live.current.has("content/pages/index.json")).toBe(false);
    expect(await drafts.list()).toEqual([]);
    await expect(drafts.open("20261024-abc123")).rejects.toMatchObject({ problem: "not-found" });
  });

  it("refuses to publish over someone else's change to one of its files, and keeps the draft", async () => {
    const live = liveSite({ "content/pages/about.json": "about" });
    const drafts = keptDrafts(live.store, memoryKeeper());
    const draft = await drafts.create("20261024-abc123");
    await draft.store.write([{ path: "content/pages/about.json", content: "mine" }], {
      message: "Edit",
      expectedRevision: await draft.store.revision(),
    });
    live.publish("content/pages/about.json", "theirs");
    await expect(draft.publish("Publish the draft")).rejects.toBeInstanceOf(ConflictError);
    expect(live.current.get("content/pages/about.json")).toBe("theirs");
    expect(await drafts.list()).toEqual(["20261024-abc123"]);

    // It can't be submitted for review, and throwing it away leaves the live site as it is.
    await expect(draft.submitForReview({ title: "Draft" })).rejects.toMatchObject({ problem: "no-reviews" });
    await draft.discard();
    expect(await drafts.list()).toEqual([]);
  });

  it("catches someone else's change made after the editor loaded the site but before the draft's first save", async () => {
    const live = liveSite({ "content/pages/about.json": "about" });
    const loaded = await live.withHistory.revision();
    live.publish("content/pages/about.json", "theirs");
    const drafts = keptDrafts(live.withHistory, memoryKeeper());
    const draft = await drafts.create("20261024-abc123", { from: loaded });
    await draft.store.write([{ path: "content/pages/about.json", content: "mine" }], {
      message: "Edit",
      expectedRevision: await draft.store.revision(),
    });
    await expect(draft.publish("Publish the draft")).rejects.toBeInstanceOf(ConflictError);
    expect(live.current.get("content/pages/about.json")).toBe("theirs");
  });
});
