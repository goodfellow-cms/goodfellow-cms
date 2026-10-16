/**
 * Updating a site to newer Goodfellow releases: which release to update to,
 * the line `goodfellow update` prints about what it did, and what a backend's
 * optional `updates` capability does with the site's nightly update job.
 */

import type { BuildCause } from "./build-problems.js";
import { ContentError } from "./content/errors.js";
import { parseContentFile } from "./content/load.js";
import { UPDATES_FILE } from "./content/paths.js";
import { type UpdateSettings, updateSettingsSchema } from "./content/schemas.js";
import { serializeContent } from "./content/serialize.js";
import type { FileVersion, HistoryOptions } from "./git.js";
import { CURRENT_VERSION } from "./migrations/index.js";

/** npm's registry, which answers browsers too. */
export const NPM_REGISTRY = "https://registry.npmjs.org";

/** The package whose version is the site's Goodfellow version: every Goodfellow package has the same one. */
export const VERSION_PACKAGE = "@goodfellow-cms/react";

type Parts = [number, number, number];

/** A release's version, such as `0.4.2`, from a version or a range such as `^0.4.2`; pre-releases don't count. */
function parse(version: string): Parts | undefined {
  const match = /^[\^~=v]*(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function compare(a: Parts, b: Parts): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Negative when release `a` is older than `b`, positive when it's newer, and 0 when they're the same or either isn't a release. */
export function compareReleases(a: string, b: string): number {
  const first = parse(a);
  const second = parse(b);
  return first && second ? compare(first, second) : 0;
}

/** A release version without a range's `^` or `~`, or `undefined` if it isn't one. */
export function releaseVersion(version: string): string | undefined {
  const parts = parse(version);
  return parts?.join(".");
}

/** The releases of a package, oldest first, from npm's metadata for it. */
export function releaseVersions(metadata: unknown): string[] {
  const versions = Object.keys((metadata as { versions?: Record<string, unknown> } | null)?.versions ?? {});
  return versions
    .flatMap((version) => {
      const parts = parse(version);
      return parts ? [{ version, parts }] : [];
    })
    .sort((a, b) => compare(a.parts, b.parts))
    .map(({ version }) => version);
}

/** What a site can update to: the newest fixes for its release, and the newest release, if they're newer. */
export interface AvailableUpdates {
  /** The newest release with the same major and minor version, which installs on its own each night. */
  fixes?: string;
  /** The newest release, when it's a newer minor or major release, which an owner chooses to install. */
  newer?: string;
}

/** Releases in `skip`, such as one the site went back from, are left out. */
export function availableUpdates(
  current: string,
  versions: readonly string[],
  skip: readonly string[] = [],
): AvailableUpdates {
  const now = parse(current);
  if (!now) return {};
  let fixes: Parts | undefined;
  let newer: Parts | undefined;
  for (const version of versions) {
    const parts = parse(version);
    if (!parts || compare(parts, now) <= 0 || skip.includes(parts.join("."))) continue;
    if (parts[0] === now[0] && parts[1] === now[1]) {
      if (!fixes || compare(parts, fixes) > 0) fixes = parts;
    } else if (!newer || compare(parts, newer) > 0) {
      newer = parts;
    }
  }
  return { ...(fixes && { fixes: fixes.join(".") }), ...(newer && { newer: newer.join(".") }) };
}

/**
 * The release to update to: `fixes` for the newest release with the same
 * major and minor version, `latest` for the newest of all, leaving out the
 * releases in `skip`, or a release itself, which may be older to go back to
 * it. `undefined` when there's nothing to install.
 */
export function chooseUpdate(
  current: string,
  versions: readonly string[],
  target: string,
  skip: readonly string[] = [],
): string | undefined {
  const available = availableUpdates(current, versions, skip);
  if (target === "fixes") return available.fixes;
  if (target === "latest") return available.newer ?? available.fixes;
  const wanted = releaseVersion(target);
  return wanted && versions.includes(wanted) && compareReleases(wanted, current) !== 0 ? wanted : undefined;
}

/** A site that has no `content/updates.json` installs fixes on its own and skips nothing. */
export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = { version: 1, automatic: true, skip: [] };

/** The site's update settings from `content/updates.json`'s text, or the defaults when it has none. Throws a `ContentError` if it can't be used. */
export function parseUpdateSettings(text: string | undefined): UpdateSettings {
  if (text === undefined) return DEFAULT_UPDATE_SETTINGS;
  const result = parseContentFile("updates", updateSettingsSchema, UPDATES_FILE, text);
  if (!result.ok) throw new ContentError([result.problem]);
  return result.value;
}

/** `content/updates.json`'s text for these settings, with the skipped releases oldest first. */
export function updateSettingsFile(settings: Pick<UpdateSettings, "automatic" | "skip">): string {
  const skip = [...new Set(settings.skip)].sort(compareReleases);
  return serializeContent({ version: CURRENT_VERSION.updates, automatic: settings.automatic, skip });
}

/** The site's Goodfellow version, from its `package.json`. */
export function siteVersion(packageJson: string): string | undefined {
  try {
    const { dependencies = {}, devDependencies = {} } = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const range = dependencies[VERSION_PACKAGE] ?? devDependencies[VERSION_PACKAGE];
    return range ? releaseVersion(range) : undefined;
  } catch {
    return undefined;
  }
}

/** What `goodfellow update` did. */
export interface UpdateResult {
  /** Nothing newer; updated and published; or not published, because the site didn't build or install with it. */
  state: "up-to-date" | "updated" | "failed";
  from: string;
  to?: string;
  /** For a failed update, the step that failed. */
  step?: "install" | "build" | "blocks" | "publish";
  /** What the build said, when building the site with the update failed. */
  cause?: BuildCause;
  /** Installed blocks' files someone changed, which the update left as they were. */
  kept?: string[];
  /** For an automatic update that didn't run, because the site's settings turn them off. */
  paused?: boolean;
  /** When `to` is older: the site went back to it, and `from` is now skipped. */
  rollback?: boolean;
}

/** Starts the line `goodfellow update` prints about what it did. */
export const UPDATE_RESULT_MARKER = "goodfellow-update ";

export function formatUpdateResult(result: UpdateResult): string {
  return `${UPDATE_RESULT_MARKER}${JSON.stringify(result)}`;
}

/** The last result `goodfellow update` printed in a log, if any. */
export function findUpdateResult(log: string): UpdateResult | undefined {
  const lines = log.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index] ?? "";
    const at = line.indexOf(UPDATE_RESULT_MARKER);
    if (at === -1) continue;
    try {
      const found = JSON.parse(line.slice(at + UPDATE_RESULT_MARKER.length).trim()) as UpdateResult;
      if (["up-to-date", "updated", "failed"].includes(found.state) && typeof found.from === "string") return found;
    } catch {
      // Not a line goodfellow update wrote; keep looking.
    }
  }
  return undefined;
}

