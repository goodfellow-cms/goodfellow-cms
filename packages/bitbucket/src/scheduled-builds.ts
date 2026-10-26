import { BITBUCKET_PIPELINE_NAMES, GitApiError, type ScheduledBuilds } from "@goodfellow-cms/core";
import type { ApiOptions } from "./api.js";
import { scheduleFor, schedules } from "./pipelines.js";

/**
 * Scheduled changes on Bitbucket go live with the nightly update's rebuild,
 * or within the hour where the repository has a schedule running the
 * `scheduled` custom pipeline each hour, which asks the host to rebuild the
 * site once one has come due, as GitHub's hourly workflow does. That uses
 * about 720 build minutes a month, more than Bitbucket's free plan has, so
 * owners add it themselves.
 */
export function bitbucketScheduledBuilds(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  readSetup: () => Promise<string | undefined>,
): ScheduledBuilds {
  const { update, scheduled } = BITBUCKET_PIPELINE_NAMES;
  return {
    async timing() {
      const setup = await readSetup().catch(() => undefined);
      if (!setup) return "none";
      const hourly = setup.includes(` due `);
      try {
        const found = await schedules(manage() ?? read, repo);
        if (hourly && scheduleFor(found, scheduled)?.enabled) return "hourly";
        return scheduleFor(found, update)?.enabled ? "nightly" : "none";
      } catch (error) {
        // Only Admins can see the schedules: the setup says what they'd run.
        if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
          return hourly ? "hourly" : "nightly";
        }
        throw error;
      }
    },
  };
}
