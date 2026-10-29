import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mediaStorageOrigins,
  PluginBuildError,
  runPluginBuildSteps,
  runPluginTask,
  sitePluginsApart,
  taskSecretsFrom,
} from "./node-plugins.js";
import { definePlugin } from "./plugins.js";

/** A build step that tries everything it shouldn't, and writes down what it could do. */
const STEP = `
import { readFileSync, writeFileSync } from "node:fs";
export default async function step(context) {
  const tried = {};
  const attempt = (name, run) => {
    try {
      run();
      tried[name] = "allowed";
    } catch (error) {
      tried[name] = error.code ?? "failed";
    }
  };
  attempt("readContent", () => readFileSync(context.root + "/content/site.json"));
  attempt("readConfig", () => readFileSync(context.root + "/goodfellow.config.tsx"));
  attempt("readBuilt", () => readFileSync(context.outDir + "/index.html"));
  attempt("writeOutside", () => writeFileSync(context.outDir + "/index.html", "changed"));
  attempt("writeConfig", () => writeFileSync(context.root + "/goodfellow.config.tsx", "changed"));
  const { execFileSync } = await import("node:child_process");
  attempt("spawn", () => execFileSync(process.execPath, ["--version"]));
  tried.secrets = context.secrets;
  tried.env = Object.keys(process.env).filter((name) => /SECRET|TOKEN|STORAGE/.test(name));
  writeFileSync(context.outDir + "/media/report.json", JSON.stringify(tried));
}
`;

/** Tests that start Node processes, each of which can take seconds to start on Windows while many tests run at once, so a test can take a minute. */
const NODE_TIMEOUT = 180_000;

describe("plugins' build steps", { timeout: NODE_TIMEOUT }, () => {
  let root: string;
  let outDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-plugins-"));
    outDir = join(root, "dist");
    await mkdir(join(root, "content"), { recursive: true });
    await mkdir(join(root, "plugins/storage"), { recursive: true });
    await mkdir(join(outDir, "media"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "content/site.json"), "{}");
    await writeFile(join(root, "goodfellow.config.tsx"), "export default {};");
    await writeFile(join(outDir, "index.html"), "<p>Home</p>");
    await writeFile(join(root, "plugins/storage/build.mjs"), STEP);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("run with only the files and secrets their plugin declared", async () => {
    const plugin = definePlugin({
      name: "goodfellow-plugin-storage",
      title: "Storage",
      permissions: { read: ["content/"], write: ["media/"], secrets: ["STORAGE_KEY"] },
      build: [{ id: "upload", module: "./plugins/storage/build.mjs", title: "Upload media" }],
    });
    const ran = await runPluginBuildSteps({
      root,
      outDir,
      base: "/",
      plugins: [plugin],
      env: { PATH: process.env.PATH, STORAGE_KEY: "key", OTHER_SECRET: "nope", GITHUB_TOKEN: "nope" },
    });
    expect(ran.map((info) => info.title)).toEqual(["Upload media"]);
    expect(ran[0]?.env).not.toContain("OTHER_SECRET");
    const report = JSON.parse(await readFile(join(outDir, "media/report.json"), "utf8"));
    expect(report).toEqual({
      readContent: "allowed",
      readConfig: "ERR_ACCESS_DENIED",
      readBuilt: "allowed",
      writeOutside: "ERR_ACCESS_DENIED",
      writeConfig: "ERR_ACCESS_DENIED",
      spawn: "ERR_ACCESS_DENIED",
      secrets: { STORAGE_KEY: "key" },
      env: ["STORAGE_KEY"],
    });
    expect(await readFile(join(root, "goodfellow.config.tsx"), "utf8")).toBe("export default {};");
  });

  it("stop the build when one fails", async () => {
    await writeFile(join(root, "plugins/storage/fail.mjs"), "export default () => { throw new Error('No bucket.'); };");
    const plugin = definePlugin({
      name: "goodfellow-plugin-storage",
      title: "Storage",
      build: [{ id: "fail", module: "./plugins/storage/fail.mjs" }],
    });
    await expect(runPluginBuildSteps({ root, outDir, base: "/", plugins: [plugin], env: {} })).rejects.toBeInstanceOf(
      PluginBuildError,
    );
  });
});

/** A task that tries what it shouldn't, and answers with what it could do and what it was given. */
const TASK = `
import { readFileSync, writeFileSync } from "node:fs";
export default async function task(input, context) {
  const tried = {};
  const attempt = (name, run) => {
    try {
      run();
      tried[name] = "allowed";
    } catch (error) {
      tried[name] = error.code ?? "failed";
    }
  };
  attempt("readContent", () => readFileSync(context.root + "/content/site.json"));
  attempt("readConfig", () => readFileSync(context.root + "/goodfellow.config.tsx"));
  attempt("write", () => writeFileSync(context.root + "/content/site.json", "changed"));
  console.log("printed things don't mix with the answer");
  if (input.fail) throw new Error("The bucket said no.");
  return { input, tried, secrets: context.secrets, env: Object.keys(process.env).filter((name) => /SECRET|TOKEN|STORAGE/.test(name)) };
}
`;

