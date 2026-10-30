/**
 * Plugins' tasks, run in two parts so the site's code and the job's secrets
 * never share a process, or a job. Loading the site's config runs every
 * package it imports, plugins' own included, with nothing to hold them, and
 * on Linux a process can read the environment its parent started with
 * (`/proc/<pid>/environ`), so loading it apart in the same job as the
 * secrets doesn't keep them from it. So a job with no secrets loads the
 * config and writes down the task (`describeSiteTask()`), and the job with
 * them runs `runDescribedTask()` from a release of `@goodfellow-cms/core`
 * installed from npm apart from the site's packages (the `goodfellow-task`
 * bin), which checks the description, never trusting it, and runs only the
 * plugin's own task module, held as `runPluginTask()` holds it.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { INSTALLED_PLUGINS_FILE } from "./content/paths.js";
import { type ConfigLoader, runPluginTask, sitePluginsApart } from "./node-plugins.js";
import { type ApprovedPlugin, type InstalledPlugins, parseInstalledPlugins, unapproved } from "./plugin-packages.js";
import {
  type PluginTaskRequest,
  sealTaskAnswer,
  type TaskAnswer,
  type TaskResultFile,
  taskRequestProblem,
} from "./plugin-tasks.js";
import { type GoodfellowPlugin, type PluginPermissions, pluginId, pluginProblems } from "./plugins.js";

/** Where the job that loads the config writes the task's description, for the job with the secrets. */
export const TASK_DESCRIPTION_FILE = "goodfellow-task.json";

/** A plugin's task as the site's config has it, as data: the plugin's name, title and permissions, and the task's module. */
export type TaskDescription =
  | {
      version: 1;
      plugin: { name: string; title: string; permissions: PluginPermissions };
      task: { id: string; module: string };
    }
  | { version: 1; error: string };

/**
 * The task a request names, as the site's config has it, loaded in a process
 * of its own (`sitePluginsApart()`): run where the job has no secrets.
 */
export async function describeSiteTask(
  root: string,
  loader: ConfigLoader,
  request: Pick<PluginTaskRequest, "plugin" | "task">,
): Promise<TaskDescription> {
  try {
    const plugins = await sitePluginsApart(resolve(root), loader);
    const plugin = plugins.find((candidate) => pluginId(candidate.name) === request.plugin);
    if (!plugin) return { version: 1, error: `The site has no plugin ${request.plugin}.` };
    const task = plugin.tasks?.find((candidate) => candidate.id === request.task);
    if (!task) return { version: 1, error: `${plugin.title} has no task called "${request.task}".` };
    return {
      version: 1,
      plugin: { name: plugin.name, title: plugin.title, permissions: plugin.permissions ?? {} },
      task: { id: task.id, module: task.module },
    };
  } catch (error) {
    return {
      version: 1,
      error: `The site's config couldn't be loaded: ${error instanceof Error ? error.message : error}`,
    };
  }
}

/** Writes `describeSiteTask()`'s description of a request's task to a file. */
export async function writeTaskDescription(
  root: string,
  loader: ConfigLoader,
  request: Pick<PluginTaskRequest, "plugin" | "task">,
  out: string = TASK_DESCRIPTION_FILE,
): Promise<TaskDescription> {
  const description = await describeSiteTask(root, loader, request);
  await writeFile(resolve(root, out), `${JSON.stringify(description)}\n`);
  return description;
}

/** Whether a path relative to a package or the site has no way out of it, and never reaches into `node_modules`. */
function isOwnPath(path: string): boolean {
  const parts = path.split("/");
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    parts.every((part) => part !== "" && part !== "." && part !== ".." && part !== "node_modules")
  );
}

/**
 * Whether a task's module is the plugin's own: a file in its package
 * (`goodfellow-plugin-s3/task`), or, for a plugin of the site's own, a file of
 * the site's outside `node_modules` (`./plugins/greeter/task.js`), so a
 * description can't send another plugin's secrets to a module it chose.
 */
