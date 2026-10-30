/**
 * The hourly check in sites' GitHub Actions setup (`goodfellow due`,
 * `goodfellow-next due`): whether a change the site's schedules make has come
 * due since the last check, or the time the live site's build record says it
 * stops being current, so the site needs building again. Builds are skipped
 * when nothing has, so checking costs little.
 */
import { appendFile } from "node:fs/promises";
import { dueChanges, loadSiteContent, type ScheduledChange, upcomingChanges } from "./index.js";
import { builtSiteSource } from "./node-fs-source.js";
import { liveRecord } from "./node-nightly.js";

const HOUR = 60 * 60 * 1000;

export interface DueOptions {
  /** The site's folder. Defaults to the current folder. */
  root?: string;
  /**
   * When the last check that worked started, as an ISO time, such as the
   * previous scheduled run's. Without one, or with one that isn't a time,
   * when the live site was built (its build record's `builtAt`), else the
   * last hour.
   */
  since?: string;
  now?: Date;
  /** For tests: reads the live site's build record. */
  fetch?: typeof fetch;
  /** Where a copy of the site's address comes from (`GOODFELLOW_SITE_URL`). Defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

export interface DueResult {
  /** The changes that came due since then. */
  due: ScheduledChange[];
  since: Date;
  /** The next change still to come. */
  next?: ScheduledChange;
  /** The site's time zone, which the changes' times are in. */
  timeZone?: string;
  /**
   * When the live site stopped being current, by its build record, if that came
   * since then: something it shows by today's date, such as an event, changed.
   */
  dated?: string;
}

/** Which of the site's scheduled changes came due since the last check, and the next one. */
export async function scheduleDue(options: DueOptions = {}): Promise<DueResult> {
  const now = options.now ?? new Date();
  // As the site is built, so a copy, such as staging, reads its own build record, not the main site's.
  const content = await loadSiteContent(builtSiteSource(options.root ?? ".", options.env ?? process.env));
  const record = await liveRecord(content.settings.url, options.fetch ?? fetch);
  const time = (text: string | undefined) => {
    const date = text ? new Date(text) : undefined;
    return date && !Number.isNaN(date.getTime()) && date < now ? date : undefined;
  };
  // Without a last check, such as the first, since the live site was built, else the last hour.
  const since = time(options.since) ?? time(record?.builtAt) ?? new Date(now.getTime() - HOUR);
  const [next] = upcomingChanges(content, now);
  // Only once, the first check after, so a build that fails isn't tried again every hour.
  const until = record?.currentUntil;
  const dated = until && new Date(until) > since && new Date(until) <= now ? until : undefined;
  return {
    due: dueChanges(content, since, now),
    since,
    ...(next && { next }),
    ...(content.settings.timeZone && { timeZone: content.settings.timeZone }),
    ...(dated && { dated }),
  };
}

function describe(change: ScheduledChange): string {
  const where = change.path ? ` (${change.path})` : "";
  return `${change.kind === "show" ? "show" : "hide"} "${change.title}"${where} at ${change.time}`;
}

/**
 * What the check found, for the log, and `due=true` or `due=false` added to
 * `output`: on GitHub Actions the step's outputs, which the build job's
 * condition reads, or a file a Bitbucket pipeline reads in.
 */
export async function reportDue(
  result: DueResult,
  env: NodeJS.ProcessEnv = process.env,
  output: string | undefined = env.GITHUB_OUTPUT,
): Promise<string[]> {
  const zone = result.timeZone ?? "UTC";
  const due = result.due.length > 0 || result.dated !== undefined;
  const lines =
    result.due.length > 0
      ? [
          `Scheduled changes came due since ${result.since.toISOString()}, so the site is built again:`,
          ...result.due.map((change) => `  ${describe(change)} (${zone})`),
        ]
      : result.dated
        ? [`What the live site shows by today's date changed at ${result.dated}, so the site is built again.`]
        : [`No scheduled change came due since ${result.since.toISOString()}, so the site isn't built again.`];
  if (result.next) lines.push(`Next scheduled change: ${describe(result.next)} (${zone})`);
  if (output) await appendFile(output, `due=${due}\n`);
  return lines;
}
