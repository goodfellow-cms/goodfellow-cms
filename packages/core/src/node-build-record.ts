/**
 * Writing the build record (`build-record.ts`) beside a built site: what it
 * was built from, read from git, and when it stops being current, from the
 * dates the site's blocks reported while it was rendered (`changesOn()`) and
 * the site's next scheduled change.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BUILD_RECORD_PATH,
  type BuildRecord,
  nextDateChange,
  onDateChange,
  serializeBuildRecord,
} from "./build-record.js";
import { zonedInstant } from "./calendar.js";
import type { SiteContent } from "./content/load.js";
import { CONTENT_REPOSITORY_DIR } from "./content/paths.js";
import { upcomingChanges } from "./content/schedule.js";
import { GOODFELLOW_VERSION } from "./site-description.js";

const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The commit checked out in a folder, or `undefined` where it isn't in a git repository. */
export function gitCommit(folder: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: folder, encoding: "utf8" });
  const commit = result.status === 0 ? result.stdout.trim() : "";
  return COMMIT.test(commit) ? commit : undefined;
}

/** The commit hosts that build without a git folder, such as Vercel, say they're building. */
function hostCommit(env: NodeJS.ProcessEnv): string | undefined {
  const commit = env.VERCEL_GIT_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || env.CI_COMMIT_SHA || env.GITHUB_SHA;
  return commit && COMMIT.test(commit) ? commit : undefined;
}

/** What the site in `root` was built from: its commit, and its content repository's, where it has one in its folder. */
export function builtFrom(root: string, env: NodeJS.ProcessEnv = process.env): Pick<BuildRecord, "commit" | "content"> {
  const commit = gitCommit(root) ?? hostCommit(env);
  const contentFolder = join(root, CONTENT_REPOSITORY_DIR);
  const content = existsSync(join(contentFolder, ".git")) ? gitCommit(contentFolder) : undefined;
  return { ...(commit && { commit }), ...(content && content !== commit && { content }) };
}

/**
 * When the site built from `content` (as loaded, schedules and all) at `now`
 * stops being current: the earliest date its blocks reported, at midnight in
 * the site's time zone, or its next scheduled change, whichever comes first.
 */
export function currentUntil(content: SiteContent, now: Date, date = nextDateChange()): Date | undefined {
  const timeZone = content.settings.timeZone;
  const dated = date ? zonedInstant(`${date}T00:00`, timeZone) : undefined;
  const [scheduled] = upcomingChanges(content, now);
  const times = [dated, scheduled?.at].filter((time): time is Date => time !== undefined);
  return times.length > 0 ? new Date(Math.min(...times.map((time) => time.getTime()))) : undefined;
}

export interface WriteBuildRecordOptions {
  /** The site's folder, whose commit it was built from. */
  root: string;
  /** The site as loaded, schedules and all. */
  content: SiteContent;
  /** When the build looked at the site. */
  now: Date;
  /** The earliest date the site's blocks reported, where the build collected them some other way. */
  date?: string;
  env?: NodeJS.ProcessEnv;
}

/** Writes `goodfellow-build.json` into a built site's folder, and returns it. */
export async function writeBuildRecord(outDir: string, options: WriteBuildRecordOptions): Promise<BuildRecord> {
  const until = currentUntil(options.content, options.now, options.date ?? nextDateChange());
  const record: BuildRecord = {
    version: 1,
    goodfellow: GOODFELLOW_VERSION,
    ...builtFrom(options.root, options.env),
    builtAt: options.now.toISOString(),
    ...(until && { currentUntil: until.toISOString() }),
  };
  await writeFile(join(outDir, BUILD_RECORD_PATH), serializeBuildRecord(record));
  return record;
}

// Builds that render pages in several processes -------------------------------

/**
 * Names the folder where each process rendering a site's pages writes the
 * earliest date they reported, for builds that render pages in several, such
 * as `next build`, where `withGoodfellow()` sets it.
 */
export const BUILD_DATES_ENV = "GOODFELLOW_BUILD_DATES";

/** The folder, in a build's own folder such as Next.js's `.next/`, that `withGoodfellow()` names. */
export const BUILD_DATES_DIR = "goodfellow-dates";

/** Has this process write each new earliest date its pages report into `folder`, in a file of its own. */
export function reportDatesTo(folder: string): () => void {
  return onDateChange((date) => {
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${process.pid}.txt`), date);
    } catch {
      // Without it, the build record just says the site stays current.
    }
  });
}

/** The earliest date the processes that rendered a site's pages wrote into `folder` (`reportDatesTo()`). */
export async function reportedDate(folder: string): Promise<string | undefined> {
  const files = await readdir(folder).catch(() => []);
  const dates = await Promise.all(
    files.filter((file) => file.endsWith(".txt")).map((file) => readFile(join(folder, file), "utf8").catch(() => "")),
  );
  return dates
    .map((date) => date.trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()[0];
}
