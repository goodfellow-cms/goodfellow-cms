import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { builtSiteSource } from "@goodfellow-cms/core/node";
import { describe, expect, it, vi } from "vitest";
import { dueSite } from "./due.js";

const fixture = resolve(import.meta.dirname, "../test/fixtures/site");

/** The fixture with its talks given a source, `lib/talks.ts`, whose items are `items`. */
async function sourcedSite(items: string): Promise<string> {
  const site = await mkdtemp(join(import.meta.dirname, "../test/.due-"));
  await cp(fixture, site, { recursive: true, filter: (path) => !path.includes("node_modules") });
  await mkdir(join(site, "lib"), { recursive: true });
  await writeFile(join(site, "lib/talks.ts"), `export default () => ({ items: async () => ${items} });\n`);
  const configFile = join(site, "goodfellow.config.tsx");
  const config = (await readFile(configFile, "utf8")).replace(
    '  base: "/from-config/",',
    '  base: "/from-config/",\n  collections: { talks: { source: "./lib/talks.ts" } },',
  );
  expect(config).toContain("collections:");
  await writeFile(configFile, config);
  // A file left in the folder that loading would refuse, which the source's items replace.
  await writeFile(join(site, "content/collections/talks/broken.json"), '{ "version": 1, "fields": { "title": 42 } }\n');
  return site;
}

describe("goodfellow due's site", () => {
  it("reads a collection's source, so its items' schedules come due, leaving out the files they replace", async () => {
    const site = await sourcedSite(
      '[{ slug: "later", showFrom: "2031-03-04T05:06", fields: { title: "Later", speaker: "Someone", given: "2026-11-01" } }]',
    );
    try {
      const content = await dueSite(site, builtSiteSource(site));
      const talks = content.collections.find((one) => one.id === "talks");
      expect(talks?.entries.map((entry) => [entry.slug, entry.content.showFrom])).toEqual([
        ["later", "2031-03-04T05:06"],
      ]);
    } finally {
      await rm(site, { recursive: true, force: true });
    }
  });

  it("leaves out the items of a source it can't read, saying so, rather than fail", async () => {
    const site = await sourcedSite('Promise.reject(new Error("No database here."))');
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const content = await dueSite(site, builtSiteSource(site));
      expect(content.collections.find((one) => one.id === "talks")?.entries).toEqual([]);
      expect(warn.mock.calls.some(([text]) => String(text).includes("No database here."))).toBe(true);
    } finally {
      warn.mockRestore();
      await rm(site, { recursive: true, force: true });
    }
  });
});
