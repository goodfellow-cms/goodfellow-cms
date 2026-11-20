import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Tests run as root in CI's container, where no folder is unreadable, so a folder that can't be read is made here.
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  const readdir = ((path: string, ...rest: unknown[]) =>
    String(path).includes("unreadable")
      ? Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }))
      : (actual.readdir as (...args: unknown[]) => unknown)(path, ...rest)) as typeof actual.readdir;
  return { ...actual, readdir };
});

const { secretsUnder } = await import("./node-plugins.js");

describe("plugins' folders", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-scan-"));
    await mkdir(join(root, "unreadable"));
    await mkdir(join(root, "content"));
    await writeFile(join(root, "content/site.json"), "{}");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("name a folder that can't be read through, since what it holds can't be checked", async () => {
    expect(await secretsUnder(root, ["unreadable/", "content/", "content/site.json", "missing/"])).toEqual([
      "unreadable",
    ]);
  });
});