describe("plugins' tasks", { timeout: NODE_TIMEOUT }, () => {
  let root: string;
  const plugin = definePlugin({
    name: "goodfellow-plugin-storage",
    title: "Storage",
    permissions: { read: ["content/"], secrets: ["STORAGE_KEY"] },
    tasks: [{ id: "sign", module: "./plugins/storage/sign.mjs" }],
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-tasks-"));
    await mkdir(join(root, "content"), { recursive: true });
    await mkdir(join(root, "plugins/storage"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "content/site.json"), "{}");
    await writeFile(join(root, "goodfellow.config.tsx"), "export default {};");
    await writeFile(join(root, "plugins/storage/sign.mjs"), TASK);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("run with only the files and secrets their plugin declared, and answer with what they return", async () => {
    const secrets = taskSecretsFrom({
      PATH: process.env.PATH,
      GITHUB_TOKEN: "repository token",
      GOODFELLOW_SECRETS: JSON.stringify({ STORAGE_KEY: "key", OTHER_SECRET: "not declared" }),
    });
    const answer = await runPluginTask({ root, plugin, task: "sign", input: '{"files":1}', secrets });
    expect(answer.ok).toBe(true);
    const output = (answer as { output: Record<string, unknown> }).output;
    expect(output.input).toEqual({ files: 1 });
    expect(output.tried).toEqual({
      readContent: "allowed",
      readConfig: "ERR_ACCESS_DENIED",
      write: "ERR_ACCESS_DENIED",
    });
    expect(output.secrets).toEqual({ STORAGE_KEY: "key" });
    expect(output.env).toEqual(["STORAGE_KEY"]);
    expect(await readFile(join(root, "content/site.json"), "utf8")).toBe("{}");
  });

  it("answer with what went wrong", async () => {
    expect(await runPluginTask({ root, plugin, task: "sign", input: '{"fail":true}', secrets: {} })).toEqual({
      ok: false,
      error: "The bucket said no.",
    });
    expect(await runPluginTask({ root, plugin, task: "other", input: "{}", secrets: {} })).toEqual({
      ok: false,
      error: 'Storage has no task called "other".',
    });
  });

  it("take GitHub's secrets out of the environment before anything else sees them", () => {
    const env: NodeJS.ProcessEnv = { GOODFELLOW_SECRETS: '{"A":"1"}', B: "2" };
    expect(taskSecretsFrom(env)).toEqual({ A: "1", B: "2" });
    expect(env).not.toHaveProperty("GOODFELLOW_SECRETS");
  });
});

describe("loading a site's plugins for a task", () => {
  it("loads the config in a process that has none of the job's secrets, even as it started", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodfellow-apart-"));
    try {
      await writeFile(
        join(root, "load.mjs"),
        `import { existsSync, readFileSync } from "node:fs";
export async function load(root) {
  const environ = existsSync("/proc/self/environ") ? readFileSync("/proc/self/environ", "utf8") : "";
  const saw = String(Boolean(process.env.GOODFELLOW_SECRETS || process.env.STORAGE_KEY || environ.includes("hush")));
  return {
    plugins: [{
      name: "goodfellow-plugin-storage",
      title: saw,
      root,
      permissions: { secrets: ["STORAGE_KEY"] },
      tasks: [{ id: "sign", module: "./sign.mjs" }],
      blocks: { Thing: { render: () => null } },
    }],
  };
}
`,
      );
      process.env.GOODFELLOW_SECRETS = JSON.stringify({ STORAGE_KEY: "hush" });
      process.env.STORAGE_KEY = "hush";
      const plugins = await sitePluginsApart(root, {
        module: pathToFileURL(join(root, "load.mjs")).href,
        export: "load",
      });
      expect(plugins).toEqual([
        {
          name: "goodfellow-plugin-storage",
          title: "false",
          root,
          permissions: { secrets: ["STORAGE_KEY"] },
          tasks: [{ id: "sign", module: "./sign.mjs" }],
        },
      ]);
    } finally {
      delete process.env.GOODFELLOW_SECRETS;
      delete process.env.STORAGE_KEY;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("says why the config couldn't be loaded", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodfellow-apart-"));
    try {
      await writeFile(join(root, "load.mjs"), 'export async function load() { throw new Error("No config here."); }\n');
      await expect(
        sitePluginsApart(root, { module: pathToFileURL(join(root, "load.mjs")).href, export: "load" }),
      ).rejects.toThrow("No config here.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("where a site keeps media outside the repository", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-storage-"));
    await mkdir(join(root, "content"), { recursive: true });
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("is the storage's origin, for editor plugins' frames to show its files", async () => {
    expect(await mediaStorageOrigins(root)).toEqual([]);
    const storage = { version: 1, plugin: "goodfellow-plugin-s3", url: "https://media.example.org/parish/", files: {} };
    await writeFile(join(root, "content/media-storage.json"), JSON.stringify(storage));
    expect(await mediaStorageOrigins(root)).toEqual(["https://media.example.org"]);
    await writeFile(join(root, "content/media-storage.json"), JSON.stringify({ ...storage, url: "ftp://media" }));
    expect(await mediaStorageOrigins(root)).toEqual([]);
    await writeFile(join(root, "content/media-storage.json"), "{");
    expect(await mediaStorageOrigins(root)).toEqual([]);
  });
});
