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

/**
 * npm overrides every site's `package.json` has, by the package whose own
 * dependency they replace, as Goodfellow's workspace has them
 * (`pnpm-workspace.yaml`): releases that fix security advisories, for
 * packages Goodfellow's dependencies ask for older ones of. Puck renders rich
 * text on the server with `@tiptap/html`, which asks for happy-dom 20; 21.0.4
 * and later fix GHSA-834v-8h66-3h79 and GHSA-c8p4-j97h-3vg8. Sigstore, which
 * checks plugins' early updates, brings cacache, which asks for glob 13 (14.0.2
 * fixes GHSA-3g3m-2fjr-6pw4), and `@tufjs/models`, which asks for minimatch 10
 * (11.0.1 fixes GHSA-g3hv-75wg-m249).
 */
export const SITE_OVERRIDES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "@puckeditor/core": { "happy-dom": "^21.0.4" },
  cacache: { glob: "^14.0.2" },
  "@tufjs/models": { minimatch: "^11.0.1" },
};

/**
 * A site's `package.json` overrides with `SITE_OVERRIDES` in them, keeping
 * every override of the site's own, and the packages it added overrides for,
 * as `[package, dependency]`.
 */
export function withSiteOverrides(overrides: unknown): {
  overrides: Record<string, unknown>;
  added: [string, string][];
} {
  const result: Record<string, unknown> =
    typeof overrides === "object" && overrides !== null && !Array.isArray(overrides) ? { ...overrides } : {};
  const added: [string, string][] = [];
  for (const [name, children] of Object.entries(SITE_OVERRIDES)) {
    const own = result[name];
    // A site that overrides the package itself, as `"@puckeditor/core": "1.2.3"`, chose its own.
    if (own !== undefined && (typeof own !== "object" || own === null || Array.isArray(own))) continue;
    const merged: Record<string, unknown> = { ...(own as Record<string, unknown> | undefined) };
    for (const [child, range] of Object.entries(children)) {
      if (merged[child] !== undefined) continue;
      merged[child] = range;
      added.push([name, child]);
    }
    result[name] = merged;
  }
  return { overrides: result, added };
}

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

type Test = (version: Parts) => boolean;

/** A version with parts left out or written `x` or `*`, such as `1.2` or `1.x`, as the parts given; `undefined` if it isn't one. */
function partial(text: string): number[] | undefined {
  if (text === "" || text === "*") return [];
  const parts = text.replace(/^v/, "").split(".");
  if (parts.length > 3) return undefined;
  const given: number[] = [];
  for (const part of parts) {
    if (/^[xX*]$/.test(part)) break;
    if (!/^\d+$/.test(part)) return undefined;
    given.push(Number(part));
  }
  return given;
}

const filled = (given: number[]): Parts => [given[0] ?? 0, given[1] ?? 0, given[2] ?? 0];

/** The first version after every one a partial version covers: `1.2` → `1.3.0`. */
function after(given: number[]): Parts | undefined {
  if (given.length === 0) return undefined;
  const next = [...given];
  next[next.length - 1] = (next[next.length - 1] ?? 0) + 1;
  return filled(next);
}

function between(low: Parts, high: Parts | undefined): Test[] {
  return [(v) => compare(v, low) >= 0, ...(high ? [(v: Parts) => compare(v, high) < 0] : [])];
}

/** The tests one comparator of a range, such as `^0.4.2` or `<1.0`, stands for; `undefined` if it isn't one. */
function comparator(text: string): Test[] | undefined {
  const match = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(text);
  const operator = match?.[1] ?? "";
  const given = partial(match?.[2] ?? "");
  if (!given) return undefined;
  const low = filled(given);
  const exact = given.length === 3;
  switch (operator) {
    case "^": {
      const [major, minor, patch] = low;
      if (given.length === 0) return [];
      if (major > 0 || given.length === 1) return between(low, [major + 1, 0, 0]);
      if (minor > 0 || given.length === 2) return between(low, [0, minor + 1, 0]);
      return between(low, [0, 0, patch + 1]);
    }
    case "~":
      return given.length === 0 ? [] : between(low, given.length === 1 ? [low[0] + 1, 0, 0] : [low[0], low[1] + 1, 0]);
    case ">": {
      if (exact) return [(v) => compare(v, low) > 0];
      const next = after(given);
      return next ? [(v) => compare(v, next) >= 0] : [() => false];
    }
    case ">=":
      return [(v) => compare(v, low) >= 0];
    case "<":
      return [(v) => compare(v, low) < 0];
    case "<=": {
      if (exact) return [(v) => compare(v, low) <= 0];
      const next = after(given);
      return next ? [(v) => compare(v, next) < 0] : [];
    }
    default:
      return exact ? [(v) => compare(v, low) === 0] : between(low, after(given));
  }
}

/**
 * Whether a release is in a range as npm writes them, such as `^0.4.0`,
 * `>=0.4.0 <1.0.0`, `0.4.x` or `^0.4.0 || ^0.5.0`. Ranges this can't read,
 * and pre-releases, are never in range.
 */
export function inRange(version: string, range: string): boolean {
  const release = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!release) return false;
  const parts: Parts = [Number(release[1]), Number(release[2]), Number(release[3])];
  return range.split("||").some((set) => {
    const normalized = set
      .trim()
      .replace(/(\^|~|>=|<=|>|<|=)\s+/g, "$1")
      .replace(/^(\S+)\s+-\s+(\S+)$/, (_, from: string, to: string) => `>=${from} <=${to}`);
    const tests: Test[] = [];
    for (const text of normalized.split(/\s+/).filter(Boolean)) {
      const more = comparator(text);
      if (!more) return false;
      tests.push(...more);
    }
    return tests.every((test) => test(parts));
  });
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
  /** Installed blocks' files and site files someone changed, which the update left as they were. */
  kept?: string[];
  /** Site files the update brought up to date (`SiteFile`), even where Goodfellow itself already was. */
  files?: string[];
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
  /** When the site rebuilds overnight, where its setup can say. */
  nightly?: NightlyBuilds;
  /**
   * Builds the site again now, without publishing anything or updating, as
   * an owner's Rebuild now does. Throws `UpdatesError` with `not-allowed`
   * where the sign-in can't run the site's builds.
   */
  rebuild?(): Promise<void>;
}

/** The site's nightly build setting (`NightlyMode`), which the host keeps outside its files. */
export interface NightlyBuilds {
  /** Whether the site's setup files check before building at night, so the setting does anything. */
  supported(): Promise<boolean>;
  /** The setting, or `undefined` where the sign-in can't read it, or the nightly build isn't set up. */
  get(): Promise<NightlyMode | undefined>;
  /** Throws `UpdatesError` with `not-allowed` where the sign-in can't change it. */
  set(mode: NightlyMode): Promise<void>;
}

/** When the site rebuilds overnight: only when something changed (the default), every night, or never. */
export type NightlyMode = "changed" | "always" | "off";

/** The repository variable (GitHub) or schedule variable (GitLab) that holds the site's `NightlyMode`. */
export const NIGHTLY_VARIABLE = "GOODFELLOW_NIGHTLY";

export const NIGHTLY_MODES: readonly NightlyMode[] = ["changed", "always", "off"];

/** A mode from the variable's value: anything that isn't one is the default. */
export function nightlyMode(value: string | undefined): NightlyMode {
  const mode = value?.trim().toLowerCase();
  return NIGHTLY_MODES.includes(mode as NightlyMode) ? (mode as NightlyMode) : "changed";
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
