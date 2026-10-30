import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeContent } from "./content/serialize.js";
import { describedTask, isPluginsOwnModule, runDescribedTask, writeTaskDescription } from "./node-task-runner.js";
import { NO_INSTALLED_PLUGINS } from "./plugin-packages.js";
import { openTaskAnswer, taskKeys } from "./plugin-tasks.js";

const NODE_TIMEOUT = 180_000;
const request = { plugin: "goodfellow-plugin-storage", task: "sign" };
const description = (plugin: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    plugin: {
      name: "goodfellow-plugin-storage",
      title: "Storage",
      permissions: { secrets: ["STORAGE_KEY"] },
      ...plugin,
    },
    task: { id: "sign", module: "goodfellow-plugin-storage/sign", ...task },
  });

describe("isPluginsOwnModule", () => {
  it("takes the plugin's own package's files, and the site's own outside node_modules", () => {
    expect(isPluginsOwnModule("goodfellow-plugin-storage", "goodfellow-plugin-storage")).toBe(true);
    expect(isPluginsOwnModule("goodfellow-plugin-storage", "goodfellow-plugin-storage/sign")).toBe(true);
    expect(isPluginsOwnModule("@parish/goodfellow-plugin-storage", "@parish/goodfellow-plugin-storage/sign")).toBe(
      true,
    );
    expect(isPluginsOwnModule("goodfellow-plugin-storage", "./plugins/storage/sign.mjs")).toBe(true);
    for (const specifier of [
      "goodfellow-plugin-evil/sign",
      "goodfellow-plugin-storage-evil/sign",
      "goodfellow-plugin-storage/../evil/sign",
      "goodfellow-plugin-storage/./sign",
      "./node_modules/evil/sign.mjs",
      "./plugins/../../outside.mjs",
      "../outside.mjs",
      "/tmp/sign.mjs",
      "./plugins\\sign.mjs",
    ]) {
      expect(isPluginsOwnModule("goodfellow-plugin-storage", specifier), specifier).toBe(false);
    }
  });
});

