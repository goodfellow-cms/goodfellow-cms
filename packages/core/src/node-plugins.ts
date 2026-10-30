/**
 * Plugins' parts that run in Node: build steps and tasks, each in a process
 * of its own held to what its plugin declared, and the type of full-stack
 * sites' server modules.
 */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { mediaStorageFileSchema } from "./content/media-storage.js";
import { MEDIA_STORAGE_FILE } from "./content/paths.js";
import { TASK_OUTPUT_LIMIT, type TaskAnswer } from "./plugin-tasks.js";
import {
  type GoodfellowPlugin,
  isPluginOrigin,
  type PluginBuildContext,
  type PluginServerEditor,
  type PluginTaskContext,
} from "./plugins.js";

/**
 * A plugin's server module's default export: answers a request to
 * `/__goodfellow/api/plugins/<id>/<path>` on a full-stack site, given the
 * path after the plugin's id and who's signed in, if anyone. It runs with
 * everything the server has: only a review backs what it declares.
 */
export type PluginServer = (
  request: Request,
  context: { path: string; editor: PluginServerEditor | null },
) => Response | Promise<Response>;

/** Where a plugin's module is, from the site's root: a package's export, or a path such as `./plugins/hello/build.ts`. */
export function resolvePluginModule(root: string, specifier: string): string {
  if (specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
    return resolve(root, specifier);
  }
  const require = createRequire(join(root, "package.json"));
  return require.resolve(specifier);
}

/**
 * The folder of the package a file belongs to, which its build step may read:
 * the nearest one up with a `package.json` inside the site, such as a
 * plugin's in `node_modules`, or, for a file of the site's own, its folder.
 */
function packageDir(file: string, root: string): string {
  const site = resolve(root);
  let dir = dirname(file);
  while (dir !== dirname(dir)) {
    // The site's own package, or one it's in, would be the whole site.
    if (dir === site || site.startsWith(`${dir}${sep}`)) return dirname(file);
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return dirname(file);
}

/** A path and the one it really is, for Node's permission checks, which may see either through a link. */
function withRealPath(path: string): string[] {
  try {
    const real = realpathSync(path);
    return real === path ? [path] : [path, real];
  } catch {
    return [path];
  }
}

/**
 * Runs a build step's module and calls its default export with its context.
 * Run with `node -e`, so it needs no file of its own to be allowed to read.
 */
const RUNNER = [
  "const [file, context] = process.argv.slice(1);",
  'const { pathToFileURL } = await import("node:url");',
  "const step = (await import(pathToFileURL(file).href)).default;",
  'if (typeof step !== "function") throw new Error("A build step\'s module must export a function as its default.");',
  "await step(JSON.parse(context));",
].join("\n");

/** Where a build step is in the build's output, and what it was given. */
export interface PluginBuildStepRunInfo {
  plugin: string;
  step: string;
  title: string;
  /** Node's arguments, which say what it may read and write. */
  args: string[];
  /** The environment variables it got, by name. */
  env: string[];
}

/** A build step stopped with an error. */
export class PluginBuildError extends Error {
  override name = "PluginBuildError";
  constructor(
    readonly plugin: string,
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PluginBuildOptions {
  root: string;
  outDir: string;
  base: string;
  plugins: readonly GoodfellowPlugin[];
  /** Where secrets come from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Told about each step before it runs. */
  onStep?: (info: PluginBuildStepRunInfo) => void;
}

/** Environment variables every step gets, which hold nothing secret but are needed to run Node and reach the network. */
const PASSED_ON = [
  "PATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "NODE_EXTRA_CA_CERTS",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
];

/**
 * Runs every plugin's build steps, in order, each in a Node process of its
 * own with Node's permission model on: it can read only the built site, its
 * own package, the site's `node_modules` and what its plugin declared in
 * `read`, write only what it declared in `write` (in the built site), and
 * start no other processes or workers. It gets only the environment variables
 * its plugin declared in `secrets`, besides what Node needs to run. Node
 * can't limit what it sends over the network. Throws a `PluginBuildError`
 * when a step fails, which stops the build.
 */
export async function runPluginBuildSteps(options: PluginBuildOptions): Promise<PluginBuildStepRunInfo[]> {
  const root = resolve(options.root);
  const outDir = resolve(options.outDir);
  const source = options.env ?? process.env;
  const ran: PluginBuildStepRunInfo[] = [];
  for (const plugin of options.plugins) {
    for (const step of plugin.build ?? []) {
      const file = resolvePluginModule(root, step.module);
      const permissions = plugin.permissions ?? {};
      const reads = [
        ...withRealPath(outDir),
        ...withRealPath(packageDir(file, root)),
        ...withRealPath(join(root, "node_modules")),
        ...(permissions.read ?? []).flatMap((path) => withRealPath(join(root, path))),
      ];
      const writes = (permissions.write ?? []).map((path) => join(outDir, path));
      // Node takes a path that isn't there yet for a file, so folders the step may write in are made first.
      for (const path of permissions.write ?? []) {
        if (path.endsWith("/")) await mkdir(join(outDir, path), { recursive: true });
      }
      const secrets = Object.fromEntries(
        (permissions.secrets ?? []).flatMap((name) => {
          const value = source[name];
          return value === undefined ? [] : [[name, value]];
        }),
      );
      const env = {
        ...Object.fromEntries(PASSED_ON.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]]]))),
        NODE_ENV: "production",
        ...secrets,
      };
      const context: PluginBuildContext = { root, outDir, base: options.base, secrets };
      const args = [
        "--permission",
        ...[...new Set(reads)].map((path) => `--allow-fs-read=${path}`),
        ...writes.map((path) => `--allow-fs-write=${path}`),
        "--input-type=module",
        "-e",
        RUNNER,
        file,
        JSON.stringify(context),
      ];
      const info: PluginBuildStepRunInfo = {
        plugin: plugin.name,
        step: step.id,
        title: step.title ?? step.id,
        args: args.slice(0, args.indexOf("-e")),
        env: Object.keys(env),
      };
      options.onStep?.(info);
      const code = await new Promise<number | null>((done, fail) => {
        const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
        child.on("error", fail);
        child.on("exit", (exit) => done(exit));
      });
      if (code !== 0) {
        throw new PluginBuildError(
          plugin.name,
          step.id,
          `${plugin.title}'s build step "${info.title}" failed${code === null ? "" : ` (exit code ${code})`}.`,
        );
      }
      ran.push(info);
    }
  }
  return ran;
}

