import {
  BITBUCKET_PIPELINE_NAMES,
  bitbucketCronAt,
  bitbucketCronInstant,
  GitApiError,
  type ScheduledBuilds,
  ScheduledBuildsError,
} from "@goodfellow-cms/core";
import { type ApiOptions, bitbucketJson, bitbucketRequest } from "./api.js";
import { type Schedule, schedules } from "./pipelines.js";

/** How many schedules are kept at once, the soonest first; later ones are added as those pass and someone publishes. */
export const MAX_SCHEDULED_BUILDS = 50;

/** The step name the `scheduled` pipeline has in `bitbucketPipelines()`, which says the setup runs it. */
const SCHEDULED_STEP = "name: Scheduled change";

function isNotAllowed(error: unknown): boolean {
  return error instanceof GitApiError && (error.status === 401 || error.status === 403);
}

function notAllowed(error: unknown): never {
  if (isNotAllowed(error)) {
    throw new ScheduledBuildsError(
      "not-allowed",
      "Adding Pipelines schedules on Bitbucket needs permission to change the repository's Pipelines settings.",
    );
  }
  throw error;
}

/** An instant to the minute, which tells the schedules apart. */
function minute(at: Date): string {
  return at.toISOString().slice(0, 16);
}

/**
 * Scheduled changes on Bitbucket go live at their time: the admin panel adds a
 * schedule for each, pinned to its minute and year, that runs the `scheduled`
 * custom pipeline, which only asks Vercel to rebuild the site. Bitbucket has
 * no schedules that run once, so `sync()` removes them once they've passed.
 * Schedules carry no variables or names, so the admin panel's are the ones
 * that run that pipeline, and their time is read back from their patterns.
 * Changing schedules may need more than an editor's permission, so it uses
 * the owner token where there is one, and the sign-in otherwise.
 */
export function bitbucketScheduledBuilds(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  branch: string,
  readSetup: () => Promise<string | undefined>,
  now: () => Date = () => new Date(),
): ScheduledBuilds {
  const { scheduled } = BITBUCKET_PIPELINE_NAMES;
  const base = `/repositories/${repo}/pipelines_config/schedules`;
  return {
    async timing() {
      const setup = await readSetup().catch(() => undefined);
      if (setup?.includes(SCHEDULED_STEP)) return "exact";
      // Sites without the scheduled pipeline get their changes with the nightly update's rebuild, where it runs.
      return setup?.includes(" nightly ") ? "nightly" : "none";
    },

    async sync(times) {
      const api = manage() ?? read;
      const after = now();
      const wanted = new Map<string, Date>();
      for (const at of [...times].filter((time) => time > after).sort((a, b) => a.getTime() - b.getTime())) {
        if (wanted.size >= MAX_SCHEDULED_BUILDS) break;
        wanted.set(minute(at), at);
      }
      const ours = new Map<string, Schedule>();
      for (const schedule of await schedules(api, repo).catch(notAllowed)) {
        if (schedule.target?.selector?.pattern !== scheduled) continue;
        const at = bitbucketCronInstant(schedule.cron_pattern);
        if (at) ours.set(minute(at), schedule);
      }
      for (const [time, schedule] of ours) {
        if (wanted.has(time)) continue;
        // A leftover schedule only rebuilds the site again, so one that can't be removed is left.
        await bitbucketRequest(api, `${base}/${encodeURIComponent(schedule.uuid)}`, {
          method: "DELETE",
          allow: [403, 404],
        });
      }
      for (const [time, at] of wanted) {
        if (ours.has(time)) continue;
        await bitbucketJson(api, base, {
          body: {
            type: "pipeline_schedule",
            enabled: true,
            cron_pattern: bitbucketCronAt(at),
            target: {
              type: "pipeline_ref_target",
              ref_type: "branch",
              ref_name: branch,
              selector: { type: "custom", pattern: scheduled },
            },
          },
        }).catch(notAllowed);
      }
    },
  };
}
