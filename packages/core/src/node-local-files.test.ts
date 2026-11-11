import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConflictError, type ContentStore } from "./index.js";
import { InvalidPathError, localFileStore } from "./node-local-files.js";

describe("localFileStore", () => {
  let root: string;
  let store: ContentStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-store-"));
    store = localFileStore(root);
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it("writes and deletes files together, and returns the new revision", async () => {
    const start = await store.revision();
    const { revision } = await store.write(
      [
        { path: "content/pages/index.json", content: "{}" },
        { path: "content/pages/news/index.json", content: "[]" },
      ],
      { message: "Add pages", expectedRevision: start },
    );
    expect(revision).not.toBe(start);
    expect(revision).toBe(await store.revision());
    expect(await store.list("content/pages")).toEqual(["content/pages/index.json", "content/pages/news/index.json"]);

    await store.write([{ path: "content/pages/index.json", delete: true }], {
      message: "Delete",
      expectedRevision: revision,
    });
    expect(await store.read("content/pages/index.json")).toBeUndefined();
  });

  it("refuses to write over changes made since the editor loaded", async () => {
    const start = await store.revision();
    await writeFile(join(root, "content-outside.txt"), "ignored: not an editable file");
    expect(await store.revision()).toBe(start);

    await store.write([{ path: "content/site.json", content: "{}" }], { message: "Mine", expectedRevision: start });
    await expect(
      store.write([{ path: "content/site.json", content: '{"stale":true}' }], {
        message: "Stale",
        expectedRevision: start,
      }),
    ).rejects.toThrow(ConflictError);
    expect(await readFile(join(root, "content/site.json"), "utf8")).toBe("{}");
  });

  it("applies saves one at a time, so two saves from the same revision can't both succeed", async () => {
    const start = await store.revision();
    const results = await Promise.allSettled([
      store.write([{ path: "content/a.json", content: "1" }], { message: "A", expectedRevision: start }),
      store.write([{ path: "content/b.json", content: "2" }], { message: "B", expectedRevision: start }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
  });

  it("writes the code of installed blocks, and counts it in the revision", async () => {
    const start = await store.revision();
    const { revision } = await store.write(
      [
        { path: "blocks/installed/shadcn-faq/block.tsx", content: "export default {};\n" },
        { path: "components/ui/accordion.tsx", content: "accordion\n" },
      ],
      { message: "Add the FAQ block", expectedRevision: start },
    );
    expect(revision).not.toBe(start);
    expect(await readFile(join(root, "components/ui/accordion.tsx"), "utf8")).toBe("accordion\n");
    await writeFile(join(root, "components/ui/accordion.tsx"), "changed\n");
    expect(await store.revision()).not.toBe(revision);
  });

  it("never follows a link inside the editable folders to anywhere outside them", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "goodfellow-elsewhere-"));
    try {
      await writeFile(join(elsewhere, "secret.txt"), "the computer's own");
      await mkdir(join(root, "content/pages"), { recursive: true });
      await symlink(elsewhere, join(root, "content/pages/linked"), "dir");
      await symlink(join(elsewhere, "secret.txt"), join(root, "content/pages/secret.json"));
      await symlink(join(elsewhere, "missing.txt"), join(root, "content/pages/missing.json"));
      await expect(store.read("content/pages/linked/secret.txt")).rejects.toBeInstanceOf(InvalidPathError);
      await expect(store.read("content/pages/secret.json")).rejects.toBeInstanceOf(InvalidPathError);
      await expect(store.readBytes("content/pages/secret.json")).rejects.toBeInstanceOf(InvalidPathError);
      const start = await store.revision();
      for (const path of ["content/pages/linked/new.json", "content/pages/secret.json", "content/pages/missing.json"]) {
        await expect(
          store.write([{ path, content: "{}" }], { message: "Out", expectedRevision: start }),
        ).rejects.toBeInstanceOf(InvalidPathError);
      }
      expect(await readFile(join(elsewhere, "secret.txt"), "utf8")).toBe("the computer's own");
      await expect(readFile(join(elsewhere, "new.json"))).rejects.toThrow();
      await expect(readFile(join(elsewhere, "missing.txt"))).rejects.toThrow();
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("reads and writes through an editable folder that is itself a link, as a content repository's is", async () => {
    const repository = await mkdtemp(join(tmpdir(), "goodfellow-content-"));
    try {
      await symlink(repository, join(root, "content"), "dir");
      const { revision } = await store.write([{ path: "content/pages/index.json", content: "{}" }], {
        message: "Add",
        expectedRevision: await store.revision(),
      });
      expect(revision).toBe(await store.revision());
      expect(await store.read("content/pages/index.json")).toBe("{}");
      expect(await readFile(join(repository, "pages/index.json"), "utf8")).toBe("{}");
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("only touches content, media, and installed blocks' code", async () => {
    const start = await store.revision();
    await expect(
      store.write([{ path: "goodfellow.config.tsx", content: "x" }], { message: "Bad", expectedRevision: start }),
    ).rejects.toThrow(InvalidPathError);
    await expect(store.read("package.json")).rejects.toThrow(InvalidPathError);
    await expect(store.list("src")).rejects.toThrow(InvalidPathError);
    await expect(store.read("content/../package.json")).rejects.toThrow(InvalidPathError);
  });
});
