import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContentRepositoryError, contentRepositoryProblem, useContentRepository } from "./node-content-repository.js";
import { fileSystemSource } from "./node-fs-source.js";
import { localFileStore } from "./node-local-files.js";

describe("useContentRepository", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-content-repository-"));
    await mkdir(join(root, "content-repository/content/pages"), { recursive: true });
    await mkdir(join(root, "content-repository/public/media"), { recursive: true });
    await writeFile(join(root, "content-repository/content/site.json"), '{"version":1}\n');
    await writeFile(join(root, "content-repository/content/pages/index.json"), "{}\n");
    await writeFile(join(root, "content-repository/public/media/logo.svg"), "<svg/>");
    await mkdir(join(root, "public"));
    await writeFile(join(root, "public/favicon.svg"), "<svg/>");
  });

  afterEach(() => rm(root, { recursive: true, force: true }));

  it("links content/ and public/media/ to the content repository, so saves go there", async () => {
    await useContentRepository(root);
    expect((await lstat(join(root, "content"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(root, "content"))).toMatch(/content-repository[/\\]content[/\\]?$/);
    expect(await readlink(join(root, "public/media"))).toMatch(/content-repository[/\\]public[/\\]media[/\\]?$/);

    const source = fileSystemSource(root);
    expect(await source.list("content")).toEqual(["content/pages/index.json", "content/site.json"]);
    expect(await source.list("public/media")).toEqual(["public/media/logo.svg"]);

    const store = localFileStore(root);
    await store.write([{ path: "content/pages/about.json", content: "{}\n" }], {
      message: "Add About",
      expectedRevision: await store.revision(),
    });
    expect(await readFile(join(root, "content-repository/content/pages/about.json"), "utf8")).toBe("{}\n");
    // The site's own public files stay where they are.
    expect(await readFile(join(root, "public/favicon.svg"), "utf8")).toBe("<svg/>");
  });

  it("copies them instead for builds", async () => {
    await useContentRepository(root, { copy: true });
    expect((await lstat(join(root, "content"))).isDirectory()).toBe(true);
    expect(await readFile(join(root, "content/site.json"), "utf8")).toBe('{"version":1}\n');
    expect(await readFile(join(root, "public/media/logo.svg"), "utf8")).toBe("<svg/>");
  });

  it("links again over its own links, and makes a media folder where the content repository has none", async () => {
    await useContentRepository(root);
    await rm(join(root, "content-repository/public/media"), { recursive: true });
    await useContentRepository(root);
    expect((await lstat(join(root, "content-repository/public/media"))).isDirectory()).toBe(true);
  });

  it("reads the content repository from another folder", async () => {
    const elsewhere = join(root, "elsewhere");
    await mkdir(join(elsewhere, "content"), { recursive: true });
    await writeFile(join(elsewhere, "content/site.json"), '{"version":1,"title":"Elsewhere"}\n');
    await useContentRepository(root, { from: "elsewhere", copy: true });
    expect(await readFile(join(root, "content/site.json"), "utf8")).toContain("Elsewhere");
  });

  it("never replaces content the site already has", async () => {
    await mkdir(join(root, "content"));
    await writeFile(join(root, "content/site.json"), "{}\n");
    await expect(useContentRepository(root)).rejects.toThrow(ContentRepositoryError);
    expect(await readFile(join(root, "content/site.json"), "utf8")).toBe("{}\n");
  });

  it("says when there's no content repository to use", async () => {
    await expect(useContentRepository(root, { from: "missing" })).rejects.toThrow("Clone it there first");
    await mkdir(join(root, "empty"));
    await expect(useContentRepository(root, { from: "empty" })).rejects.toThrow("has no content/site.json");
    await expect(useContentRepository(root, { from: "." })).rejects.toThrow("a folder of its own");
  });

  it("says what to run when the content repository is there but not linked yet", async () => {
    expect(contentRepositoryProblem(root)).toContain("goodfellow content link");
    await useContentRepository(root);
    expect(contentRepositoryProblem(root)).toBeUndefined();
    // Sites with their content in their own repository never hear about it.
    await rm(join(root, "content-repository"), { recursive: true });
    await rm(join(root, "content"));
    expect(contentRepositoryProblem(root)).toBeUndefined();
  });
});
