import {
  decodeBase64,
  GitApiError,
  PluginTaskError,
  type PluginTaskRequest,
  type PluginTasks,
  TASK_BRANCH_PREFIX,
  TASK_EVENT,
  TASK_POLL_MS,
  TASK_RESULT_FILE,
  TASK_TIMEOUT_MS,
  TASK_WORKFLOW,
  taskRequestProblem,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubRequest } from "./api.js";

export interface GitHubTasksOptions {
  /** How often to look for the answer, and how long to wait for it. */
  pollMs?: number;
  timeoutMs?: number;
  /** Waits between looks; tests pass one that doesn't. */
  wait?: (ms: number) => Promise<void>;
}

/** GitHub's own pages for an API address: `github.com` for its API, the host itself for GitHub Enterprise's `/api/v3`. */
function webBase(apiUrl: string): string {
  const url = new URL(apiUrl);
  if (url.hostname === "api.github.com") return "https://github.com";
  return `${url.origin}${url.pathname.replace(/\/api\/v3\/?$/, "")}`.replace(/\/+$/, "");
}

/**
 * Plugins' tasks on GitHub, through the starters' `plugin-task.yml`: a
 * `repository_dispatch` event starts it, which editors' tokens can send with
 * the Contents permission they publish with, and its `answer` job leaves the
 * sealed answer on a branch of its own, `goodfellow-task-<request>`, which is
 * read here and deleted. No Actions permission is needed.
 */
export function githubTasks(
  api: ApiOptions,
  repo: string,
  branch: string,
  options: GitHubTasksOptions = {},
): PluginTasks {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const contents = (path: string, ref: string) =>
    githubRequest(api, `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, { allow: [404] });

  const supported = async () => (await contents(`.github/workflows/${TASK_WORKFLOW}`, branch)).ok;

  return {
    supported,
    // The page that adds one of the repository's Actions secrets.
    secretsPlace: async () => ({ kind: "github", url: `${webBase(api.apiUrl)}/${repo}/settings/secrets/actions/new` }),
    async run(request: PluginTaskRequest) {
      const problem = taskRequestProblem(request);
      if (problem) throw new PluginTaskError("failed", problem);
      if (!(await supported())) {
        throw new PluginTaskError(
          "missing",
          "The site's setup files don't run plugins' tasks: it needs plugin-task.yml.",
        );
      }
      try {
        await githubRequest(api, `/repos/${repo}/dispatches`, {
          method: "POST",
          body: {
            event_type: TASK_EVENT,
            client_payload: {
              request: request.id,
              plugin: request.plugin,
              task: request.task,
              input: request.input,
              key: request.key,
            },
          },
        });
      } catch (error) {
        if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
          throw new PluginTaskError(
            "not-allowed",
            "Running plugins' tasks needs a sign-in that can publish to the site.",
          );
        }
        throw error;
      }
      const answerBranch = `${TASK_BRANCH_PREFIX}${request.id}`;
      const deadline = Date.now() + (options.timeoutMs ?? TASK_TIMEOUT_MS);
      for (;;) {
        const found = await contents(TASK_RESULT_FILE, answerBranch);
        if (found.ok) {
          const { content = "" } = (await found.json()) as { content?: string };
          // The answer has been read: its branch goes, whether or not that works.
          await githubRequest(api, `/repos/${repo}/git/refs/heads/${encodeURIComponent(answerBranch)}`, {
            method: "DELETE",
            allow: [404, 422],
          }).catch(() => {});
          return new TextDecoder().decode(decodeBase64(content.replace(/\s/g, "")));
        }
        if (Date.now() >= deadline) {
          throw new PluginTaskError("timeout", "The site's build service didn't answer in time.");
        }
        await wait(options.pollMs ?? TASK_POLL_MS);
      }
    },
  };
}
