import type { ContentSource } from "@goodfellow-cms/core";
import { serializeContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { collectionSettingsOf, loadWholeSite, withoutSourcedItems } from "./content.js";

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

describe("collectionSettingsOf", () => {
  it("leaves out a collection the site doesn't have, and stops where its settings can't be read just now", async () => {
    const settings = {
      version: 1,
      name: "Jobs",
      entryName: "Job",
      path: "/jobs/{slug}",
      fields: [{ name: "title", label: "Title", type: "text" }],
    };
    let failing = false;
    const source: ContentSource = {
      read: async (path) => {
        if (failing) throw new Error("The host didn't answer.");
        return path === "content/collections/jobs/_collection.json" ? serializeContent(settings) : undefined;
      },
      list: async (dir) => (dir === "content/collections" ? ["content/collections/jobs/_collection.json"] : []),
    };
    expect((await collectionSettingsOf(source, ["jobs", "events"])).map((one) => one.id)).toEqual(["jobs"]);
    // A host that doesn't answer isn't a collection the site lacks: the change that needs it waits.
    failing = true;
    await expect(collectionSettingsOf(source, ["jobs"])).rejects.toThrow("didn't answer");
  });
});
