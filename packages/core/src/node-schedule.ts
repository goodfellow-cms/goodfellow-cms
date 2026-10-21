/**
 * The hourly check in sites' GitHub Actions setup (`goodfellow due`,
 * `goodfellow-next due`): whether a change the site's schedules make has come
 * due since the last check, so the site needs building again. Builds are
 * skipped when nothing has, so checking costs little.
 */
import { appendFile } from "node:fs/promises";
import { dueChanges, loadSiteContent, type ScheduledChange, upcomingChanges } from "./index.js";
import { fileSystemSource } from "./node-fs-source.js";

const HOUR = 60 * 60 * 1000;

export interface DueOptions {
  /** The site's folder. Defaults to the current folder. */
  root?: string;
  /**
   * When the last check that worked started, as an ISO time, such as the
   * previous scheduled run's. Without one, or with one that isn't a time,
   * the last hour.
   */
  since?: string;
  now?: Date;
}

export interface DueResult {
  /** The changes that came due since then. */
  due: ScheduledChange[];
  since: Date;
  /** The next change still to come. */
  next?: ScheduledChange;
  /** The site's time zone, which the changes' times are in. */
  timeZone?: string;
}

/** Which of the site's scheduled changes came due since the last check, and the next one. */
export async function scheduleDue(options: DueOptions = {}): Promise<DueResult> {
  const now = options.now ?? new Date();
  const given = options.since ? new Date(options.since) : undefined;
  const since = given && !Number.isNaN(given.getTime()) && given < now ? given : new Date(now.getTime() - HOUR);
  const content = await loadSiteContent(fileSystemSource(options.root ?? "."));
  const [next] = upcomingChanges(content, now);
  return {
    due: dueChanges(content, since, now),
    since,
    ...(next && { next }),
    ...(content.settings.timeZone && { timeZone: content.settings.timeZone }),
  };
}

function describe(change: ScheduledChange): string {
  const where = change.path ? ` (${change.path})` : "";
  return `${change.kind === "show" ? "show" : "hide"} "${change.title}"${where} at ${change.time}`;
}

/**
 * What the check found, for the log, and on GitHub Actions `due=true` or
 * `due=false` in the step's outputs, which the build job's condition reads.
 */
export async function reportDue(result: DueResult, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const zone = result.timeZone ?? "UTC";
  const lines =
    result.due.length > 0
      ? [
          `Scheduled changes came due since ${result.since.toISOString()}, so the site is built again:`,
          ...result.due.map((change) => `  ${describe(change)} (${zone})`),
        ]
      : [`No scheduled change came due since ${result.since.toISOString()}, so the site isn't built again.`];
  if (result.next) lines.push(`Next scheduled change: ${describe(result.next)} (${zone})`);
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `due=${result.due.length > 0}\n`);
  return lines;
}
