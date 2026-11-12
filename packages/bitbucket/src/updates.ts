import {
  BITBUCKET_PIPELINE_NAMES,
  BITBUCKET_SCHEDULES,
  findUpdateResult,
  GitApiError,
  NIGHTLY_VARIABLE,
  type NightlyBuilds,
  type NightlyMode,
  PUBLISH_PATCH,
  SignInError,
  type SiteUpdates,
  setupSection,
  type UpdateRun,
  UpdatesError,
} from "@goodfellow-cms/core";
import { type ApiOptions, allPages, bitbucketJson, bitbucketRequest, type Paged } from "./api.js";
import { type Pipeline, pipelineUrl, runPipeline, type Schedule, scheduleFor, schedules } from "./pipelines.js";
import { BITBUCKET_WEB } from "./web.js";

interface Variable {
  uuid: string;
  key: string;
  value?: string;
}

/**
 * Whether the update pipeline publishes the updates it makes: itself, with `--publish`, or, with `--commit`, through
 * a step after it in the same pipeline that applies the commit (`PUBLISH_PATCH`), since the update's commit is
 * otherwise thrown away. The lockfile's publish step applies the same file, so only the update pipeline counts.
 */
function publishesUpdates(setup: string): boolean {
  const pipeline = setupSection(setup, BITBUCKET_PIPELINE_NAMES.update);
  if (/update --publish\b/.test(pipeline)) return true;
  const commit = pipeline.search(/update --commit\b/);
  return commit >= 0 && pipeline.indexOf(`am ${PUBLISH_PATCH}`, commit) >= 0;
}

function notAllowed(error: unknown): never {
  if (
    error instanceof SignInError ||
    (error instanceof GitApiError && (error.status === 403 || error.status === 404))
  ) {
    throw new UpdatesError(
      "not-allowed",
      "Setting up updates on Bitbucket needs the repository's Admin permission: use an owner token.",
    );
  }
  throw error;
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof GitApiError && (error.status === 403 || error.status === 404);
}

/**
 * The site's nightly update, which runs in the `update` custom pipeline of
 * its `bitbucket-pipelines.yml`, on the schedule `enable()` adds, and when the
 * Updates screen starts it with `GOODFELLOW_UPDATE` or `GOODFELLOW_REBUILD`.
 * Pipelines can publish to the repository themselves, so nothing else needs
 * turning on but Pipelines and the nightly schedule, which need Admin.
 */