/** For a site's own module, such as a plugin kept in the site's repository, its address to import. */
export function pluginModuleUrl(root: string, specifier: string): string {
  return pathToFileURL(resolvePluginModule(root, specifier)).href;
}

/**
 * Runs a task's module, calls its default export with its input and context,
 * and sends what it answers back over Node's IPC channel, so what the task
 * prints doesn't mix with its answer.
 */
const TASK_RUNNER = [
  "const [file, input, context] = process.argv.slice(1);",
  'const { pathToFileURL } = await import("node:url");',
  "let answer;",
  "try {",
  "  const task = (await import(pathToFileURL(file).href)).default;",
  '  if (typeof task !== "function") throw new Error("A task\'s module must export a function as its default.");',
  "  const output = await task(JSON.parse(input), JSON.parse(context));",
  "  answer = { ok: true, output: output === undefined ? null : output };",
  "} catch (error) {",
  "  answer = { ok: false, error: error instanceof Error ? error.message : String(error) };",
  "}",
  "process.send(answer, () => process.exit(0));",
].join("\n");

/**
 * Loads a site's config and sends back its plugins without their blocks, as
 * plain data, since only that crosses a process's edge.
 */
const PLUGINS_LOADER = [
  "const [root, module, name] = process.argv.slice(1);",
  "let answer;",
  "try {",
  "  const config = await (await import(module))[name](root);",
  "  const plugins = (config.plugins ?? []).map(({ blocks, categories, ...plugin }) => plugin);",
  "  answer = { ok: true, plugins: JSON.parse(JSON.stringify(plugins)) };",
  "} catch (error) {",
  "  answer = { ok: false, error: error instanceof Error ? error.message : String(error) };",
  "}",
  "process.send(answer, () => process.exit(0));",
].join("\n");

/** Where `sitePluginsApart()` loads a site's config from: a module's address, and the function it exports for it. */
export interface ConfigLoader {
  module: string;
  export: string;
}

/**
 * A site's plugins as its config lists them, without their blocks, loaded in
 * a Node process of its own whose environment has only what Node needs
 * (`PASSED_ON`), so the config can't read a job's secrets from `process.env`
 * or its own environment as it started. It can still read its parent's
 * (`/proc/<pid>/environ` on Linux), so never load it in a job that holds
 * secrets: the starters' task jobs describe the task where there are none
 * (`describeSiteTask()`) and run it with `runDescribedTask()`.
 */
export async function sitePluginsApart(root: string, loader: ConfigLoader): Promise<GoodfellowPlugin[]> {
  const env = Object.fromEntries(
    PASSED_ON.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])),
  );
  const args = ["--input-type=module", "-e", PLUGINS_LOADER, resolve(root), loader.module, loader.export];
  return await new Promise<GoodfellowPlugin[]>((done, fail) => {
    let answer: { ok: true; plugins: GoodfellowPlugin[] } | { ok: false; error: string } | undefined;
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (message) => {
      answer = message as typeof answer;
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      if (answer?.ok) done(answer.plugins);
      else fail(new Error(answer?.error ?? `The site's config couldn't be loaded (exit code ${code}).`));
    });
  });
}

