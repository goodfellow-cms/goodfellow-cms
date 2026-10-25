import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginBuildError, runPluginBuildSteps } from "./node-plugins.js";
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
