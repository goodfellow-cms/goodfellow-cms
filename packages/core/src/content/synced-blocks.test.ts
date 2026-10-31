import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { blockUses } from "../registry.js";
import { deleteSyncedBlockChanges, movePageChanges, syncedBlockFileChange } from "./changes.js";
import { checkSite } from "./checks.js";
import { checkPuckData } from "./edited-data.js";
import { type ContentSource, loadSiteContent } from "./load.js";
import { outsideLimits } from "./permissions.js";
import { expandSyncedBlocks, syncedBlockProblems, syncedBlockUses } from "./synced-blocks.js";

function memorySource(files: Record<string, unknown>): ContentSource {
  const text = Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  return {
    read: async (path) => text[path],
    list: async (dir) => Object.keys(text).filter((path) => path.startsWith(`${dir}/`)),
  };
}

const blocks = {
  Button: { fields: { href: { type: "text" }, label: { type: "text" } }, render: () => null },
  Heading: { fields: { text: { type: "text" } }, render: () => null },
  Section: { fields: { content: { type: "slot" } }, render: () => null },
  SyncedBlock: { fields: { block: { type: "text" } }, render: () => null },
} as unknown as Record<string, ComponentConfig>;

const heading = (id: string, text: string) => ({ type: "Heading", props: { id, text } });
const placed = (id: string, block: string) => ({ type: "SyncedBlock", props: { id, block } });
const page = (title: string, content: unknown[]) => ({ version: 1, data: { root: { props: { title } }, content } });

const massTimes = {
  version: 1,
  title: "Mass times",
  data: {
    root: { props: {} },
    content: [
      heading("h", "Mass times"),
      {
        type: "Section",
        props: { id: "s", content: [{ type: "Button", props: { id: "b", label: "Visit", href: "/visit" } }] },
      },
    ],
  },
};

const site = (files: Record<string, unknown> = {}) =>
  loadSiteContent(
    memorySource({
      "content/site.json": {
        version: 1,
        title: "Parish",
        description: "A parish",
        url: "https://parish.example/",
        languages: [{ code: "es", name: "Español" }],
      },
      "content/pages/index.json": page("Home", [placed("p1", "mass-times"), heading("x", "Welcome")]),
      "content/pages/visit.json": page("Visit", [placed("p2", "mass-times")]),
      "content/synced-blocks/mass-times.json": massTimes,
      "content/synced-blocks/mass-times.es.json": {
        ...massTimes,
        title: "Horario de misas",
        data: { root: { props: {} }, content: [heading("h", "Horario de misas")] },
      },
      ...files,
    }),
  );

