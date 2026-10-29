import { describe, expect, it } from "vitest";
import type { SiteContent } from "./content/load.js";
import type { FileChange } from "./content/store.js";
import {
  availableBlocks,
  blockUses,
  EMPTY_RECORD,
  type FetchJson,
  hashText,
  type InstalledRecord,
  installedIndex,
  itemUrl,
  parseInstalledRecord,
  planBlockChanges,
  planInstall,
  planRemove,
  planUpdate,
  RegistryError,
  type RegistryProblem,
  SHADCN_NAMESPACE,
  SHADCN_REGISTRY,
} from "./registry.js";

const REGISTRY = "https://registry.example/r/{name}.json";
const registries = { "@goodfellow": REGISTRY };

const items: Record<string, unknown> = {
  "https://registry.example/r/registry.json": {
    name: "goodfellow",
    items: [
      {
        name: "shadcn-faq",
        type: "registry:block",
        title: "FAQ",
        meta: { goodfellow: { category: "Sections", recommended: true, image: "images/faq.png" } },
      },
      { name: "accordion", type: "registry:ui" },
    ],
  },
  "https://registry.example/r/shadcn-faq.json": {
    name: "shadcn-faq",
    type: "registry:block",
    title: "FAQ",
    dependencies: ["radix-ui@^1.4.0", "@goodfellow-cms/react", "@puckeditor/core"],
    registryDependencies: ["@goodfellow/accordion", "@goodfellow/utils"],
    files: [
      { path: "blocks/shadcn-faq/block.tsx", type: "registry:block", content: "export default {};\n" },
      { path: "blocks/shadcn-faq/faq-list.tsx", type: "registry:component", content: '"use client";\n' },
    ],
    meta: { goodfellow: { category: "Sections", version: "1.0.0" } },
  },
  "https://registry.example/r/shadcn-tabs.json": {
    name: "shadcn-tabs",
    type: "registry:block",
    title: "Tabs",
    registryDependencies: ["@goodfellow/utils"],
    files: [{ path: "blocks/shadcn-tabs/block.tsx", type: "registry:block", content: "export default {};\n" }],
    meta: { goodfellow: { category: "Sections" } },
  },
  "https://registry.example/r/accordion.json": {
    name: "accordion",
    type: "registry:ui",
    registryDependencies: ["@goodfellow/utils"],
    files: [{ path: "ui/accordion.tsx", type: "registry:ui", content: "accordion\n" }],
  },
  "https://registry.example/r/utils.json": {
    name: "utils",
    type: "registry:lib",
    dependencies: ["clsx", "tailwind-merge"],
    files: [{ path: "lib/utils.ts", type: "registry:lib", content: "utils\n" }],
  },
  "https://registry.example/r/chart.json": {
    name: "chart",
    type: "registry:block",
    dependencies: ["recharts"],
    files: [{ path: "blocks/chart/block.tsx", type: "registry:block", content: "" }],
    meta: { goodfellow: { category: "Data" } },
  },
  "https://registry.example/r/page.json": {
    name: "page",
    type: "registry:block",
    registryDependencies: ["@goodfellow/landing"],
    files: [{ path: "block.tsx", type: "registry:block", content: "" }],
    meta: { goodfellow: { category: "Pages" } },
  },
  "https://registry.example/r/landing.json": {
    name: "landing",
    type: "registry:page",
    files: [{ path: "app/page.tsx", type: "registry:page", content: "" }],
  },
  "https://registry.example/r/sneaky.json": {
    name: "sneaky",
    type: "registry:block",
    files: [
      { path: "block.tsx", type: "registry:block", content: "" },
      { path: "x.ts", type: "registry:lib", target: "~/../outside.ts", content: "" },
    ],
    meta: { goodfellow: { category: "Pages" } },
  },
  "https://registry.example/r/button.json": { name: "button", type: "registry:ui", files: [] },
};

const fetchJson: FetchJson = async (url) => {
  if (!(url in items)) throw new Error(`404 ${url}`);
  return JSON.parse(JSON.stringify(items[url]));
};

