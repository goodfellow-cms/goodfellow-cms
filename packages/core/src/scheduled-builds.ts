/**
 * How a site is built again when a page or entry's scheduled time comes (see
 * `content/schedule.ts`), which differs by host: GitLab builds at each time,
 * through a pipeline schedule for each, while GitHub's hourly check builds
 * within the hour after. Backends say which with `GitBackend.scheduledBuilds`.
 */

/** When a scheduled change goes live, from the site's setup. */
export type ScheduledBuildTiming =
  /** At its time: the host builds the site then, through rebuilds `sync()` keeps. */
  | "exact"
  /** Within the hour after: an hourly check builds the site once one has come due. */
  | "hourly"
  /** With the next nightly build. */
  | "nightly"
  /** Only with the site's next build, such as the next time someone publishes. */
  | "none";

export interface ScheduledBuilds {
  /** When scheduled changes go live, from the site's setup files. */
  timing(): Promise<ScheduledBuildTiming>;
  /**
   * Where `timing()` is `exact`: has the host build the site at each of these
   * times, and stops the builds it was given for times no longer listed.
   * Throws `ScheduledBuildsError` with `not-allowed` where the sign-in can't.
   */
  sync?(times: readonly Date[]): Promise<void>;
}

/** Who can read the site's repository: anyone, anyone signed in to the host (GitLab's internal), or its members. */
export type RepositoryVisibility = "public" | "internal" | "private";

export class ScheduledBuildsError extends Error {
  override name = "ScheduledBuildsError";
  constructor(
    readonly problem: "not-allowed",
    message: string,
  ) {
    super(message);
  }
}
