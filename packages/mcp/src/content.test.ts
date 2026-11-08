import type { ContentSource } from "@goodfellow-cms/core";
import { serializeContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { loadWholeSite } from "./content.js";

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