/**
 * The secrets CI gave the task's job: its environment, and on GitHub every
 * repository secret as JSON in `GOODFELLOW_SECRETS` (`toJSON(secrets)`), since
 * a workflow can't name secrets it doesn't know. It takes
 * `GOODFELLOW_SECRETS` out of `process.env`, but the process's environment as
 * it started still has it, as it has every variable GitLab and Bitbucket give
 * a job, so never load the site's config in the job holding them (see
 * `runDescribedTask()`).
 */
export function taskSecretsFrom(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const all: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === "string") all[name] = value;
  const json = env.GOODFELLOW_SECRETS;
  delete env.GOODFELLOW_SECRETS;
  delete all.GOODFELLOW_SECRETS;
  if (json) {
    try {
      for (const [name, value] of Object.entries(JSON.parse(json) as Record<string, unknown>)) {
        if (typeof value === "string") all[name] = value;
      }
    } catch {
      // Not JSON: there are no secrets to add.
    }
  }
  return all;
}

export interface PluginTaskOptions {
  root: string;
  plugin: GoodfellowPlugin;
  task: string;
  /** What the admin panel passed, as JSON. */
  input: string;
  /** Where secrets come from, such as `taskSecretsFrom()`. */
  secrets: Record<string, string>;
  /** Told what the task's process was given, before it runs. */
  onRun?: (info: { args: string[]; env: string[] }) => void;
}

/**
 * Runs one of a plugin's tasks in a Node process of its own, held to what
 * the plugin declared as its build steps are: it reads only its own package,
 * the site's `node_modules` and what it declared in `read`, writes nothing,
 * starts no other processes, and gets only the secrets it declared. Answers
 * with what the task returned, or the message of what it threw.
 */
export async function runPluginTask(options: PluginTaskOptions): Promise<TaskAnswer> {
  const root = resolve(options.root);
  const { plugin } = options;
  const task = plugin.tasks?.find((candidate) => candidate.id === options.task);
  if (!task) return { ok: false, error: `${plugin.title} has no task called "${options.task}".` };
  const file = resolvePluginModule(root, task.module);
  const permissions = plugin.permissions ?? {};
  const reads = [
    ...withRealPath(packageDir(file, root)),
    ...withRealPath(join(root, "node_modules")),
    ...(permissions.read ?? []).flatMap((path) => withRealPath(join(root, path))),
  ];
  const secrets = Object.fromEntries(
    (permissions.secrets ?? []).flatMap((name) => {
      const value = options.secrets[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  const env = {
    ...Object.fromEntries(
      PASSED_ON.flatMap((name) => (options.secrets[name] === undefined ? [] : [[name, options.secrets[name]]])),
    ),
    NODE_ENV: "production",
    ...secrets,
  };
  const context: PluginTaskContext = { root, secrets };
  const args = [
    "--permission",
    ...[...new Set(reads)].map((path) => `--allow-fs-read=${path}`),
    "--input-type=module",
    "-e",
    TASK_RUNNER,
    file,
    options.input,
    JSON.stringify(context),
  ];
  options.onRun?.({ args: args.slice(0, args.indexOf("-e")), env: Object.keys(env) });
  return await new Promise<TaskAnswer>((done, fail) => {
    let answer: TaskAnswer | undefined;
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    child.on("message", (message) => {
      answer = message as TaskAnswer;
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      if (answer) {
        const size = JSON.stringify(answer).length;
        done(
          size > TASK_OUTPUT_LIMIT
            ? { ok: false, error: `${plugin.title}'s task "${task.id}" answered with too much.` }
            : answer,
        );
      } else {
        done({
          ok: false,
          error: `${plugin.title}'s task "${task.id}" stopped without answering${code === null ? "" : ` (exit code ${code})`}.`,
        });
      }
    });
  });
}

/**
 * The origins the site at `root` keeps media at outside the repository
 * (`content/media-storage.json`), for editor plugins' frames to show its files
 * from (`pluginFramePage()`'s `media`), as the site's pages do: none without
 * one, or where the file can't be read.
 */
export async function mediaStorageOrigins(root: string): Promise<string[]> {
  const text = await readFile(join(root, MEDIA_STORAGE_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return [];
  try {
    const parsed = mediaStorageFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return [];
    const origin = new URL(parsed.data.url).origin;
    return isPluginOrigin(origin) ? [origin] : [];
  } catch {
    return [];
  }
}
