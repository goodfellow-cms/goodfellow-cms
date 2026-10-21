import { GitApiError, type ScheduledBuilds, ScheduledBuildsError } from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";

/** The start of the description of the pipeline schedules the admin panel adds, which `sync()` keeps. */
export const SCHEDULED_BUILD_DESCRIPTION = "Goodfellow: build the site for a scheduled change at ";

/** The variable those schedules' pipelines have, which the starters' pipelines read to skip the nightly update. */
export const SCHEDULED_CHANGE_VARIABLE = "GOODFELLOW_SCHEDULED_CHANGE";

/** How many schedules are kept at once, the soonest first; later ones are added as those pass and someone publishes. */
export const MAX_SCHEDULED_BUILDS = 50;

interface Schedule {
  id: number;
  description?: string;
}

function notAllowed(error: unknown): never {
  if (error instanceof GitApiError && (error.status === 401 || error.status === 403)) {
    throw new ScheduledBuildsError(
      "not-allowed",
      "Adding pipeline schedules on GitLab needs the Developer role, with permission to merge to the main branch.",
    );
  }
  throw error;
}

/** A cron line for one instant, in UTC: it comes once a year, and `sync()` removes it once it has passed. */
function cronAt(at: Date): string {
  return `${at.getUTCMinutes()} ${at.getUTCHours()} ${at.getUTCDate()} ${at.getUTCMonth() + 1} *`;
}

/** An instant to the minute, as the schedules' descriptions and variables name it: `2026-11-29T14:00Z`. */
function minute(at: Date): string {
  return `${at.toISOString().slice(0, 16)}Z`;
}

/**
 * Scheduled changes on GitLab go live at their time: the admin panel adds a
 * pipeline schedule for each, which builds the site then. The pipeline is the
 * project's own, so any project with a `.gitlab-ci.yml` that builds the site
 * on its main branch does.
 */
export function gitlabScheduledBuilds(
  api: ApiOptions,
  project: string,
  branch: string,
  readCi: () => Promise<string | undefined>,
  now: () => Date = () => new Date(),
): ScheduledBuilds {
  const base = `/projects/${encodeURIComponent(project)}/pipeline_schedules`;
  return {
    async timing() {
      return (await readCi()) === undefined ? "none" : "exact";
    },

    async sync(times) {
      const after = now();
      const wanted = new Map<string, Date>();
      for (const at of [...times].filter((time) => time > after).sort((a, b) => a.getTime() - b.getTime())) {
        if (wanted.size >= MAX_SCHEDULED_BUILDS) break;
        wanted.set(minute(at), at);
      }
      const found = await gitlabJson<Schedule[]>(api, `${base}?per_page=100`).catch(notAllowed);
      const ours = new Map<string, Schedule>();
      for (const schedule of found) {
        if (!schedule.description?.startsWith(SCHEDULED_BUILD_DESCRIPTION)) continue;
        ours.set(schedule.description.slice(SCHEDULED_BUILD_DESCRIPTION.length), schedule);
      }
      for (const [time, schedule] of ours) {
        if (wanted.has(time)) continue;
        // Only a schedule's owner or a Maintainer can delete it; a leftover one only builds the site again.
        await gitlabRequest(api, `${base}/${schedule.id}`, { method: "DELETE", allow: [403, 404] });
      }
      for (const [time, at] of wanted) {
        if (ours.has(time)) continue;
        const created = await gitlabJson<Schedule>(api, base, {
          method: "POST",
          body: {
            description: `${SCHEDULED_BUILD_DESCRIPTION}${time}`,
            ref: branch,
            cron: cronAt(at),
            cron_timezone: "UTC",
            active: true,
          },
        }).catch(notAllowed);
        await gitlabRequest(api, `${base}/${created.id}/variables`, {
          method: "POST",
          body: { key: SCHEDULED_CHANGE_VARIABLE, value: time, variable_type: "env_var" },
        }).catch(notAllowed);
      }
    },
  };
}