/** A site's files, which installing reads and the plan's changes are applied to. */
function siteFiles(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (path: string) => files.get(path),
    apply(changes: FileChange[]) {
      for (const change of changes) {
        if ("delete" in change) files.delete(change.path);
        else if ("content" in change) files.set(change.path, change.content);
      }
    },
  };
}

async function problem(promise: Promise<unknown>): Promise<RegistryProblem> {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(error instanceof RegistryError)) throw new Error(`Expected a RegistryError, got ${String(error)}`);
  return error.problem;
}

function content(pages: Array<{ path: string; blocks: unknown[] }> = []): SiteContent {
  const empty = { version: 1 as const, data: { root: {}, content: [] } };
  return {
    settings: {} as SiteContent["settings"],
    menus: {},
    header: empty,
    footer: { version: 1 as const, data: { root: {}, content: [{ type: "shadcn-tabs", props: { id: "t" } }] } },
    pages: pages.map(({ path, blocks }) => ({
      path,
      file: `content/pages${path}.json`,
      content: { version: 1, data: { root: { props: { title: "Help" } }, content: blocks } },
    })) as SiteContent["pages"],
    collections: [],
    customCss: "",
  };
}

const install = (site: ReturnType<typeof siteFiles>, ref: string, record: InstalledRecord = EMPTY_RECORD) =>
  planInstall({ ref, registries, fetchJson, readFile: site.readFile, record, blocks: ["Heading"] });

describe("itemUrl", () => {
  it("finds items in the registries it's given, shadcn's only where it's listed, and nowhere else", () => {
    expect(itemUrl("@goodfellow/shadcn-faq", registries)).toBe("https://registry.example/r/shadcn-faq.json");
    expect(itemUrl("https://registry.example/r/x.json", registries)).toBe("https://registry.example/r/x.json");
    for (const ref of [
      "@other/x",
      "https://evil.example/r/x.json",
      "https://registry.example/r/../../other/x.json",
      "https://registry.example/r/%2e%2e/other/x.json",
      "../x",
      "button",
    ]) {
      expect(() => itemUrl(ref, registries), ref).toThrow(RegistryError);
    }
    const withShadcn = { ...registries, [SHADCN_NAMESPACE]: SHADCN_REGISTRY };
    expect(itemUrl("button", withShadcn)).toBe(SHADCN_REGISTRY.replace("{name}", "button"));
    expect(itemUrl(SHADCN_REGISTRY.replace("{name}", "card"), withShadcn)).toBe(
      SHADCN_REGISTRY.replace("{name}", "card"),
    );
  });
});

describe("availableBlocks", () => {
  it("lists the blocks each registry offers, leaving out its other items", async () => {
    expect(await availableBlocks(registries, fetchJson)).toEqual([
      {
        ref: "@goodfellow/shadcn-faq",
        name: "shadcn-faq",
        title: "FAQ",
        category: "Sections",
        recommended: true,
        image: "https://registry.example/r/images/faq.png",
      },
    ]);
  });

  it("says which registry couldn't be reached", async () => {
    expect(await problem(availableBlocks({ "@x": "https://down.example/{name}.json" }, fetchJson))).toEqual({
      code: "unreachable",
      url: "https://down.example/registry.json",
    });
  });
});

