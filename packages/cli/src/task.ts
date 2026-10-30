import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  pluginId,
  sealTaskAnswer,
  type TaskAnswer,
  type TaskResultFile,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { runPluginTask, sitePluginsApart, taskSecretsFrom, writeTaskDescription } from "@goodfellow-cms/core/node";

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

/** Where `goodfellow task` loads the site's config from, in a process of its own. */
const CONFIG_LOADER = { module: new URL("./task-config.js", import.meta.url).href, export: "loadTaskConfig" };

/**
 * Writes down the task a request names, as the site's config has it, for the
 * starters' task job with no secrets (`goodfellow task --describe`), whose
 * job with them runs it with `@goodfellow-cms/core`'s `goodfellow-task`.
 */
export async function describeTask(options: { root?: string; plugin: string; task: string; out: string }) {
  return writeTaskDescription(resolve(options.root ?? "."), CONFIG_LOADER, options, options.out);
}

/**
 * Runs one of a plugin's tasks for the admin panel in one job, as sites'
 * task workflows and pipelines from before 0.9 do, and writes its answer
 * sealed to the request's key, even when the task fails, so the admin panel
 * can say why. The site's config loads in a process of its own, without the
 * job's secrets in its environment, but it can still read them where the job
 * started (`/proc`), which is why the starters now describe the task in a job
 * of its own (`describeTask()`) and run it with `goodfellow-task`.
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
    const plugins = await sitePluginsApart(root, CONFIG_LOADER);
    const plugin = plugins.find((candidate) => pluginId(candidate.name) === options.plugin);
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