export function isPluginsOwnModule(name: string, specifier: string): boolean {
  if (specifier === name) return true;
  if (specifier.startsWith(`${name}/`)) return isOwnPath(specifier.slice(name.length + 1));
  if (specifier.startsWith("./")) return isOwnPath(specifier.slice(2));
  return false;
}

function asPlugin(description: unknown): GoodfellowPlugin | string {
  const found = description as Partial<Extract<TaskDescription, { plugin: unknown }>> & { error?: unknown };
  if (found?.version !== 1) return "The task's description isn't one this release of Goodfellow reads.";
  if (typeof found.error === "string") return found.error;
  const { plugin, task } = found;
  if (
    typeof plugin?.name !== "string" ||
    typeof plugin.title !== "string" ||
    typeof plugin.permissions !== "object" ||
    plugin.permissions === null ||
    typeof task?.id !== "string" ||
    typeof task.module !== "string"
  ) {
    return "The task's description isn't one Goodfellow wrote.";
  }
  return {
    name: plugin.name,
    title: plugin.title,
    permissions: plugin.permissions,
    tasks: [{ id: task.id, module: task.module }],
  };
}

/**
 * The plugin and task a description names, checked as if the site's code had
 * written it, since it did: the task and plugin the request names, the
 * plugin's own module, permissions any plugin may have (no CI credentials),
 * and, for a plugin installed from the admin panel, no more than its owner
 * approved. Gives what's wrong instead, in words.
 */
export function describedTask(
  text: string | undefined,
  request: Pick<PluginTaskRequest, "plugin" | "task">,
  record: InstalledPlugins,
): GoodfellowPlugin | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    return "The site's config couldn't be loaded, so the task wasn't described.";
  }
  const plugin = asPlugin(parsed);
  if (typeof plugin === "string") return plugin;
  const task = plugin.tasks?.[0];
  if (pluginId(plugin.name) !== request.plugin || task?.id !== request.task) {
    return "The task's description is of another task than the one asked for.";
  }
  if (!isPluginsOwnModule(plugin.name, task.module)) {
    return `${plugin.title}'s task "${task.id}" isn't in its own package.`;
  }
  const problem = pluginProblems([plugin])[0];
  if (problem) return problem.message;
  const installed = record.plugins[plugin.name];
  if (installed) {
    const approved: ApprovedPlugin = { ...installed.manifest, name: plugin.name, release: installed.release };
    const more = unapproved(approved, plugin);
    if (more.length > 0) return `${plugin.title} asks for more than its owner approved: ${more.join(", ")}.`;
  }
  return plugin;
}

export interface DescribedTaskOptions {
  root: string;
  request: PluginTaskRequest;
  /** What the job that loaded the site's config wrote, or nothing where it didn't. */
  description: string | undefined;
  /** Where secrets come from, such as `taskSecretsFrom()`. */
  secrets: Record<string, string>;
  /** Where to write the sealed answer. */
  out: string;
}

/**
 * Runs the task a description names, never loading the site's config, and
 * writes its answer sealed to the request's key, even when it fails, so the
 * admin panel can say why.
 */
export async function runDescribedTask(options: DescribedTaskOptions): Promise<TaskResultFile> {
  const root = resolve(options.root);
  const problem = taskRequestProblem(options.request);
  if (problem) throw new Error(problem);
  let answer: TaskAnswer;
  try {
    const record = parseInstalledPlugins(
      await readFile(join(root, INSTALLED_PLUGINS_FILE), "utf8").catch(() => undefined),
    );
    const plugin = describedTask(options.description, options.request, record);
    answer =
      typeof plugin === "string"
        ? { ok: false, error: plugin }
        : await runPluginTask({
            root,
            plugin,
            task: options.request.task,
            input: options.request.input,
            secrets: options.secrets,
            onRun: () => console.log(`Running ${plugin.title}'s task "${options.request.task}"…`),
          });
  } catch (error) {
    answer = { ok: false, error: `The site couldn't run the task: ${error instanceof Error ? error.message : error}` };
  }
  const sealed = await sealTaskAnswer(answer, options.request.key);
  await writeFile(resolve(root, options.out), `${JSON.stringify(sealed)}\n`);
  return sealed;
}