export function bitbucketUpdates(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  branch: string,
  readSetup: () => Promise<string | undefined>,
): SiteUpdates {
  const { update } = BITBUCKET_PIPELINE_NAMES;
  const config = `/repositories/${repo}/pipelines_config`;
  const api = () => manage() ?? read;

  async function nightlySchedule(): Promise<Schedule | undefined> {
    return scheduleFor(await schedules(api(), repo), update);
  }

  async function variables(): Promise<Variable[]> {
    return allPages<Variable>(api(), `${config}/variables?pagelen=100`, 5);
  }

  /**
   * The nightly build setting: "never" turns the nightly schedule off, and
   * "every night" sets the repository variable `GOODFELLOW_NIGHTLY`, which the
   * update pipeline's nightly check reads.
   */
  const nightly: NightlyBuilds = {
    async supported() {
      return (await readSetup())?.includes(" nightly ") ?? false;
    },
    async get() {
      try {
        const found = await nightlySchedule();
        if (!found) return undefined;
        if (!found.enabled) return "off";
        const variable = (await variables()).find((candidate) => candidate.key === NIGHTLY_VARIABLE);
        return variable?.value === "always" ? "always" : "changed";
      } catch (error) {
        if (isNotAllowed(error)) return undefined;
        throw error;
      }
    },
    async set(mode: NightlyMode) {
      const found = await nightlySchedule().catch(notAllowed);
      if (!found) throw new UpdatesError("missing", "The site has no nightly schedule yet: turn on updates first.");
      await bitbucketRequest(api(), `${config}/schedules/${encodeURIComponent(found.uuid)}`, {
        method: "PUT",
        body: { enabled: mode !== "off" },
      }).catch(notAllowed);
      const variable = (await variables().catch(notAllowed)).find((candidate) => candidate.key === NIGHTLY_VARIABLE);
      if (mode === "always" && variable) {
        await bitbucketRequest(api(), `${config}/variables/${encodeURIComponent(variable.uuid)}`, {
          method: "PUT",
          body: { key: NIGHTLY_VARIABLE, value: "always", secured: false },
        }).catch(notAllowed);
      } else if (mode === "always") {
        await bitbucketRequest(api(), `${config}/variables`, {
          body: { key: NIGHTLY_VARIABLE, value: "always", secured: false },
        }).catch(notAllowed);
      } else if (variable) {
        await bitbucketRequest(api(), `${config}/variables/${encodeURIComponent(variable.uuid)}`, {
          method: "DELETE",
          allow: [404],
        }).catch(notAllowed);
      }
    },
  };

  return {
    async setup() {
      const setup = await readSetup();
      if (!publishesUpdates(setup ?? "")) return "missing";
      try {
        const [settings, found] = await Promise.all([
          bitbucketJson<{ enabled?: boolean }>(api(), config),
          schedules(api(), repo),
        ]);
        const ready = settings.enabled && scheduleFor(found, update);
        return ready ? "ready" : "needs-setup";
      } catch (error) {
        // Without Admin, Pipelines' settings can't be seen; what the last run did still can.
        if (isNotAllowed(error)) return "needs-setup";
        throw error;
      }
    },

    async enable() {
      const settings = await bitbucketJson<{ enabled?: boolean }>(api(), config).catch(notAllowed);
      if (!settings.enabled) {
        await bitbucketRequest(api(), config, { method: "PUT", body: { enabled: true } }).catch(notAllowed);
      }
      // Scheduled changes get schedules of their own, which the backend's scheduledBuilds keeps.
      if (scheduleFor(await schedules(api(), repo).catch(notAllowed), update)) return;
      await bitbucketRequest(api(), `${config}/schedules`, {
        body: {
          type: "pipeline_schedule",
          enabled: true,
          cron_pattern: BITBUCKET_SCHEDULES.update,
          target: {
            type: "pipeline_ref_target",
            ref_type: "branch",
            ref_name: branch,
            selector: { type: "custom", pattern: update },
          },
        },
      }).catch(notAllowed);
    },

    async lastRun(): Promise<UpdateRun | undefined> {
      const query = new URLSearchParams({
        "target.selector.pattern": update,
        sort: "-created_on",
        pagelen: "10",
      });
      const pipelines = await bitbucketJson<Paged<Pipeline>>(read, `/repositories/${repo}/pipelines/?${query}`);
      for (const pipeline of pipelines.values) {
        const run = { date: pipeline.created_on, detailsUrl: pipelineUrl(BITBUCKET_WEB, repo, pipeline) };
        if (pipeline.state?.name !== "COMPLETED") return { state: "running", ...run };
        const path = `/repositories/${repo}/pipelines/${encodeURIComponent(pipeline.uuid)}/steps`;
        const [step] = (await bitbucketJson<Paged<{ uuid: string }>>(read, path)).values;
        if (!step) continue;
        let log: string;
        try {
          const response = await bitbucketRequest(read, `${path}/${encodeURIComponent(step.uuid)}/log`, {
            allow: [404],
          });
          log = response.ok ? await response.text() : "";
        } catch (error) {
          // A finished step's log is moved to storage the browser may not be allowed to read.
          if (error instanceof SignInError) throw error;
          return { state: "unknown", ...run };
        }
        const result = findUpdateResult(log);
        // A pipeline started for something else, such as a rebuild, which didn't update.
        if (!result) continue;
        if (result.state === "updated") {
          // The first step only made the update; the step after it publishes it, so the pipeline's result says
          // whether it was.
          const outcome = pipeline.state?.result?.name;
          if (!outcome) return { state: "unknown", ...run };
          if (outcome !== "SUCCESSFUL") return { state: "failed", ...run };
        }
        return { state: result.state, result, ...run };
      }
      return undefined;
    },

    async start(target) {
      await runPipeline(api(), repo, branch, update, { GOODFELLOW_UPDATE: target }).catch(notAllowed);
    },

    nightly,

    async rebuild() {
      // Without an update to install, the update pipeline only asks the host to rebuild the site.
      await runPipeline(api(), repo, branch, update, { GOODFELLOW_REBUILD: "true" }).catch(notAllowed);
    },
  };
}