/** The site's last run of its update job. */
export interface UpdateRun {
  /** Still running; or what it did, where the host says; `unknown` when it finished without saying. */
  state: "running" | "unknown" | UpdateResult["state"];
  /** When it started, as an ISO 8601 date. */
  date?: string;
  result?: UpdateResult;
  /** Where to see it on the host. */
  detailsUrl?: string;
}

/**
 * Whether the site's update job can run: `ready`; `needs-setup` when the host
 * still needs something turned on, which `enable()` does; `missing` when the
 * site's build setup has no update job, such as older sites or sites on Vercel;
 * `no-access` when the job is in the site's code repository (`SiteUpdates.code`)
 * and the sign-in can't see it.
 */
export type UpdatesSetup = "ready" | "needs-setup" | "missing" | "no-access";

/**
 * The repository a site's code is kept in, where its content is in a
 * repository of its own: its update job runs there, and its `package.json`
 * says which release the site uses.
 */
export interface CodeRepository {
  /** `owner/name`, or the GitLab project's full path. */
  repo: string;
  /** Where to see it on the host. */
  webUrl: string;
  /** A file as it is now. */
  read(path: string): Promise<string | undefined>;
  history(path: string, options?: HistoryOptions): Promise<FileVersion[]>;
  readAt(path: string, revision: string): Promise<string | undefined>;
}

/** A git host's runs of the site's nightly update job. */
export interface SiteUpdates {
  /** Where the job runs in the site's code repository, not the repository the admin panel edits. */
  code?: CodeRepository;
  setup(): Promise<UpdatesSetup>;
  /** Turns on what the host needs, such as letting the job publish and running it each night. */
  enable?(): Promise<void>;
  lastRun(): Promise<UpdateRun | undefined>;
  /** Runs the update job now: `fixes` for the newest fixes, or a release, such as a newer one an owner chose or an older one to go back to. */
  start(target: string): Promise<void>;
}

/** Why the update job couldn't be run or set up, in a form the admin panel turns into plain words. */
export type UpdatesProblem =
  /** The sign-in, or the owner token, can't run it or change the host's settings. */
  | "not-allowed"
  /** The site's build setup has no update job. */
  | "missing";

export class UpdatesError extends Error {
  override name = "UpdatesError";
  constructor(
    readonly problem: UpdatesProblem,
    message: string,
  ) {
    super(message);
  }
}