describe("planInstall", () => {
  it("writes the block and everything it needs, with a record and the index the config imports", async () => {
    const site = siteFiles();
    const plan = await install(site, "@goodfellow/shadcn-faq");
    expect(plan.changes.map((change) => change.path)).toEqual([
      "blocks/installed/shadcn-faq/block.tsx",
      "blocks/installed/shadcn-faq/faq-list.tsx",
      "components/ui/accordion.tsx",
      "lib/utils.ts",
      "blocks/installed/installed.json",
      "blocks/installed/index.ts",
    ]);
    expect(plan.record.blocks["shadcn-faq"]).toEqual({
      source: "@goodfellow/shadcn-faq",
      title: "FAQ",
      category: "Sections",
      version: "1.0.0",
      entry: "blocks/installed/shadcn-faq/block.tsx",
      files: {
        "blocks/installed/shadcn-faq/block.tsx": await hashText("export default {};\n"),
        "blocks/installed/shadcn-faq/faq-list.tsx": await hashText('"use client";\n'),
        "components/ui/accordion.tsx": await hashText("accordion\n"),
        "lib/utils.ts": await hashText("utils\n"),
      },
    });
    site.apply(plan.changes);
    expect(parseInstalledRecord(site.files.get("blocks/installed/installed.json"))).toEqual(plan.record);
    expect(site.files.get("blocks/installed/index.ts")).toContain('import block0 from "./shadcn-faq/block";');
  });

  it("keeps shared code the site already has, but never replaces another file with a block's", async () => {
    const site = siteFiles({ "lib/utils.ts": "the developer's own\n" });
    const plan = await install(site, "@goodfellow/shadcn-faq");
    expect(plan.changes.map((change) => change.path)).not.toContain("lib/utils.ts");
    // Not installed by this block, so removing it won't delete it.
    expect(plan.record.blocks["shadcn-faq"]?.files).not.toHaveProperty("lib/utils.ts");

    const taken = siteFiles({ "blocks/installed/shadcn-faq/block.tsx": "something else\n" });
    expect(await problem(install(taken, "@goodfellow/shadcn-faq"))).toEqual({
      code: "file-exists",
      path: "blocks/installed/shadcn-faq/block.tsx",
    });
  });

  it("refuses what it can't or shouldn't install", async () => {
    const site = siteFiles();
    expect(await problem(install(site, "@goodfellow/accordion"))).toMatchObject({ code: "not-a-block" });
    expect(await problem(install(site, "@goodfellow/chart"))).toEqual({ code: "packages", packages: ["recharts"] });
    expect(await problem(install(site, "@goodfellow/page"))).toEqual({
      code: "unsupported-file",
      path: "app/page.tsx",
    });
    expect(await problem(install(site, "@goodfellow/sneaky"))).toMatchObject({ code: "unsupported-file" });
    expect(await problem(install(site, "@elsewhere/shadcn-faq"))).toMatchObject({ code: "untrusted" });
    expect(await problem(install(site, "@goodfellow/missing"))).toMatchObject({ code: "unreachable" });

    const installed = await install(site, "@goodfellow/shadcn-faq");
    expect(await problem(install(site, "@goodfellow/shadcn-faq", installed.record))).toEqual({
      code: "already-installed",
      name: "shadcn-faq",
    });
    expect(
      await problem(
        planInstall({
          ref: "@goodfellow/shadcn-faq",
          registries,
          fetchJson,
          readFile: site.readFile,
          record: EMPTY_RECORD,
          blocks: ["shadcn-faq"],
        }),
      ),
    ).toEqual({ code: "name-taken", name: "shadcn-faq" });
  });
});

describe("planRemove", () => {
  it("deletes the block's files unless another block needs them or someone changed them", async () => {
    const site = siteFiles();
    const faq = await install(site, "@goodfellow/shadcn-faq");
    site.apply(faq.changes);
    const tabs = await install(site, "@goodfellow/shadcn-tabs", faq.record);
    site.apply(tabs.changes);
    site.files.set("components/ui/accordion.tsx", "changed by a developer\n");

    const plan = await planRemove({
      name: "shadcn-faq",
      record: tabs.record,
      readFile: site.readFile,
      content: content([{ path: "/about", blocks: [] }]),
    });
    expect(plan.changes.filter((change) => "delete" in change).map((change) => change.path)).toEqual([
      "blocks/installed/shadcn-faq/block.tsx",
      "blocks/installed/shadcn-faq/faq-list.tsx",
    ]);
    expect(Object.keys(plan.record.blocks)).toEqual(["shadcn-tabs"]);
    site.apply(plan.changes);
    expect(site.files.get("lib/utils.ts")).toBe("utils\n");
    expect(site.files.get("blocks/installed/index.ts")).not.toContain("shadcn-faq");
  });

  it("is refused while content uses the block", async () => {
    const site = siteFiles();
    const faq = await install(site, "@goodfellow/shadcn-faq");
    const used = content([
      {
        path: "/help",
        blocks: [{ type: "Section", props: { id: "s", content: [{ type: "shadcn-faq", props: {} }] } }],
      },
    ]);
    expect(
      await problem(planRemove({ name: "shadcn-faq", record: faq.record, readFile: site.readFile, content: used })),
    ).toEqual({ code: "in-use", places: [{ kind: "page", path: "/help", title: "Help" }] });
    expect(blockUses(used, "shadcn-tabs")).toEqual([{ kind: "footer" }]);
    expect(
      await problem(planRemove({ name: "nothing", record: faq.record, readFile: site.readFile, content: used })),
    ).toEqual({ code: "not-installed", name: "nothing" });
  });
});

