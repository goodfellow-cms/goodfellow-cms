import type { ComponentConfig } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { defineConfig } from "./config.js";
import {
  definePlugin,
  describePlugin,
  isPluginName,
  isPluginOrigin,
  PluginError,
  pluginFramePage,
  pluginFrameUrl,
  pluginId,
  pluginMayList,
  pluginMayUse,
  pluginPolicy,
  pluginProblems,
} from "./plugins.js";
import { parseSiteDescription } from "./site-description.js";

const block = { fields: {}, render: () => null } as unknown as ComponentConfig;

const storage = definePlugin({
  name: "goodfellow-plugin-storage",
  title: "Storage",
  version: "1.0.0",
  permissions: {
    connect: ["https://storage.example.com"],
    files: ["content/media.json", "public/media/"],
    secrets: ["STORAGE_KEY"],
    read: ["content/"],
    write: ["media/"],
  },
  blocks: { StorageGallery: block },
  categories: { storage: { title: "Storage", components: ["StorageGallery"] } },
  admin: "goodfellow-plugin-storage/admin",
  screens: [{ id: "settings", title: "Storage" }],
  build: [{ id: "upload", module: "goodfellow-plugin-storage/build", title: "Upload media" }],
  server: "goodfellow-plugin-storage/server",
});

describe("plugin names", () => {
  it("are goodfellow-plugin-<name>, scoped or not", () => {
    expect(isPluginName("goodfellow-plugin-s3")).toBe(true);
    expect(isPluginName("@acme/goodfellow-plugin-s3")).toBe(true);
    expect(isPluginName("s3-plugin")).toBe(false);
    expect(isPluginName("goodfellow-plugin-")).toBe(false);
    expect(pluginId("@acme/goodfellow-plugin-s3")).toBe("acme--goodfellow-plugin-s3");
  });
});

describe("a site's plugins", () => {
  it("add their blocks and categories to the config's own", () => {
    const config = defineConfig({
      blocks: { Heading: block },
      categories: { text: { components: ["Heading"] } },
      plugins: [storage],
    });
    expect(Object.keys(config.blocks)).toEqual(["Heading", "StorageGallery"]);
    expect(Object.keys(config.categories ?? {})).toEqual(["text", "storage"]);
  });

  it("stop the site from loading when a block's name is taken twice, or a plugin is named wrongly", () => {
    expect(() => defineConfig({ blocks: { StorageGallery: block }, plugins: [storage] })).toThrow(PluginError);
    const problems = pluginProblems([
      { ...storage, name: "storage-plugin", blocks: {} },
      { ...storage, blocks: {} },
      { ...storage, blocks: {} },
      { ...storage, blocks: {}, name: "goodfellow-plugin-other", title: " " },
    ]);
    expect(problems.map((problem) => problem.code)).toEqual(["bad-name", "duplicate", "no-title"]);
  });

  it("can't ask for what Goodfellow never gives", () => {
    const problems = pluginProblems([
      definePlugin({
        name: "goodfellow-plugin-greedy",
        title: "Greedy",
        permissions: {
          connect: ["http://tracker.example", "*", "https://*.example.com"],
          files: ["content/code/head.html", "goodfellow.config.tsx", "public/media/../../.env", "content/pages/"],
          secrets: ["GITHUB_TOKEN", "NODE_OPTIONS", "lowercase", "S3_KEY"],
          read: ["../secrets", "/etc/passwd", ".git/config", "content/"],
          write: ["../escape", "media/"],
        },
        screens: [{ id: "Settings", title: "Settings" }],
      }),
    ]);
    expect(problems.map((problem) => problem.code)).toEqual([
      "bad-connect",
      "bad-connect",
      "bad-file",
      "bad-file",
      "bad-file",
      "bad-secret",
      "bad-secret",
      "bad-secret",
      "bad-read",
      "bad-read",
      "bad-read",
      "bad-write",
      "bad-screen",
      "no-admin",
    ]);
    expect(isPluginOrigin("http://localhost:4400")).toBe(true);
    expect(isPluginOrigin("https://storage.example.com/path")).toBe(false);
  });
});

describe("what a plugin's screens may use", () => {
  const permissions = storage.permissions;

  it("is the files and folders it declared, and nothing outside them", () => {
    expect(pluginMayUse(permissions, "content/media.json")).toBe(true);
    expect(pluginMayUse(permissions, "public/media/photo.jpg")).toBe(true);
    expect(pluginMayUse(permissions, "public/media/../../goodfellow.config.tsx")).toBe(false);
    expect(pluginMayUse(permissions, "content/site.json")).toBe(false);
    expect(pluginMayUse(permissions, "public/media/")).toBe(false);
    expect(pluginMayUse({ files: ["content/"] }, "content/code/head.html")).toBe(false);
    expect(pluginMayList(permissions, "public/media")).toBe(true);
    expect(pluginMayList(permissions, "content/pages/")).toBe(false);
  });
});

describe("a plugin's admin frame", () => {
  it("is beside the editor's frames, wherever they are", () => {
    expect(pluginFrameUrl("/admin/editor/", "goodfellow-plugin-s3")).toBe(
      "/admin/plugins/goodfellow-plugin-s3/index.html",
    );
    expect(pluginFrameUrl("/docs/admin/editor/", "x")).toBe("/docs/admin/plugins/x/index.html");
    expect(pluginFrameUrl("/__goodfellow/api/editor/", "x")).toBe("/__goodfellow/api/plugins/x/index.html");
  });

  it("reaches only the addresses the plugin declared, and runs only its own script", () => {
    expect(pluginPolicy(storage.permissions)).toContain("connect-src https://storage.example.com;");
    expect(pluginPolicy({})).toContain("connect-src 'none'");
    expect(pluginPolicy({})).toContain("script-src 'self';");
    const page = pluginFramePage({ permissions: {}, scripts: ["plugin.js"], stylesheets: ["plugin.css"] });
    expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("plugin.css"));
    expect(page).toContain('<script src="plugin.js"></script>');
  });
});

describe("a plugin in the site's description", () => {
  it("lists what it may do, without its code, and reads back", () => {
    const description = describePlugin(storage);
    expect(description).toEqual({
      name: "goodfellow-plugin-storage",
      title: "Storage",
      version: "1.0.0",
      permissions: storage.permissions,
      id: "goodfellow-plugin-storage",
      admin: true,
      screens: [{ id: "settings", title: "Storage" }],
      build: [{ id: "upload", title: "Upload media" }],
      server: true,
    });
    const parsed = parseSiteDescription(
      JSON.stringify({
        version: 1,
        goodfellow: "0.6.0",
        content: {},
        root: { fields: {} },
        blocks: {},
        plugins: [description],
      }),
    );
    expect(parsed.ok && parsed.description.plugins?.[0]?.id).toBe("goodfellow-plugin-storage");
  });
});