describe("synced blocks", () => {
  it("load with their own versions in other languages", async () => {
    const content = await site();
    expect(content.syncedBlocks?.map((block) => block.name)).toEqual(["mass-times"]);
    expect(content.syncedBlocks?.[0]?.languages?.es?.content.title).toBe("Horario de misas");
  });

  it("refuse files that aren't named as synced blocks, or name a language the site doesn't have", async () => {
    await expect(site({ "content/synced-blocks/Mass Times.json": massTimes })).rejects.toThrow(/synced block/);
    await expect(site({ "content/synced-blocks/mass-times.fr.json": massTimes })).rejects.toThrow();
  });

  it("are put in place of each placement, with ids of its own, in the language shown", async () => {
    const content = await site();
    const home = content.pages.find((found) => found.path === "/");
    const expanded = expandSyncedBlocks(home?.content.data, content);
    expect(expanded?.content.map((block) => [block.type, block.props.id])).toEqual([
      ["Heading", "p1-h"],
      ["Section", "p1-s"],
      ["Heading", "x"],
    ]);
    // Blocks in slots get ids of their own too.
    const inSlot = expanded?.content[1]?.props.content as { props: { id: string } }[] | undefined;
    expect(inSlot?.[0]?.props.id).toBe("p1-b");
    const spanish = expandSyncedBlocks(home?.content.data, content, "es");
    expect(spanish?.content[0]?.props.text).toBe("Horario de misas");
  });

  it("leave nothing for a synced block that isn't there, or one placed inside another", async () => {
    const content = await site({
      "content/synced-blocks/loop.json": {
        version: 1,
        title: "Loop",
        data: { root: { props: {} }, content: [placed("inner", "mass-times"), heading("l", "Loop")] },
      },
    });
    const data = { root: { props: {} }, content: [placed("a", "gone"), placed("b", "loop")] };
    expect(expandSyncedBlocks(data, content).content.map((block) => block.props.id)).toEqual(["b-l"]);
  });

  it("are checked: synced blocks that aren't there, none chosen, and synced blocks inside synced blocks", async () => {
    const content = await site({
      "content/pages/about.json": page("About", [placed("a", "gone"), placed("b", "")]),
      "content/synced-blocks/loop.json": {
        version: 1,
        title: "Loop",
        data: { root: { props: {} }, content: [placed("inner", "mass-times")] },
      },
    });
    expect(syncedBlockProblems(content)).toEqual([
      { kind: "missing-synced-block", file: "content/pages/about.json", target: "gone" },
      { kind: "missing-synced-block", file: "content/pages/about.json", target: "" },
      { kind: "nested-synced-block", file: "content/synced-blocks/loop.json", target: "mass-times" },
    ]);
    const errors = checkSite(content, { media: [] }).filter((problem) => problem.severity === "error");
    expect(errors.map((problem) => problem.kind)).toEqual(
      expect.arrayContaining(["missing-synced-block", "nested-synced-block"]),
    );
  });

  it("have their links checked, and moved with the pages they link to", async () => {
    const content = await site({
      "content/synced-blocks/broken.json": {
        version: 1,
        title: "Broken",
        data: {
          root: { props: {} },
          content: [{ type: "Button", props: { id: "b", label: "Go", href: "/nowhere" } }],
        },
      },
    });
    const missing = checkSite(content, { media: [], blocks }).filter((problem) => problem.kind === "missing-page");
    expect(missing).toEqual([
      expect.objectContaining({ file: "content/synced-blocks/broken.json", target: "/nowhere" }),
    ]);

    const visit = content.pages.find((found) => found.path === "/visit");
    if (!visit) throw new Error("no page");
    const changes = movePageChanges(content, visit, "/come-and-see", { blocks });
    const moved = changes.find((change) => change.path === "content/synced-blocks/mass-times.json");
    expect(moved && "content" in moved && moved.content).toContain('"/come-and-see"');
  });

  it("say where they're placed, and keep blocks they use from being removed", async () => {
    const content = await site();
    expect(syncedBlockUses(content, "mass-times").map((use) => use.file)).toEqual([
      "content/pages/index.json",
      "content/pages/visit.json",
    ]);
    expect(blockUses(content, "Button")).toEqual([{ kind: "synced-block", name: "mass-times", title: "Mass times" }]);
  });

  it("are written and deleted with every language's file", async () => {
    const content = await site();
    const change = syncedBlockFileChange("mass-times", " Mass times ", { root: { props: {} }, content: [] });
    expect(change.path).toBe("content/synced-blocks/mass-times.json");
    expect("content" in change && JSON.parse(change.content as string)).toEqual({
      version: 1,
      title: "Mass times",
      data: { root: { props: {} }, content: [] },
    });
    const block = content.syncedBlocks?.[0];
    if (!block) throw new Error("no synced block");
    expect(deleteSyncedBlockChanges(block).map((removed) => removed.path)).toEqual([
      "content/synced-blocks/mass-times.json",
      "content/synced-blocks/mass-times.es.json",
    ]);
  });

  it("are under the header and footer's limit", async () => {
    const content = await site();
    const change = syncedBlockFileChange("mass-times", "Mass times", { root: { props: {} }, content: [] });
    expect(outsideLimits(content, { pages: ["/"] }, [change])).toEqual([
      { path: "content/synced-blocks/mass-times.json", kind: "layout" },
    ]);
    expect(outsideLimits(content, { layout: true }, [change])).toEqual([]);
    const spanish = syncedBlockFileChange("mass-times", "Horario", { root: { props: {} }, content: [] }, "es");
    expect(outsideLimits(content, { layout: true, languages: ["en"] }, [spanish])).toHaveLength(1);
  });

  it("can't place another, as what the editor hands back", () => {
    const description = {
      blocks: { SyncedBlock: { fields: {} }, Heading: { fields: {} } },
    };
    const data = { root: { props: {} }, content: [placed("a", "mass-times")] };
    expect(checkPuckData(data, { description, kind: "page" }).ok).toBe(true);
    expect(checkPuckData(data, { description, kind: "synced" }).ok).toBe(false);
  });
});