describe("planUpdate", () => {
  /** The registry with a new version of the FAQ block: its block changed, its list went and a new file came. */
  const updated: FetchJson = async (url) => {
    if (url !== "https://registry.example/r/shadcn-faq.json") return fetchJson(url);
    return {
      ...(items[url] as object),
      files: [
        { path: "blocks/shadcn-faq/block.tsx", type: "registry:block", content: "export default { v: 2 };\n" },
        { path: "blocks/shadcn-faq/questions.tsx", type: "registry:component", content: "questions\n" },
      ],
      meta: { goodfellow: { category: "Sections", version: "1.1.0" } },
    };
  };

  async function installed(changes: Record<string, string> = {}) {
    const site = siteFiles();
    const faq = await install(site, "@goodfellow/shadcn-faq");
    site.apply(faq.changes);
    for (const [path, text] of Object.entries(changes)) site.files.set(path, text);
    return { site, record: faq.record };
  }

  it("replaces, adds and removes the block's files to match the new version", async () => {
    const { site, record } = await installed();
    const plan = await planUpdate({
      name: "shadcn-faq",
      registries,
      fetchJson: updated,
      readFile: site.readFile,
      record,
    });
    expect(plan).toMatchObject({ kept: [], from: "1.0.0", to: "1.1.0" });
    site.apply(plan.changes);
    expect(site.files.get("blocks/installed/shadcn-faq/block.tsx")).toBe("export default { v: 2 };\n");
    expect(site.files.get("blocks/installed/shadcn-faq/questions.tsx")).toBe("questions\n");
    expect(site.files.has("blocks/installed/shadcn-faq/faq-list.tsx")).toBe(false);
    expect(plan.record.blocks["shadcn-faq"]?.version).toBe("1.1.0");
    expect(Object.keys(plan.record.blocks["shadcn-faq"]?.files ?? {})).toContain(
      "blocks/installed/shadcn-faq/questions.tsx",
    );
  });

  it("keeps files someone changed, and still knows they were changed", async () => {
    const changed = "export default { mine: true };\n";
    const { site, record } = await installed({
      "blocks/installed/shadcn-faq/block.tsx": changed,
      "blocks/installed/shadcn-faq/faq-list.tsx": "my list\n",
    });
    const plan = await planUpdate({
      name: "shadcn-faq",
      registries,
      fetchJson: updated,
      readFile: site.readFile,
      record,
    });
    expect(plan.kept).toEqual(["blocks/installed/shadcn-faq/block.tsx", "blocks/installed/shadcn-faq/faq-list.tsx"]);
    site.apply(plan.changes);
    expect(site.files.get("blocks/installed/shadcn-faq/block.tsx")).toBe(changed);
    expect(site.files.get("blocks/installed/shadcn-faq/faq-list.tsx")).toBe("my list\n");
    // Updating again later still sees the change, so it's never overwritten.
    const again = await planUpdate({
      name: "shadcn-faq",
      registries,
      fetchJson: updated,
      readFile: site.readFile,
      record: plan.record,
    });
    expect(again.kept).toContain("blocks/installed/shadcn-faq/block.tsx");
  });

  it("changes nothing for a block that's already up to date", async () => {
    const { site, record } = await installed();
    const plan = await planUpdate({ name: "shadcn-faq", registries, fetchJson, readFile: site.readFile, record });
    const changed = plan.changes.filter(
      (change) => "content" in change && site.files.get(change.path) !== change.content,
    );
    expect(changed).toEqual([]);
    expect(
      await problem(planUpdate({ name: "nothing", registries, fetchJson, readFile: site.readFile, record })),
    ).toEqual({ code: "not-installed", name: "nothing" });
  });
});

