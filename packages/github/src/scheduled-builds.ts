import type { ScheduledBuilds, ScheduledBuildTiming } from "@goodfellow-cms/core";

/** The starters' hourly check, which builds the site once a scheduled change has come due. */
export const SCHEDULED_WORKFLOW = ".github/workflows/scheduled.yml";

/** Workflows that build the site, or ask another host to, each night. */
const NIGHTLY_WORKFLOWS = [".github/workflows/deploy.yml", ".github/workflows/rebuild.yml"];

/**
 * Scheduled changes on GitHub go live within the hour after their time, with
 * the starters' hourly check (`scheduled.yml`), which builds the site only
 * once one has come due. Sites set up without it get them with the nightly
 * build.
 */
export function githubScheduledBuilds(read: (path: string) => Promise<string | undefined>): ScheduledBuilds {
  return {
    async timing(): Promise<ScheduledBuildTiming> {
      const [scheduled, ...nightly] = await Promise.all([SCHEDULED_WORKFLOW, ...NIGHTLY_WORKFLOWS].map(read));
      if (scheduled && /\bdue\b/.test(scheduled) && /\bschedule:/.test(scheduled)) return "hourly";
      if (nightly.some((workflow) => workflow && /\bschedule:/.test(workflow))) return "nightly";
      return "none";
    },
  };
}