describe("describedTask", () => {
  it("gives the task a description names, as a plugin with that one task", () => {
    expect(describedTask(description(), request, NO_INSTALLED_PLUGINS)).toEqual({
      name: "goodfellow-plugin-storage",
      title: "Storage",
      permissions: { secrets: ["STORAGE_KEY"] },
      tasks: [{ id: "sign", module: "goodfellow-plugin-storage/sign" }],
    });
  });

  it("never trusts what the site's code wrote", () => {
    const refused = (text: string | undefined, record = NO_INSTALLED_PLUGINS) => {
      const found = describedTask(text, request, record);
      return typeof found === "string" ? found : "accepted";
    };
    expect(refused(undefined)).toMatch(/couldn't be loaded/);
    expect(refused("not JSON")).toMatch(/couldn't be loaded/);
    expect(refused(JSON.stringify({ version: 2 }))).toMatch(/isn't one this release/);
    expect(refused(JSON.stringify({ version: 1, error: "No such plugin." }))).toBe("No such plugin.");
    expect(refused(JSON.stringify({ version: 1, plugin: { name: 1 } }))).toMatch(/isn't one Goodfellow wrote/);
    // Another plugin's, or another task's, than the request named.
    expect(refused(description({ name: "goodfellow-plugin-other" }))).toMatch(/another task/);
    expect(refused(description({}, { id: "delete" }))).toMatch(/another task/);
    // Another package's module, to give it the plugin's secrets.
    expect(refused(description({}, { module: "goodfellow-plugin-evil/steal" }))).toMatch(/isn't in its own package/);
    expect(refused(description({}, { module: "./node_modules/evil/steal.mjs" }))).toMatch(/isn't in its own package/);
    // The CI's own credentials, which no plugin may have.
    expect(refused(description({ permissions: { secrets: ["GITHUB_TOKEN"] } }))).toMatch(/GITHUB_TOKEN/);
    expect(refused(description({ permissions: { secrets: ["CI_JOB_JWT"] } }))).toMatch(/CI_JOB_JWT/);
    expect(refused(description({ permissions: { read: [".git"] } }))).toMatch(/\.git/);
  });

  it("gives a plugin installed from the admin panel no more than its owner approved", () => {
    const record = {
      version: 1 as const,
      plugins: {
        "goodfellow-plugin-storage": {
          release: "1.0.0",
          installed: "2026-10-30",
          manifest: {
            version: 1 as const,
            title: "Storage",
            permissions: { secrets: ["STORAGE_KEY"] },
            tasks: [{ id: "sign" }],
          },
        },
      },
    };
    expect(typeof describedTask(description(), request, record)).toBe("object");
    expect(
      describedTask(description({ permissions: { secrets: ["STORAGE_KEY", "S3_SECRET"] } }), request, record),
    ).toMatch(/more than its owner approved: secrets "S3_SECRET"/);
    expect(
      describedTask(description({}, { id: "delete" }), { plugin: "goodfellow-plugin-storage", task: "delete" }, record),
    ).toMatch(/the task "delete"/);
  });
});

const TASK = `export default async function (input, context) {
  return { secrets: context.secrets, env: Object.keys(process.env).filter((name) => /SECRET|KEY/.test(name)) };
}
`;

/** A site's config, loaded as the site's own code: it reports whatever secrets it could find, from anywhere. */
const CONFIG = `import { existsSync, readFileSync } from "node:fs";
export async function load(root) {
  const environs = [process.pid, process.ppid].map((pid) => "/proc/" + pid + "/environ")
    .filter((file) => existsSync(file)).map((file) => readFileSync(file, "utf8")).join("");
  const saw = environs.includes("hush") || Boolean(process.env.GOODFELLOW_SECRETS || process.env.STORAGE_KEY);
  return {
    plugins: [{
      name: "goodfellow-plugin-storage",
      title: saw ? "Saw the secrets" : "Storage",
      permissions: { secrets: ["STORAGE_KEY"] },
      tasks: [{ id: "sign", module: "./plugins/storage/sign.mjs" }],
    }],
  };
}
`;

describe("plugins' tasks in two parts", { timeout: NODE_TIMEOUT }, () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-two-parts-"));
    await mkdir(join(root, "plugins/storage"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "plugins/storage/sign.mjs"), TASK);
    await writeFile(join(root, "load.mjs"), CONFIG);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("describes the task where there are no secrets, and runs it with only those its plugin declared", async () => {
    // The job that describes the task has no secrets, so the site's code finds none, wherever it looks.
    const loader = { module: pathToFileURL(join(root, "load.mjs")).href, export: "load" };
    const written = await writeTaskDescription(root, loader, request, "goodfellow-task.json");
    expect(written).toEqual({
      version: 1,
      plugin: { name: "goodfellow-plugin-storage", title: "Storage", permissions: { secrets: ["STORAGE_KEY"] } },
      task: { id: "sign", module: "./plugins/storage/sign.mjs" },
    });

    const { publicKey, privateKey } = await taskKeys();
    const sealed = await runDescribedTask({
      root,
      request: { id: "abcdef123456", ...request, input: "{}", key: publicKey },
      description: await readFile(join(root, "goodfellow-task.json"), "utf8"),
      secrets: { STORAGE_KEY: "hush", OTHER_SECRET: "not declared", PATH: process.env.PATH ?? "" },
      out: "goodfellow-task-result.json",
    });
    expect(JSON.parse(await readFile(join(root, "goodfellow-task-result.json"), "utf8"))).toEqual(sealed);
    expect(await openTaskAnswer(JSON.stringify(sealed), privateKey)).toEqual({
      ok: true,
      output: { secrets: { STORAGE_KEY: "hush" }, env: ["STORAGE_KEY"] },
    });
  });

  it("answers with why it didn't run the task, sealed, where the description won't do", async () => {
    const { publicKey, privateKey } = await taskKeys();
    const sealed = await runDescribedTask({
      root,
      request: { id: "abcdef123456", ...request, input: "{}", key: publicKey },
      description: description({}, { module: "goodfellow-plugin-evil/steal" }),
      secrets: { STORAGE_KEY: "hush" },
      out: "goodfellow-task-result.json",
    });
    expect(await openTaskAnswer(JSON.stringify(sealed), privateKey)).toEqual({
      ok: false,
      error: `Storage's task "sign" isn't in its own package.`,
    });
  });

  it("reads the site's record of approved plugins as data", async () => {
    await mkdir(join(root, "plugins/installed"), { recursive: true });
    await writeFile(
      join(root, "plugins/installed/installed.json"),
      serializeContent({
        version: 1,
        plugins: {
          "goodfellow-plugin-storage": {
            release: "1.0.0",
            installed: "2026-10-30",
            manifest: { version: 1, title: "Storage", permissions: {}, tasks: [{ id: "sign" }] },
          },
        },
      }),
    );
    const { publicKey, privateKey } = await taskKeys();
    const sealed = await runDescribedTask({
      root,
      request: { id: "abcdef123456", ...request, input: "{}", key: publicKey },
      description: description({}, { module: "./plugins/storage/sign.mjs" }),
      secrets: { STORAGE_KEY: "hush" },
      out: "goodfellow-task-result.json",
    });
    expect(await openTaskAnswer(JSON.stringify(sealed), privateKey)).toMatchObject({
      ok: false,
      error: expect.stringContaining('secrets "STORAGE_KEY"'),
    });
  });
});