describe("planBlockChanges", () => {
  const plan = (
    site: ReturnType<typeof siteFiles>,
    changes: Parameters<typeof planBlockChanges>[0]["changes"],
    record = EMPTY_RECORD,
  ) =>
    planBlockChanges({
      changes,
      registries,
      fetchJson,
      readFile: site.readFile,
      record,
      blocks: ["Heading"],
      // Without the footer's Tabs, so they can be removed.
      content: { ...content(), footer: { version: 1, data: { root: {}, content: [] } } },
    });

  it("adds several blocks in one set of changes, as if each had been published in turn", async () => {
    const together = siteFiles();
    const combined = await plan(together, [{ add: "@goodfellow/shadcn-faq" }, { add: "@goodfellow/shadcn-tabs" }]);

    const oneByOne = siteFiles();
    const faq = await install(oneByOne, "@goodfellow/shadcn-faq");
    oneByOne.apply(faq.changes);
    const tabs = await install(oneByOne, "@goodfellow/shadcn-tabs", faq.record);
    oneByOne.apply(tabs.changes);

    together.apply(combined.changes);
    expect(Object.fromEntries(together.files)).toEqual(Object.fromEntries(oneByOne.files));
    expect(combined.record).toEqual(tabs.record);
    // Each file is written once.
    const paths = combined.changes.map((change) => change.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("adds and removes blocks together, leaving out files added and removed again", async () => {
    const site = siteFiles();
    const faq = await install(site, "@goodfellow/shadcn-faq");
    site.apply(faq.changes);

    const swapped = await plan(site, [{ remove: "shadcn-faq" }, { add: "@goodfellow/shadcn-tabs" }], faq.record);
    site.apply(swapped.changes);
    expect(Object.keys(swapped.record.blocks)).toEqual(["shadcn-tabs"]);
    expect(site.files.has("blocks/installed/shadcn-faq/block.tsx")).toBe(false);
    expect(site.files.has("blocks/installed/shadcn-tabs/block.tsx")).toBe(true);
    expect(site.files.get("lib/utils.ts")).toBe("utils\n");

    const fresh = siteFiles();
    const nothing = await plan(fresh, [{ add: "@goodfellow/shadcn-tabs" }, { remove: "shadcn-tabs" }]);
    expect(nothing.changes.filter((change) => "delete" in change)).toEqual([]);
    expect(nothing.record.blocks).toEqual({});
  });
});

describe("installedIndex", () => {
  it("lists nothing for a site with no installed blocks", () => {
    const index = installedIndex(EMPTY_RECORD);
    expect(index).toContain("export const installedBlocks: Record<string, ComponentConfig<any>> = {};");
    expect(index).toContain('export const installedCategories: NonNullable<Config["categories"]> = {};');
  });

  it("groups blocks by category, in name order", () => {
    const block = (category: string, entry: string) => ({ source: "", title: "", category, entry, files: {} });
    const index = installedIndex({
      version: 1,
      blocks: {
        tabs: block("Sections", "blocks/installed/tabs/block.tsx"),
        alert: block("Notices & alerts", "blocks/installed/alert/block.tsx"),
        faq: block("Sections", "blocks/installed/faq/block.tsx"),
      },
    });
    expect(index).toContain('import block0 from "./alert/block";');
    expect(index).toContain('  "faq": block1,');
    expect(index).toContain('  "installed-sections": { title: "Sections", components: ["faq","tabs"] },');
    expect(index).toContain('"installed-notices-alerts": { title: "Notices & alerts"');
  });
});
