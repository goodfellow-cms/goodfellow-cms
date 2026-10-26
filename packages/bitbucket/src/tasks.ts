import {
  BITBUCKET_PIPELINE_NAMES,
  GitApiError,
  PluginTaskError,
  type PluginTaskRequest,
  type PluginTasks,
  SignInError,
  TASK_BRANCH_PREFIX,
  TASK_POLL_MS,
  TASK_RESULT_FILE,
  TASK_TIMEOUT_MS,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { type ApiOptions, bitbucketJson, bitbucketRequest } from "./api.js";
import { type Pipeline, runPipeline } from "./pipelines.js";
import { BITBUCKET_WEB } from "./web.js";

export interface BitbucketTasksOptions {
  /** How often to look for the answer, and how long to wait for it. */
  pollMs?: number;
  timeoutMs?: number;
  /** Waits between looks; tests pass one that doesn't. */
  wait?: (ms: number) => Promise<void>;
}

/**
 * Plugins' tasks on Bitbucket, through the `plugin-task` custom pipeline of
 * the site's `bitbucket-pipelines.yml`: started with the request's variables
 * (`GOODFELLOW_TASK_PLUGIN` and the rest), it leaves the sealed answer on a
 * branch of its own, `goodfellow-task-<request>`, which is read here and
 * deleted, since Bitbucket's API can't read a step's files.
 */
export function bitbucketTasks(
  api: ApiOptions,
  repo: string,
  branch: string,
  readSetup: () => Promise<string | undefined>,
  options: BitbucketTasksOptions = {},
): PluginTasks {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const supported = async () => ((await readSetup().catch(() => undefined)) ?? "").includes("GOODFELLOW_TASK_PLUGIN");

  return {
    supported,
    // The repository's Pipelines variables, where secured ones are added.
    secretsPlace: async () => ({
      kind: "bitbucket",
      url: `${BITBUCKET_WEB}/${repo}/admin/pipelines/repository-variables`,
    }),
    async run(request: PluginTaskRequest) {
      const problem = taskRequestProblem(request);
      if (problem) throw new PluginTaskError("failed", problem);
      if (!(await supported())) {
        throw new PluginTaskError(
          "missing",
          "The site's setup files don't run plugins' tasks: bitbucket-pipelines.yml needs the plugin-task pipeline.",
        );
      }
      let pipeline: Pipeline;
      try {
        pipeline = await runPipeline(api, repo, branch, BITBUCKET_PIPELINE_NAMES.task, {
          GOODFELLOW_TASK_REQUEST: request.id,
          GOODFELLOW_TASK_PLUGIN: request.plugin,
          GOODFELLOW_TASK_NAME: request.task,
          GOODFELLOW_TASK_INPUT: request.input,
          GOODFELLOW_TASK_KEY: request.key,
        });
      } catch (error) {
        // Bitbucket refuses to run pipelines in a repository that hasn't turned them on.
        if (error instanceof GitApiError && error.status === 400) {
          throw new PluginTaskError("missing", "The site's repository doesn't have Bitbucket Pipelines turned on.");
        }
        if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
          throw new PluginTaskError(
            "not-allowed",
            "Running plugins' tasks needs a sign-in that can run the site's pipelines.",
          );
        }
        throw error;
      }
      const answerBranch = `${TASK_BRANCH_PREFIX}${request.id}`;
      const pipelinePath = `/repositories/${repo}/pipelines/${encodeURIComponent(pipeline.uuid)}`;
      const deadline = Date.now() + (options.timeoutMs ?? TASK_TIMEOUT_MS);
      let finished = false;
      for (;;) {
        const found = await bitbucketRequest(
          api,
          `/repositories/${repo}/src/${encodeURIComponent(answerBranch)}/${TASK_RESULT_FILE}`,
          { allow: [404] },
        );
        if (found.ok) {
          const answer = await found.text();
          // The answer has been read: its branch goes, whether or not that works.
          await bitbucketRequest(api, `/repositories/${repo}/refs/branches/${encodeURIComponent(answerBranch)}`, {
            method: "DELETE",
            allow: [403, 404],
          }).catch(() => {});
          return answer;
        }
        // Once the pipeline has finished, its answer is there, so one more look is enough.
        if (finished) throw new PluginTaskError("failed", "The site's build service couldn't run the task.");
        const state = await bitbucketJson<Pipeline>(api, pipelinePath).catch((error: unknown) => {
          if (error instanceof SignInError) throw error;
          return undefined;
        });
        finished = state?.state?.name === "COMPLETED";
        if (finished) continue;
        if (Date.now() >= deadline) {
          throw new PluginTaskError("timeout", "The site's build service didn't answer in time.");
        }
        await wait(options.pollMs ?? TASK_POLL_MS);
      }
    },
  };
}
