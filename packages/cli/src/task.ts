import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type GoodfellowConfig,
  pluginId,
  sealTaskAnswer,
  type TaskAnswer,
  type TaskResultFile,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { runPluginTask, taskSecretsFrom } from "@goodfellow-cms/core/node";
import { createServer } from "vite";
import type { ClientModules } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry } from "./site.js";

export interface TaskOptions {
  root?: string;
  /** The admin panel's id for the request. */
  request: string;
  /** The plugin's id (`pluginId()`) and the task's. */
  plugin: string;
  task: string;
  /** What the admin panel passed, as JSON. */
  input: string;
  /** The public key the answer is sealed to, as a JSON Web Key. */
  key: string;
  /** Where to write the sealed answer, such as `goodfellow-task-result.json`. */
  out: string;
}

/** The site's config, loaded as `goodfellow build` loads it. */
async function siteConfig(root: string): Promise<GoodfellowConfig> {
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, findConfigFile(root), modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    return (await loadServerEntry(server)).config;
  } finally {
    await server.close();
  }
}

/**
 * Runs one of a plugin's tasks for the admin panel, as the starters' task
 * workflow and pipeline do, and writes its answer sealed to the request's
 * key, even when the task fails, so the admin panel can say why. Secrets are
 * taken out of the environment first, so loading the site's config never
 * sees them; the task gets only those its plugin declared.
 */
export async function runTask(options: TaskOptions): Promise<TaskResultFile> {
  const root = resolve(options.root ?? ".");
  const secrets = taskSecretsFrom(process.env);
  const problem = taskRequestProblem({
    id: options.request,
    plugin: options.plugin,
    task: options.task,
    input: options.input,
    key: options.key,
  });
  if (problem) throw new Error(problem);
  let answer: TaskAnswer;
  try {
    const config = await siteConfig(root);
    const plugin = (config.plugins ?? []).find((candidate) => pluginId(candidate.name) === options.plugin);
    answer = plugin
      ? await runPluginTask({
          root,
          plugin,
          task: options.task,
          input: options.input,
          secrets,
          onRun: () => console.log(`Running ${plugin.title}'s task "${options.task}"…`),
        })
      : { ok: false, error: `The site has no plugin ${options.plugin}.` };
  } catch (error) {
    answer = { ok: false, error: `The site couldn't run the task: ${error instanceof Error ? error.message : error}` };
  }
  const sealed = await sealTaskAnswer(answer, options.key);
  await writeFile(resolve(root, options.out), `${JSON.stringify(sealed)}\n`);
  return sealed;
}
