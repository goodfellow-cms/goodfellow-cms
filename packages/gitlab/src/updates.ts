import {
  type CodeRepository,
  DEPLOY_KEY_TITLE,
  DEPLOY_KEY_VARIABLE,
  encodeBase64,
  findUpdateResult,
  GitApiError,
  type GitBackend,
  NIGHTLY_VARIABLE,
  type NightlyBuilds,
  type NightlyMode,
  newDeployKey,
  PREPARE_JOB,
  PUBLISH_ENVIRONMENT,
  PUBLISH_MARK,
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

interface ProjectDeployKey {
  id: number;
  title: string;
  can_push?: boolean;
}

interface ProtectedBranch {
  push_access_levels?: Array<{ id?: number; access_level: number | null; deploy_key_id?: number | null }>;
}

/** GitLab's Developer role, which a branch it protects for the key lets push, as an unprotected branch does. */
const DEVELOPER = 30;

function notAllowed(error: unknown): never {
  if (error instanceof GitApiError && (error.status === 401 || error.status === 403)) {
    throw new UpdatesError("not-allowed", "Setting up updates on GitLab needs the Maintainer role in the project.");
  }
  throw error;
}

/** The variable holding the publishing key's private half, as only the publish job's environment gets it. */
function variablePath(base: string) {
  return `${base}/variables/${DEPLOY_KEY_VARIABLE}?${new URLSearchParams({ "filter[environment_scope]": PUBLISH_ENVIRONMENT })}`;
}
async function publishingKeys(api: ApiOptions, base: string): Promise<ProjectDeployKey[]> {
  const keys = await gitlabJson<ProjectDeployKey[]>(api, `${base}/deploy_keys?per_page=100`);
  return keys.filter((key) => key.title === DEPLOY_KEY_TITLE);
}

/**
 * Adds a new deploy key the publish job publishes with, lets it publish to
 * the main branch, protecting the branch for Developers where it wasn't, as
 * protected variables need, and gives its private half to the publish job's
 * environment alone. Keys added before are removed once the new one works,
 * since their private halves can't be read back, and job tokens can no
 * longer push, as only the publish job publishes. The setup page makes it for
 * a site it creates, and the Updates screen when updates are turned on.
 */
export async function addPublishingKey(api: ApiOptions, project: string, branch: string): Promise<void> {
  const base = `/projects/${encodeURIComponent(project)}`;
  const before = await publishingKeys(api, base).catch(notAllowed);
  const made = await newDeployKey(DEPLOY_KEY_TITLE);
  const added = await gitlabJson<ProjectDeployKey>(api, `${base}/deploy_keys`, {
    method: "POST",
    body: { title: DEPLOY_KEY_TITLE, key: made.publicKey, can_push: true },
  }).catch(notAllowed);
  try {
    const protectedPath = `${base}/protected_branches/${encodeURIComponent(branch)}`;
    const protection = await gitlabRequest(api, protectedPath, { allow: [404] }).catch(notAllowed);
    if (!protection.ok) {
      await gitlabRequest(api, `${base}/protected_branches`, {
        method: "POST",
        body: { name: branch, push_access_level: DEVELOPER, merge_access_level: DEVELOPER, allow_force_push: false },
      }).catch(notAllowed);
    }
    const allowed = await gitlabRequest(api, protectedPath, {
      method: "PATCH",
      body: { allowed_to_push: [{ deploy_key_id: added.id }] },
      allow: [400, 403, 404, 405, 422],
    }).catch(notAllowed);
    const after = allowed.ok ? ((await allowed.json()) as ProtectedBranch) : undefined;
    if (!after?.push_access_levels?.some((level) => level.deploy_key_id === added.id)) {
      throw new UpdatesError("publishing", "GitLab didn't let the publishing key push to the main branch.");
    }
    const variable = {
      value: encodeBase64(made.privateKey),
      masked: true,
      protected: true,
      raw: true,
      environment_scope: PUBLISH_ENVIRONMENT,
      description: "The private half of the deploy key Goodfellow's publish job publishes updates with.",
    };
    const updated = await gitlabRequest(api, variablePath(base), { method: "PUT", body: variable, allow: [404] }).catch(
      notAllowed,
    );
    if (updated.status === 404) {
      await gitlabRequest(api, `${base}/variables`, {
        method: "POST",
        body: { key: DEPLOY_KEY_VARIABLE, ...variable },
      }).catch(notAllowed);
    }
  } catch (error) {
    await gitlabRequest(api, `${base}/deploy_keys/${added.id}`, { method: "DELETE", allow: [404] }).catch(
      () => undefined,
    );
    throw error;
  }
  for (const key of before) {
    await gitlabRequest(api, `${base}/deploy_keys/${key.id}`, { method: "DELETE", allow: [404] }).catch(notAllowed);
  }
  await gitlabRequest(api, base, {
    method: "PUT",
    body: { ci_push_repository_for_job_token_allowed: false },
  }).catch(notAllowed);
}

/**
 * The site's nightly update, which runs in its prepare job on scheduled
 * pipelines, and on pipelines the Updates screen starts with `GOODFELLOW_UPDATE`.
 * Its publish job publishes it with a deploy key of its own, which `enable()`
 * adds (`gitlab-publish.ts` in core). Sites whose pipeline is from before then
 * publish from the job that made the update, with the job's own token, which
 * GitLab only allows once the project lets job tokens push.
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
      const keyed = ci?.includes(PUBLISH_MARK) ?? false;
      if (!keyed && !ci?.includes("update --publish")) return "missing";
      try {
        const found = await schedules();
        // The nightly schedule, even where it's been turned off, which the nightly build setting does.
        const scheduled = found.some(
          (schedule) =>
            (schedule.ref === branch || schedule.ref === `refs/heads/${branch}`) &&
            (schedule.active || !schedule.description?.startsWith(SCHEDULED_BUILD_DESCRIPTION)),
        );
        if (!scheduled) return "needs-setup";
        if (keyed) {
          const [keys, variable, protection] = await Promise.all([
            publishingKeys(api, base),
            gitlabRequest(api, variablePath(base), { allow: [404] }),
            gitlabRequest(api, `${base}/protected_branches/${encodeURIComponent(branch)}`, { allow: [404] }),
          ]);
          const pushing = keys.filter((key) => key.can_push);
          // Where the branch is protected, a key may push to it only where the protection names it, which making
          // the protection again (as letting editors publish does on older GitLab) can leave out.
          const levels = protection.ok ? (((await protection.json()) as ProtectedBranch).push_access_levels ?? []) : [];
          const named = !protection.ok || pushing.some((key) => levels.some((level) => level.deploy_key_id === key.id));
          return pushing.length > 0 && named && variable.ok ? "ready" : "needs-setup";
        }
        const settings = await gitlabJson<{ ci_push_repository_for_job_token_allowed?: boolean }>(api, base);
        return settings.ci_push_repository_for_job_token_allowed ? "ready" : "needs-setup";
      } catch (error) {
        // Developers can't see a project's schedules; they can still see what the last run did.
        if (error instanceof GitApiError && error.status === 403) return "needs-setup";
        throw error;
      }
    },

    async enable() {
      const keyed = (await readAt(CI_FILE))?.includes(PUBLISH_MARK) ?? false;
      if (keyed) await addPublishingKey(api, project, branch);
      else {
        await gitlabRequest(api, base, {
          method: "PUT",
          body: { ci_push_repository_for_job_token_allowed: true },
        }).catch(notAllowed);
      }
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
        // The prepare job, or, in pipelines from before it, the job named, or an `update` job where Cloudflare
        // Pages builds the site.
        const job =
          jobs.find((candidate) => candidate.name === PREPARE_JOB) ??
          jobs.find((candidate) => candidate.name === jobName || candidate.name === "update");
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
