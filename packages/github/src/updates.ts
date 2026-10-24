import {
  type CodeRepository,
  compareReleases,
  GitApiError,
  type GitBackend,
  SignInError,
  type SiteUpdates,
  siteVersion,
  type UpdateRun,
  UpdatesError,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest, repoPath } from "./api.js";

/** The starters' GitHub Pages workflow, which runs `goodfellow update` each night and when it's dispatched. */
const WORKFLOW = "deploy.yml";
/** The code repository's workflow, where a site keeps its content in a repository of its own. */
const CODE_WORKFLOW = "update.yml";
/** The job that publishes the update, which the job that builds the site with it can't. */
const PUBLISH_JOB = "publish-update";

interface Run {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  created_at?: string;
  html_url?: string;
}

interface Job {
  name: string;
  conclusion: string | null;
}

interface Reads {
  read(path: string): Promise<string | undefined>;
  readAt(path: string, revision: string): Promise<string | undefined>;
}

/**
 * The site's nightly update, which runs in its GitHub Pages workflow. Running
 * it now dispatches the workflow, which needs GitHub's Actions permission
 * with write access: `manage()` gives the owner token when one is in use.
 */
export function githubUpdates(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  branch: string,
  files: Reads,
  workflow = WORKFLOW,
): SiteUpdates {
  const path = `/repos/${repo}/actions/workflows/${workflow}`;
  const workflowFile = `.github/workflows/${workflow}`;

  return {
    async setup() {
      const text = await files.read(workflowFile);
      return text && /update --(publish|commit)\b/.test(text) ? "ready" : "missing";
    },

    async lastRun(): Promise<UpdateRun | undefined> {
      const response = await githubRequest(read, `${path}/runs?branch=${encodeURIComponent(branch)}&per_page=20`, {
        allow: [403, 404],
      });
      if (!response.ok) return undefined;
      const { workflow_runs: runs = [] } = (await response.json()) as { workflow_runs?: Run[] };
      for (const run of runs.filter((candidate) => ["schedule", "workflow_dispatch"].includes(candidate.event))) {
        const base = { date: run.created_at, detailsUrl: run.html_url };
        if (run.status !== "completed") return { state: "running", ...base };
        const { jobs = [] } = await githubJson<{ jobs?: Job[] }>(read, `/repos/${repo}/actions/runs/${run.id}/jobs`);
        const job = jobs.find((candidate) => candidate.name === "update");
        // A run dispatched only to build, which didn't update.
        if (!job || job.conclusion === "skipped") continue;
        if (job.conclusion !== "success") return { state: "failed", ...base };
        // The job that publishes what the update job built, where the workflow keeps them apart.
        const publish = jobs.find((candidate) => candidate.name === PUBLISH_JOB);
        if (publish && publish.conclusion !== "success" && publish.conclusion !== "skipped") {
          return { state: "failed", ...base };
        }
        // Fine-grained tokens can't read the job's log, so compare the site's version before and after.
        const before = siteVersion((await files.readAt("package.json", run.head_sha)) ?? "");
        const now = siteVersion((await files.read("package.json")) ?? "");
        if (!before || !now || before === now) return { state: "up-to-date", ...base };
        const rollback = compareReleases(now, before) < 0;
        return {
          state: "updated",
          ...base,
          result: { state: "updated", from: before, to: now, ...(rollback && { rollback }) },
        };
      }
      return undefined;
    },

    async start(target) {
      try {
        await githubRequest(manage() ?? read, `${path}/dispatches`, {
          method: "POST",
          body: { ref: branch, inputs: { update: target } },
        });
      } catch (error) {
        if (error instanceof GitApiError && (error.status === 403 || error.status === 401)) {
          throw new UpdatesError("not-allowed", "Running the update needs a token that can run the site's workflows.");
        }
        // No such workflow, or an older one that takes no inputs.
        if (error instanceof GitApiError && (error.status === 404 || error.status === 422)) {
          throw new UpdatesError("missing", "The site's GitHub Pages workflow doesn't update Goodfellow.");
        }
        throw error;
      }
    },
  };
}

/** Whether an error means the sign-in can't see the code repository, or has no token for it. */
function noAccess(error: unknown): boolean {
  return (
    (error instanceof SignInError && error.problem === "no-access") ||
    (error instanceof GitApiError && (error.status === 403 || error.status === 404))
  );
}

export interface CodeUpdatesOptions {
  /** The code repository, `owner/name`. */
  repo: string;
  webUrl: string;
  /** Reads it, or `undefined` where the sign-in has no token for it. */
  read: ApiOptions | undefined;
  /** Runs its workflow: the owner's sign-in, where there is one. */
  manage: () => ApiOptions | undefined;
  /** The code repository's files on a branch, read at its newest commit. */
  open: (api: ApiOptions, branch: string) => Pick<GitBackend, "revision" | "readAt" | "history">;
}

/**
 * The nightly update of a site whose content is kept in a repository of its
 * own, which runs in the code repository's `update.yml`. The sign-in needs to
 * see the code repository too; where it can't, `setup()` says `no-access`.
 */
export function githubCodeUpdates(options: CodeUpdatesOptions): SiteUpdates {
  const { read } = options;
  const repo = repoPath(options.repo);
  let branch: Promise<string> | undefined;
  const liveBranch = (api: ApiOptions) => {
    branch ??= githubJson<{ default_branch: string }>(api, `/repos/${repo}`).then((found) => found.default_branch);
    branch.catch(() => {
      branch = undefined;
    });
    return branch;
  };
  /** The code repository at its newest commit, read again each time, since updates change it. */
  async function files() {
    if (!read) throw new SignInError("no-access", `This sign-in has no access to ${options.repo}.`);
    return options.open(read, await liveBranch(read));
  }
  /** A file as it is now: setup files are outside the folders backends list, so they're read at the newest commit. */
  async function readNow(path: string) {
    const backend = await files();
    return backend.readAt(path, await backend.revision());
  }
  async function updates(): Promise<SiteUpdates> {
    if (!read) throw new SignInError("no-access", `This sign-in has no access to ${options.repo}.`);
    const target = await liveBranch(read);
    return githubUpdates(
      read,
      options.manage,
      repo,
      target,
      {
        read: readNow,
        readAt: async (path, revision) => (await files()).readAt(path, revision),
      },
      CODE_WORKFLOW,
    );
  }
  const code: CodeRepository = {
    repo: options.repo,
    webUrl: `${options.webUrl}/${options.repo}`,
    read: readNow,
    history: async (path, history) => (await files()).history(path, history),
    readAt: async (path, revision) => (await files()).readAt(path, revision),
  };
  return {
    code,
    async setup() {
      try {
        return await (await updates()).setup();
      } catch (error) {
        if (noAccess(error)) return "no-access";
        throw error;
      }
    },
    async lastRun() {
      try {
        return await (await updates()).lastRun();
      } catch (error) {
        if (noAccess(error)) return undefined;
        throw error;
      }
    },
    async start(target) {
      await (await updates()).start(target);
    },
  };
}
