import {
  GitApiError,
  PluginTaskError,
  type PluginTaskRequest,
  type PluginTasks,
  TASK_JOB,
  TASK_POLL_MS,
  TASK_RESULT_FILE,
  TASK_TIMEOUT_MS,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";

export interface GitLabTasksOptions {
  /** How often to look for the answer, and how long to wait for it. */
  pollMs?: number;
  timeoutMs?: number;
  /** Waits between looks; tests pass one that doesn't. */
  wait?: (ms: number) => Promise<void>;
}

interface Job {
  id: number;
  name: string;
  status: string;
}

/**
 * Plugins' tasks on GitLab, through the starters' `plugin-task` job: a
 * pipeline started with the request's variables (`GOODFELLOW_TASK_PLUGIN` and
 * the rest), whose job leaves the sealed answer as its artifact, read here.
 * Starting pipelines on the main branch needs Developer access, which
 * editors have once `letEditorsPublish()` lets them publish.
 */
export function gitlabTasks(
  api: ApiOptions,
  project: string,
  branch: string,
  readSetup: () => Promise<string | undefined>,
  options: GitLabTasksOptions = {},
): PluginTasks {
  const base = `/projects/${encodeURIComponent(project)}`;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const supported = async () => ((await readSetup().catch(() => undefined)) ?? "").includes("$GOODFELLOW_TASK_PLUGIN");

  return {
    supported,
    async run(request: PluginTaskRequest) {
      const problem = taskRequestProblem(request);
      if (problem) throw new PluginTaskError("failed", problem);
      if (!(await supported())) {
        throw new PluginTaskError(
          "missing",
          "The site's setup files don't run plugins' tasks: .gitlab-ci.yml needs the plugin-task job.",
        );
      }
      const variable = (key: string, value: string) => ({ key, variable_type: "env_var", value });
      let pipeline: { id: number };
      try {
        pipeline = await gitlabJson<{ id: number }>(api, `${base}/pipeline`, {
          method: "POST",
          body: {
            ref: branch,
            variables: [
              variable("GOODFELLOW_TASK_REQUEST", request.id),
              variable("GOODFELLOW_TASK_PLUGIN", request.plugin),
              variable("GOODFELLOW_TASK_NAME", request.task),
              variable("GOODFELLOW_TASK_INPUT", request.input),
              variable("GOODFELLOW_TASK_KEY", request.key),
            ],
          },
        });
      } catch (error) {
        if (error instanceof GitApiError && (error.status === 403 || error.status === 401)) {
          throw new PluginTaskError(
            "not-allowed",
            "Running plugins' tasks needs a sign-in that can publish to the site.",
          );
        }
        throw error;
      }
      const deadline = Date.now() + (options.timeoutMs ?? TASK_TIMEOUT_MS);
      for (;;) {
        const jobs = await gitlabJson<Job[]>(api, `${base}/pipelines/${pipeline.id}/jobs?per_page=100`);
        const job = jobs.find((candidate) => candidate.name === TASK_JOB);
        if (job?.status === "success") {
          const answer = await gitlabRequest(api, `${base}/jobs/${job.id}/artifacts/${TASK_RESULT_FILE}`, {
            allow: [404],
          });
          if (answer.ok) return await answer.text();
          throw new PluginTaskError("failed", "The site's build service ran the task but left no answer.");
        }
        if (job && ["failed", "canceled", "skipped"].includes(job.status)) {
          throw new PluginTaskError("failed", "The site's build service couldn't run the task.");
        }
        if (Date.now() >= deadline) {
          throw new PluginTaskError("timeout", "The site's build service didn't answer in time.");
        }
        await wait(options.pollMs ?? TASK_POLL_MS);
      }
    },
  };
}
