import { describe, expect, it } from "vitest";
import type { GitBackend, ServerGit } from "./git.js";
import { repositorySource } from "./repository-source.js";

/** A repository whose live branch is at `head`, counting what's asked of it. */
function repository(revisions: Record<string, Record<string, string>>) {
  const asked = { revisions: 0, lists: 0, reads: 0 };
  let head = Object.keys(revisions)[0] as string;
  const git: ServerGit = {
    revision: async () => {
      asked.revisions += 1;
      return head;
    },
    at: async (revision) => {
      const files = revisions[revision] ?? {};
      return {
        read: async (path: string) => files[path],
        list: async (dir: string) => {
          asked.lists += 1;
          return Object.keys(files).filter((path) => path.startsWith(`${dir}/`));
        },
        readFiles: async (paths: string[]) => {
          asked.reads += 1;
          return new Map(paths.flatMap((path) => (files[path] === undefined ? [] : [[path, files[path]] as const])));
        },
      } as unknown as GitBackend;
    },
  };
  return { git, asked, publish: (revision: string) => (head = revision) };
}

const site = (title: string) => JSON.stringify({ version: 1, title });

describe("repositorySource", () => {
  it("reads the content once per revision, and the newest after a publish", async () => {
    const repo = repository({
      a: { "content/site.json": site("Before"), "content/pages/index.json": "{}", "package.json": "{}" },
      b: { "content/site.json": site("After") },
    });
    const source = repositorySource(repo.git);
    expect(await (await source()).read("content/site.json")).toBe(site("Before"));
    expect(await (await source()).list("content/pages")).toEqual(["content/pages/index.json"]);
    // Only the content folder, read in one batch, however often pages ask.
    expect(await (await source()).read("package.json")).toBeUndefined();
    expect(repo.asked).toEqual({ revisions: 3, lists: 1, reads: 1 });
    repo.publish("b");
    expect(await (await source()).read("content/site.json")).toBe(site("After"));
    expect(repo.asked.reads).toBe(2);
  });

  it("reads Site settings as this copy of the site is built", async () => {
    const repo = repository({ a: { "content/site.json": site("Parish") } });
    const source = repositorySource(repo.git, {
      env: { GOODFELLOW_SITE_URL: "https://staging.example.org", GOODFELLOW_TRAILING_SLASH: "false" },
    });
    const files = await source();
    const settings = JSON.parse((await files.read("content/site.json")) ?? "{}");
    expect(settings).toMatchObject({ title: "Parish", url: "https://staging.example.org", trailingSlash: false });
    const batch = await files.readFiles?.(["content/site.json"]);
    expect(JSON.parse(batch?.get("content/site.json") ?? "{}")).toMatchObject({ url: "https://staging.example.org" });
  });

  it("tries a revision again where reading it failed, and keeps only the last few", async () => {
    let fail = true;
    const repo = repository({ a: { "content/site.json": site("A") } });
    const at = repo.git.at;
    repo.git.at = async (revision) => {
      if (fail) throw new Error("The host didn't answer.");
      return at(revision);
    };
    const source = repositorySource(repo.git, { keep: 1 });
    await expect(source()).rejects.toThrow("didn't answer");
    fail = false;
    expect(await (await source()).read("content/site.json")).toBe(site("A"));
  });
});
