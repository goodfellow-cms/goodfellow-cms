import {
  type CodeRepository,
  findUpdateResult,
  GitApiError,
  type GitBackend,
  NIGHTLY_VARIABLE,
  type NightlyBuilds,
  type NightlyMode,
  type SiteUpdates,
  type UpdateRun,
  UpdatesError,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";
import { SCHEDULED_BUILD_DESCRIPTION } from "./scheduled-builds.js";

const CI_FILE = ".gitlab-ci.yml";
/** When the nightly schedule the Updates screen adds runs, in UTC, as the GitHub Pages workflow's does. */
export const NIGHTLY = "17 4 * * *";

interface Schedule {
  id: number;
  ref: string;
  active: boolean;
  description?: string;
  variables?: Array<{ key: string; value: string }>;
}

interface Pipeline {
  id: number;
  source?: string;
  status: string;
  created_at?: string;
  web_url?: string;
}

function notAllowed(error: unknown): never {
  if (error instanceof GitApiError && (error.status === 401 || error.status === 403)) {
    throw new UpdatesError("not-allowed", "Setting up updates on GitLab needs the Maintainer role in the project.");
  }
  throw error;
}

/**
 * The site's nightly update, which runs in its GitLab Pages job on scheduled
 * pipelines, and on pipelines the Updates screen starts with `GOODFELLOW_UPDATE`.
 * It publishes with the job's own token, which GitLab only allows once the
 * project lets job tokens push.
 */
export function gitlabUpdates(
  api: ApiOptions,
  project: string,
  branch: string,
  readAt: (path: string) => Promise<string | undefined>,
  /** The job that runs `update`: the pages job in a site's own pipeline, or an `update` job, as the code project's. */
  jobName = "pages",
): SiteUpdates {
  const base = `/projects/${encodeURIComponent(project)}`;

  async function schedules() {
    return gitlabJson<Schedule[]>(api, `${base}/pipeline_schedules`);
  }
  /** The nightly schedule: the branch's, other than those the admin panel adds for scheduled changes. */
  async function nightlySchedule(): Promise<Schedule | undefined> {
    return (await schedules()).find(
      (schedule) =>
        (schedule.ref === branch || schedule.ref === `refs/heads/${branch}`) &&
        !schedule.description?.startsWith(SCHEDULED_BUILD_DESCRIPTION),
    );
  }

  /**
   * The nightly build setting: "never" turns the nightly schedule off, and
   * "every night" gives it `GOODFELLOW_NIGHTLY`, which the pages job reads.
   */
  const nightly: NightlyBuilds = {
    async supported() {
      return (await readAt(CI_FILE))?.includes("nightly") ?? false;
    },
    async get() {
      try {
        const found = await nightlySchedule();
        if (!found) return undefined;
        if (!found.active) return "off";
        // The list leaves schedules' variables out.
        const schedule = await gitlabJson<Schedule>(api, `${base}/pipeline_schedules/${found.id}`);
        const value = schedule.variables?.find((variable) => variable.key === NIGHTLY_VARIABLE)?.value;
        return value === "always" ? "always" : "changed";
      } catch (error) {
        if (error instanceof GitApiError && error.status === 403) return undefined;
        throw error;
      }
    },
    async set(mode: NightlyMode) {
      const found = await nightlySchedule().catch(notAllowed);
      if (!found) throw new UpdatesError("missing", "The site has no nightly schedule yet: turn on updates first.");
      const path = `${base}/pipeline_schedules/${found.id}`;
      await gitlabRequest(api, path, { method: "PUT", body: { active: mode !== "off" } }).catch(notAllowed);
      if (mode === "always") {
        const body = { key: NIGHTLY_VARIABLE, value: "always" };
        const updated = await gitlabRequest(api, `${path}/variables/${NIGHTLY_VARIABLE}`, {
          method: "PUT",
          body,
          allow: [404],
        }).catch(notAllowed);
        if (updated.status === 404) {
          await gitlabRequest(api, `${path}/variables`, { method: "POST", body }).catch(notAllowed);
        }
      } else if (mode === "changed") {
        await gitlabRequest(api, `${path}/variables/${NIGHTLY_VARIABLE}`, {
          method: "DELETE",
          allow: [404],
        }).catch(notAllowed);
      }
    },
  };

  return {
    async setup() {
      const ci = await readAt(CI_FILE);
      if (!ci?.includes("update --publish")) return "missing";
      try {
        const [settings, found] = await Promise.all([
          gitlabJson<{ ci_push_repository_for_job_token_allowed?: boolean }>(api, base),
          schedules(),
        ]);
        // The nightly schedule, even where it's been turned off, which the nightly build setting does.
        const scheduled = found.some(
          (schedule) =>
            (schedule.ref === branch || schedule.ref === `refs/heads/${branch}`) &&
            (schedule.active || !schedule.description?.startsWith(SCHEDULED_BUILD_DESCRIPTION)),
        );
        return settings.ci_push_repository_for_job_token_allowed && scheduled ? "ready" : "needs-setup";
      } catch (error) {
        // Developers can't see a project's schedules; they can still see what the last run did.
        if (error instanceof GitApiError && error.status === 403) return "needs-setup";
        throw error;
      }
    },

    async enable() {
      await gitlabRequest(api, base, {
        method: "PUT",
        body: { ci_push_repository_for_job_token_allowed: true },
      }).catch(notAllowed);
      if (!(await nightlySchedule().catch(notAllowed))) {
        await gitlabRequest(api, `${base}/pipeline_schedules`, {
          method: "POST",
          body: {
            description: "Rebuild the site and install Goodfellow's fixes each night",
            ref: branch,
            cron: NIGHTLY,
            cron_timezone: "UTC",
            active: true,
          },
        }).catch(notAllowed);
      }
    },

    async lastRun(): Promise<UpdateRun | undefined> {
      const pipelines = await gitlabJson<Pipeline[]>(
        api,
        `${base}/pipelines?${new URLSearchParams({ ref: branch, per_page: "20" })}`,
      );
      for (const pipeline of pipelines) {
        if (pipeline.source !== "schedule" && pipeline.source !== "api") continue;
        const run = { date: pipeline.created_at, detailsUrl: pipeline.web_url };
        if (["created", "pending", "running", "waiting_for_resource", "preparing"].includes(pipeline.status)) {
          return { state: "running", ...run };
        }
        const jobs = await gitlabJson<Array<{ id: number; name: string }>>(
          api,
          `${base}/pipelines/${pipeline.id}/jobs?per_page=100`,
        );
        // Where Cloudflare Pages builds the site, the site's own pipeline updates in an `update` job.
        const job = jobs.find((candidate) => candidate.name === jobName || candidate.name === "update");
        if (!job) continue;
        const response = await gitlabRequest(api, `${base}/jobs/${job.id}/trace`, { allow: [403, 404] });
        const result = response.ok ? findUpdateResult(await response.text()) : undefined;
        // A pipeline started for something else, which didn't update.
        if (!result) continue;
        return { state: result.state, result, ...run };
      }
      return undefined;
    },

    async start(target) {
      await gitlabRequest(api, `${base}/pipeline`, {
        method: "POST",
        body: { ref: branch, variables: [{ key: "GOODFELLOW_UPDATE", variable_type: "env_var", value: target }] },
      }).catch(notAllowed);
    },

    nightly,

    async rebuild() {
      // A pipeline that isn't scheduled and has no update to install only builds the site.
      await gitlabRequest(api, `${base}/pipeline`, {
        method: "POST",
        body: { ref: branch, variables: [{ key: "GOODFELLOW_REBUILD", variable_type: "env_var", value: "true" }] },
      }).catch(notAllowed);
    },
  };
}

function noAccess(error: unknown): boolean {
  return error instanceof GitApiError && (error.status === 403 || error.status === 404);
}

export interface CodeUpdatesOptions {
  api: ApiOptions;
  /** The code project's path. */
  project: string;
  webUrl: string;
  /** The code project's files on a branch, read at its newest commit. */
  open: (branch: string) => Pick<GitBackend, "revision" | "readAt" | "history">;
}

/**
 * The nightly update of a site whose content is kept in a project of its own,
 * which runs in the code project's `update` job. The sign-in needs to see the
 * code project too; where it can't, `setup()` says `no-access`.
 */
export function gitlabCodeUpdates(options: CodeUpdatesOptions): SiteUpdates {
  const { api, project } = options;
  let branch: Promise<string> | undefined;
  const liveBranch = () => {
    branch ??= gitlabJson<{ default_branch: string }>(api, `/projects/${encodeURIComponent(project)}`).then(
      (found) => found.default_branch,
    );
    branch.catch(() => {
      branch = undefined;
    });
    return branch;
  };
  /** The code project at its newest commit, read again each time, since updates change it. */
  const files = async () => options.open(await liveBranch());
  /** A file as it is now: its setup files are outside the folders backends list, so they're read at the newest commit. */
  const readNow = async (path: string) => {
    const backend = await files();
    return backend.readAt(path, await backend.revision());
  };
  const updates = async () => gitlabUpdates(api, project, await liveBranch(), readNow, "update");
  const code: CodeRepository = {
    repo: project,
    webUrl: `${options.webUrl}/${project}`,
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
    async enable() {
      await (await updates()).enable?.();
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
    async rebuild() {
      await (await updates()).rebuild?.();
    },
  };
}
