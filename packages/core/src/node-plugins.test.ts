import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginBuildError, runPluginBuildSteps, runPluginTask, taskSecretsFrom } from "./node-plugins.js";
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

describe("plugins' build steps", () => {
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

describe("plugins' tasks", () => {
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
