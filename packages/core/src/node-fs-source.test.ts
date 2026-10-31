import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtSiteSource, fileSystemSource } from "./node-fs-source.js";
import { withConfiguredTrailingSlash } from "./site-copy.js";

describe("fileSystemSource", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-source-"));
    await mkdir(join(root, "content/pages/news"), { recursive: true });
    await mkdir(join(root, "public/media"), { recursive: true });
    for (const file of ["content/pages/index.json", "content/pages/news/index.json", "content/pages/404.json"]) {
      await writeFile(join(root, file), "{}");
    }
    await writeFile(join(root, "public/media/note.txt"), "hello\n");
    await writeFile(join(root, "content/site.json"), '{\n  "version": 1,\n  "url": "https://example.org"\n}\n');
  });

  afterAll(() => rm(root, { recursive: true, force: true }));

  it("lists files recursively as sorted repo-relative paths", async () => {
    expect(await fileSystemSource(root).list("content/pages")).toEqual([
      "content/pages/404.json",
      "content/pages/index.json",
      "content/pages/news/index.json",
    ]);
  });

  it("returns nothing for missing files and folders", async () => {
    const source = fileSystemSource(root);
    expect(await source.read("content/menus.json")).toBeUndefined();
    expect(await source.list("content/missing")).toEqual([]);
  });

  it("reads files as text", async () => {
    expect(await fileSystemSource(root).read("public/media/note.txt")).toBe("hello\n");
  });

  it("reads how pages' addresses end where the build says, from its environment or else the config", async () => {
    const read = async (env: Record<string, string | undefined>) =>
      JSON.parse((await builtSiteSource(root, env).read("content/site.json")) ?? "").trailingSlash;
    expect(await read({ GOODFELLOW_TRAILING_SLASH: "false" })).toBe(false);
    expect(await read({})).toBeUndefined();
    expect(await read(withConfiguredTrailingSlash({}, false))).toBe(false);
    // The environment wins over the config.
    expect(await read(withConfiguredTrailingSlash({ GOODFELLOW_TRAILING_SLASH: "true" }, false))).toBe(true);
    expect(() => builtSiteSource(root, { GOODFELLOW_TRAILING_SLASH: "sometimes" })).toThrow(/true or false/);
  });

  it("reads a copy's address and search engine setting only where asked, for builds", async () => {
    const env = { GOODFELLOW_SITE_URL: "https://staging.example.org/", GOODFELLOW_NO_INDEX: "true" };
    const built = JSON.parse((await builtSiteSource(root, env).read("content/site.json")) ?? "");
    expect(built).toEqual({ version: 1, url: "https://staging.example.org", noIndex: true });
    // What the admin panel's local store writes through keeps the file's own.
    expect(JSON.parse((await fileSystemSource(root).read("content/site.json")) ?? "").url).toBe("https://example.org");
    expect(await builtSiteSource(root, {}).read("content/site.json")).toBe(
      '{\n  "version": 1,\n  "url": "https://example.org"\n}\n',
    );
  });
});
