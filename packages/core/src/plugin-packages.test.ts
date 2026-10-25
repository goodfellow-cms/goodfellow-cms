import { describe, expect, it } from "vitest";
import { chooseRelease, type PackageRelease } from "./npm-packages.js";
import { reviewPluginPackages } from "./package-review.js";
import {
  configUsesInstalledPlugins,
  fetchPluginPackage,
  installedPlugin,
  installedPluginsIndex,
  PluginInstallError,
  parseInstalledPlugins,
  permissionChanges,
  planPluginInstall,
  planPluginRemove,
  pluginManifest,
  pluginReleases,
  pluginsOutOfRange,
  searchPlugins,
  withInstalledPluginsConfig,
  writesLockfile,
} from "./plugin-packages.js";
import { definePlugin, PluginError } from "./plugins.js";
import { fakePlugins, samplePluginFiles } from "./themes-testing.js";

const NOW = new Date("2026-10-25T12:00:00Z");

const STARTER_CONFIG = `import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { installedBlocks, installedCategories } from "./blocks/installed";

export default defineConfig({
  blocks: { ...blocks, ...installedBlocks },
  categories: { ...categories, ...installedCategories },
});
`;

const PACKAGE_JSON = `${JSON.stringify({ name: "site", dependencies: { react: "19.3.0", "@goodfellow-cms/core": "0.40.0" } }, null, 2)}\n`;

const fake = fakePlugins({
  now: NOW,
  plugins: [
    {
      name: "goodfellow-plugin-guestbook",
      description: "A guestbook.",
      releases: [
        {
          version: "1.0.0",
          age: 30,
          provenance: true,
          files: samplePluginFiles(),
          dependencies: { "tiny-store": "^2.0.0" },
        },
        {
          version: "1.1.0",
          age: 1,
          files: samplePluginFiles({ connect: ["https://guestbook.example.com", "https://tracker.example"] }),
        },
      ],
    },
    { name: "guestbook-plugin", releases: [{ version: "1.0.0", files: samplePluginFiles() }] },
    { name: "goodfellow-plugin-empty", releases: [{ version: "1.0.0", files: { "index.js": "" } }] },
  ],
  packages: [
    {
      name: "tiny-store",
      releases: [
        {
          version: "2.0.0",
          age: 40,
          files: { "index.js": "const run = require('child_process');\nmodule.exports = (x) => eval(x);\n" },
          dependencies: { "tiny-net": "~1.0.0" },
        },
        { version: "2.1.0", age: 2, files: { "index.js": "" } },
      ],
    },
    {
      name: "tiny-net",
      releases: [
        {
          version: "1.0.3",
          age: 10,
          scripts: { postinstall: "node setup.js" },
          files: { "index.js": "import https from 'node:https';\n", "addon.node": "x" },
        },
      ],
    },
  ],
});

describe("plugins on npm", () => {
  it("lists only packages named as plugins with the plugin keyword", async () => {
    const found = await searchPlugins("", { fetch: fake.fetch });
    expect(found.map((plugin) => plugin.name)).toEqual(["goodfellow-plugin-guestbook", "goodfellow-plugin-empty"]);
  });

  it("offers a release once it's a few days old, with what it says it does", async () => {
    const releases = await pluginReleases("goodfellow-plugin-guestbook", { fetch: fake.fetch });
    const choice = chooseRelease(releases, "0.40.0", NOW);
    expect(choice.release?.version).toBe("1.0.0");
    expect(choice.waiting?.version).toBe("1.1.0");
    const plugin = await fetchPluginPackage("goodfellow-plugin-guestbook", choice.release as PackageRelease, {
      fetch: fake.fetch,
    });
    expect(plugin.manifest.permissions.connect).toEqual(["https://guestbook.example.com"]);
    expect(plugin.manifest.screens).toEqual([{ id: "entries", title: "Guestbook" }]);
    await expect(pluginReleases("guestbook-plugin", { fetch: fake.fetch })).rejects.toMatchObject({
      code: "not-a-plugin",
    });
    const [empty] = await pluginReleases("goodfellow-plugin-empty", { fetch: fake.fetch });
    await expect(
      fetchPluginPackage("goodfellow-plugin-empty", empty as PackageRelease, { fetch: fake.fetch }),
    ).rejects.toMatchObject({
      code: "not-a-plugin",
    });
  });

  it("refuses a manifest asking for what no plugin may have", async () => {
    const bad = fakePlugins({
      now: NOW,
      plugins: [
        {
          name: "goodfellow-plugin-greedy",
          releases: [
            {
              version: "1.0.0",
              files: samplePluginFiles({ manifest: { permissions: { secrets: ["GITHUB_TOKEN"] } } }),
            },
          ],
        },
      ],
    });
    const [release] = await pluginReleases("goodfellow-plugin-greedy", { fetch: bad.fetch });
    await expect(
      fetchPluginPackage("goodfellow-plugin-greedy", release as PackageRelease, { fetch: bad.fetch }),
    ).rejects.toMatchObject({
      code: "bad-file",
    });
  });
});

