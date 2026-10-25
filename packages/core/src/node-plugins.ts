/**
 * Plugins' parts that run in Node: build steps, each in a process of its own
 * held to what its plugin declared, and the type of full-stack sites' server
 * modules.
 */
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { GoodfellowPlugin, PluginBuildContext, PluginServerEditor } from "./plugins.js";

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
