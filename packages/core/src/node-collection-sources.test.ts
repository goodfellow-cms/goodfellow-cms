import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defineCollectionSource } from "./content/collection-sources.js";
import { loadSourceModules, siteModulePath } from "./node-collection-sources.js";

describe("loadSourceModules", () => {
  it("loads each source's module from the site's root or a package, once for the same modules", async () => {
    const root = join("/sites", "company");
    // The same module each time, as Vite and Node give an imported module.
    const imported = { default: defineCollectionSource(() => ({ items: async () => [] })) };
    const asked: string[] = [];
    const load = async (path: string) => {
      asked.push(path);
      return imported;
    };
    const collections = {
      jobs: { source: "./lib/jobs.ts" },
      news: { source: "../shared/news.ts" },
      events: { source: "goodfellow-plugin-events/source" },
    };
    const first = await loadSourceModules(root, collections, load);
    expect(asked).toEqual([
      join(root, "lib/jobs.ts"),
      join("/sites", "shared/news.ts"),
      "goodfellow-plugin-events/source",
    ]);
    expect(Object.keys(first)).toEqual(["jobs", "news", "events"]);
    // The development servers load them again on every request, which makes no new source.
    const again = await loadSourceModules(root, collections, load);
    expect(again.jobs).toBe(first.jobs);
  });

  it("leaves a name that isn't a path from the site's root as it is", () => {
    expect(siteModulePath("/site", "./a.ts")).toBe(join("/site", "a.ts"));
    expect(siteModulePath("/site", ".hidden/a.ts")).toBe(".hidden/a.ts");
    expect(siteModulePath("/site", "@scope/pkg")).toBe("@scope/pkg");
  });
});
