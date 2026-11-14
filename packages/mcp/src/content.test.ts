import type { ContentSource } from "@goodfellow-cms/core";
import { serializeContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { loadWholeSite, withoutSourcedItems } from "./content.js";

describe("loadWholeSite", () => {
  it("reads every content file in one batch, never one by one", async () => {
    const files = new Map([
      [
        "content/pages/index.json",
        serializeContent({ version: 1, data: { root: { props: { title: "Home" } }, content: [] } }),
      ],
      [
        "content/pages/about.json",
        serializeContent({ version: 1, data: { root: { props: { title: "About" } }, content: [] } }),
      ],
    ]);
    const batches: string[][] = [];
    const source: ContentSource = {
      read: async () => {
        throw new Error("read one by one");
      },
      list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`)),
      readFiles: async (paths) => {
        batches.push(paths);
        return new Map(paths.flatMap((path) => (files.has(path) ? [[path, files.get(path) as string] as const] : [])));
      },
    };
    const content = await loadWholeSite(source);
    expect(content.pages.map((page) => page.path).sort()).toEqual(["/", "/about"]);
    expect(batches).toHaveLength(1);
  });
});

describe("withoutSourcedItems", () => {
  it("hides a sourced collection's item files, however they're read, and keeps its settings", async () => {
    const files = new Map([
      ["content/collections/jobs/_collection.json", "settings"],
      ["content/collections/jobs/cook.json", "item"],
      ["content/collections/jobs/old/_collection.json", "deeper"],
      ["content/collections/news/welcome.json", "news"],
      ["content/pages/index.json", "page"],
    ]);
    const source: ContentSource = {
      read: async (path) => files.get(path),
      list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`)),
      readFiles: async (paths) =>
        new Map(paths.flatMap((path) => (files.has(path) ? [[path, files.get(path) ?? ""]] : []))),
      fileSizes: async () => new Map([["public/media/a.jpg", 3]]),
    };
    const shown = withoutSourcedItems(source, ["jobs"]);
    expect(await shown.list("content")).toEqual([
      "content/collections/jobs/_collection.json",
      "content/collections/news/welcome.json",
      "content/pages/index.json",
    ]);
    expect(await shown.read("content/collections/jobs/cook.json")).toBeUndefined();
    expect(await shown.read("content/collections/jobs/old/_collection.json")).toBeUndefined();
    expect(await shown.read("content/collections/jobs/_collection.json")).toBe("settings");
    expect([...((await shown.readFiles?.([...files.keys()])) ?? new Map()).keys()]).toEqual([
      "content/collections/jobs/_collection.json",
      "content/collections/news/welcome.json",
      "content/pages/index.json",
    ]);
    expect(await shown.fileSizes?.("public/media")).toEqual(new Map([["public/media/a.jpg", 3]]));
    // Nothing to hide gives the source itself.
    expect(withoutSourcedItems(source, [])).toBe(source);
  });
});
