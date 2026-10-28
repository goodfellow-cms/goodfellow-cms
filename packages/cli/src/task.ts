import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  pluginId,
  sealTaskAnswer,
  type TaskAnswer,
  type TaskResultFile,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { runPluginTask, sitePluginsApart, taskSecretsFrom } from "@goodfellow-cms/core/node";

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

/**
 * Runs one of a plugin's tasks for the admin panel, as the starters' task
 * workflow and pipeline do, and writes its answer sealed to the request's
 * key, even when the task fails, so the admin panel can say why. The site's
 * config loads in a process of its own, with none of the job's secrets; the
 * task gets only those its plugin declared.
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
    const plugins = await sitePluginsApart(root, {
      module: new URL("./task-config.js", import.meta.url).href,
      export: "loadTaskConfig",
    });
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