describe("reviewing a plugin's packages", () => {
  it("reads the plugin and the packages it needs at the releases the lockfile would get, noting what they could do", async () => {
    const [release] = await pluginReleases("goodfellow-plugin-guestbook", { fetch: fake.fetch });
    const reviews = await reviewPluginPackages("goodfellow-plugin-guestbook", release as PackageRelease, {
      fetch: fake.fetch,
      now: NOW,
      known: ["react"],
    });
    expect(reviews.map((review) => `${review.name}@${review.version}`)).toEqual([
      "goodfellow-plugin-guestbook@1.0.0",
      "tiny-store@2.0.0",
      "tiny-net@1.0.3",
    ]);
    const [plugin, store, net] = reviews;
    expect(plugin?.counts).toEqual({ network: 1 });
    expect(plugin?.notes[0]).toMatchObject({ file: "admin.js", line: 1 });
    expect(plugin?.read).toBe(2);
    expect(store?.counts).toEqual({ programs: 1, eval: 1 });
    expect(store?.notes.map((note) => note.line)).toEqual([1, 2]);
    expect(net?.via).toEqual(["goodfellow-plugin-guestbook", "tiny-store"]);
    expect(net?.counts).toEqual({ "install-script": 1, native: 1, network: 1 });
  });
});

describe("approving a plugin", () => {
  const plugin = definePlugin({
    name: "goodfellow-plugin-guestbook",
    title: "Guestbook",
    permissions: { connect: ["https://guestbook.example.com"], files: ["content/guestbook.json"] },
    admin: "goodfellow-plugin-guestbook/admin",
    screens: [{ id: "entries", title: "Guestbook" }],
  });
  const approved = { name: plugin.name, release: "1.0.0", ...pluginManifest(plugin) };

  it("lets a plugin that asks for what was approved load, and stops one that asks for more", () => {
    expect(installedPlugin(plugin, approved)).toBe(plugin);
    const greedier = { ...plugin, permissions: { ...plugin.permissions, secrets: ["GUESTBOOK_KEY"] }, server: "x" };
    expect(() => installedPlugin(greedier, approved)).toThrow(PluginError);
    expect(() => installedPlugin(greedier, approved)).toThrow(/secrets "GUESTBOOK_KEY", a server module/);
    expect(() => installedPlugin(undefined, approved)).toThrow(/doesn't export a plugin/);
  });
});

describe("installing a plugin", () => {
  const site = { packageJson: PACKAGE_JSON, config: STARTER_CONFIG, blocks: ["Heading"], plugins: [] };
  const release = { version: "1.0.0", published: "", provenance: true, goodfellow: "^0.40.0" };
  const manifest = {
    version: 1 as const,
    title: "Guestbook",
    permissions: { connect: ["https://guestbook.example.com"] },
    blocks: ["Guestbook"],
  };
  const guestbook = { name: "goodfellow-plugin-guestbook", release, manifest };

  it("names its release in package.json, records what was approved and lists installed plugins in the config", () => {
    const plan = planPluginInstall(site, guestbook, { today: "2026-10-25" });
    const files = new Map(plan.changes.map((change) => [change.path, "content" in change ? change.content : ""]));
    expect(JSON.parse(files.get("package.json") ?? "").dependencies).toEqual({
      "@goodfellow-cms/core": "0.40.0",
      "goodfellow-plugin-guestbook": "1.0.0",
      react: "19.3.0",
    });
    expect(parseInstalledPlugins(files.get("plugins/installed/installed.json")).plugins).toEqual({
      "goodfellow-plugin-guestbook": { release: "1.0.0", installed: "2026-10-25", goodfellow: "^0.40.0", manifest },
    });
    expect(files.get("plugins/installed/index.ts")).toContain('import plugin0 from "goodfellow-plugin-guestbook";');
    expect(files.get("plugins/installed/index.ts")).toContain("installedPlugin(plugin0, {");
    const config = files.get("goodfellow.config.tsx") ?? "";
    expect(configUsesInstalledPlugins(config)).toBe(true);
    expect(config).toContain(
      'import { installedBlocks, installedCategories } from "./blocks/installed";\nimport { installedPlugins } from "./plugins/installed";\n',
    );
    expect(config).toContain(
      "export default defineConfig({\n  // Plugins installed from the admin panel's Plugins screen.\n  plugins: installedPlugins,\n  blocks:",
    );
    expect(plan.configChanged).toBe(true);
  });

  it("leaves the config alone when it lists them, and asks a developer when it lists plugins of its own", () => {
    const listed = withInstalledPluginsConfig(STARTER_CONFIG) ?? "";
    const plan = planPluginInstall({ ...site, config: listed }, guestbook, { today: "2026-10-25" });
    expect(plan.configChanged).toBe(false);
    const own = STARTER_CONFIG.replace("blocks: {", "plugins: [myPlugin],\n  blocks: {");
    expect(() => planPluginInstall({ ...site, config: own }, guestbook, { today: "2026-10-25" })).toThrow(
      PluginInstallError,
    );
  });

  it("refuses plugins added in code and blocks whose names are taken", () => {
    expect(() =>
      planPluginInstall({ ...site, plugins: ["goodfellow-plugin-guestbook"] }, guestbook, { today: "2026-10-25" }),
    ).toThrow(expect.objectContaining({ problem: { code: "in-code" } }));
    expect(() => planPluginInstall({ ...site, blocks: ["Guestbook"] }, guestbook, { today: "2026-10-25" })).toThrow(
      expect.objectContaining({ problem: { code: "block-clash", blocks: ["Guestbook"] } }),
    );
  });

  it("updates an installed plugin, whose own blocks don't clash, and removes it", () => {
    const first = planPluginInstall(site, guestbook, { today: "2026-10-25" });
    const record = first.changes.find((change) => change.path === "plugins/installed/installed.json");
    const packageJson = first.changes.find((change) => change.path === "package.json");
    const installed = {
      ...site,
      record: record && "content" in record ? record.content : "",
      packageJson: packageJson && "content" in packageJson ? packageJson.content : "",
      blocks: ["Heading", "Guestbook"],
      plugins: ["goodfellow-plugin-guestbook"],
    };
    const newer = {
      ...guestbook,
      release: { ...release, version: "1.1.0" },
      manifest: { ...manifest, permissions: { connect: ["https://guestbook.example.com", "https://cdn.example.com"] } },
    };
    const update = planPluginInstall(installed, newer, { today: "2026-11-01" });
    expect(update.record.plugins["goodfellow-plugin-guestbook"]?.release).toBe("1.1.0");
    expect(permissionChanges(manifest, newer.manifest)).toEqual([
      { key: "connect", value: "https://cdn.example.com", change: "added" },
    ]);
    const removed = planPluginRemove(installed, "goodfellow-plugin-guestbook");
    const files = new Map(removed.changes.map((change) => [change.path, "content" in change ? change.content : ""]));
    expect(JSON.parse(files.get("package.json") ?? "").dependencies).toEqual({
      "@goodfellow-cms/core": "0.40.0",
      react: "19.3.0",
    });
    expect(files.get("plugins/installed/index.ts")).toBe(installedPluginsIndex({ version: 1, plugins: {} }));
    expect(() => planPluginRemove(site, "goodfellow-plugin-guestbook")).toThrow(PluginInstallError);
  });

  it("finds plugins an update would leave out of their range, and setups that write the lockfile", () => {
    const record = planPluginInstall(site, guestbook, { today: "2026-10-25" }).record;
    expect(pluginsOutOfRange(record, "0.40.3")).toEqual([]);
    expect(pluginsOutOfRange(record, "0.41.0")).toEqual([
      { name: "goodfellow-plugin-guestbook", title: "Guestbook", range: "^0.40.0" },
    ]);
    expect(writesLockfile(["run: npm ci", undefined])).toBe(false);
    expect(writesLockfile(["run: npm install --package-lock-only --ignore-scripts"])).toBe(true);
  });
});
