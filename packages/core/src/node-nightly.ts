/**
 * The nightly check in sites' setup files (`goodfellow nightly`, `goodfellow-next
 * nightly`): whether tonight's build is needed, so a site is built only when
 * visitors would see something new. It reads the live site's build record
 * (`goodfellow-build.json`) and builds when the record can't be read, the
 * repository has changed since, the time it stops being current has passed,
 * or an update the site's settings allow is available, which it installs first.
 */
import { appendFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BUILD_RECORD_PATH, type BuildRecord, parseBuildRecord } from "./build-record.js";
import { CONTENT_REPOSITORY_DIR, SITE_FILE, UPDATES_FILE } from "./content/paths.js";
import { absoluteUrl } from "./head.js";
import { builtFrom } from "./node-build-record.js";
import { type SiteFile, siteFileChanges } from "./node-update.js";
import type { FetchJson } from "./registry.js";
import { siteCopyFrom } from "./site-copy.js";
import {
  chooseUpdate,
  NIGHTLY_VARIABLE,
  type NightlyMode,
  NPM_REGISTRY,
  nightlyMode,
  parseUpdateSettings,
  releaseVersions,
  siteVersion,
  VERSION_PACKAGE,
} from "./updates.js";

/** Why tonight's build is needed, or isn't. */
export type NightlyReason =
  /** The site's setting builds it every night. */
  | "always"
  /** The site's setting turns nightly builds off. */
  | "off"
  /** The live site's build record couldn't be read, so it isn't known to be current. */
  | "no-record"
  /** The repository has changed since the live site was built, such as after a build that failed. */
  | "changed"
  /** Something it shows by today's date, or a scheduled change, has come since it was built. */
  | "dated"
  /** An update the site's settings allow is available. */
  | "update"
  /** Nothing has changed. */
  | "current";

export interface NightlyResult {
  /** Whether to build the site tonight. */
  build: boolean;
  /** Whether to run the update first, which builds the site with it. */
  update: boolean;
  reasons: NightlyReason[];
  mode: NightlyMode;
  /** The live site's build record, where it could be read. */
  live?: BuildRecord;
  /** The release the update would install. */
  release?: string;
}

export interface NightlyOptions {
  /** The site's folder. Defaults to the current folder. */
  root?: string;
  /** The site's setting, such as `GOODFELLOW_NIGHTLY`'s value. Defaults to that variable. */
  mode?: string;
  now?: Date;
  /** Files of the site's own that releases change, which an update also brings up to date. */
  siteFiles?: readonly SiteFile[];
  /** For tests. */
  fetch?: typeof fetch;
  fetchJson?: FetchJson;
  env?: NodeJS.ProcessEnv;
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

/** The Site address, from `content/site.json`, or the content repository's where the content isn't in place. */
async function siteUrl(root: string): Promise<string | undefined> {
  for (const path of [join(root, SITE_FILE), join(root, CONTENT_REPOSITORY_DIR, SITE_FILE)]) {
    const text = await readText(path);
    if (text === undefined) continue;
    try {
      const { url } = JSON.parse(text) as { url?: unknown };
      return typeof url === "string" && url ? url : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The live site's build record, or `undefined` where it can't be read. */
export async function liveRecord(url: string | undefined, fetcher: typeof fetch): Promise<BuildRecord | undefined> {
  if (!url) return undefined;
  try {
    const response = await fetcher(absoluteUrl(url, `/${BUILD_RECORD_PATH}`), {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok ? parseBuildRecord(await response.text()) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchJsonFromNetwork(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * The update `goodfellow update --to automatic` would install, if any, or
 * `true` where Goodfellow is up to date but files of the site's own aren't.
 * Problems reading releases count as none.
 */
async function availableUpdate(
  root: string,
  siteFiles: readonly SiteFile[],
  fetchJson: FetchJson,
): Promise<string | true | undefined> {
  const from = siteVersion((await readText(join(root, "package.json"))) ?? "");
  if (!from) return undefined;
  try {
    const settings = parseUpdateSettings(await readText(join(root, UPDATES_FILE)));
    if (!settings.automatic) return undefined;
    const versions = releaseVersions(await fetchJson(`${NPM_REGISTRY}/${VERSION_PACKAGE}`));
    const release = chooseUpdate(from, versions, "fixes", settings.skip);
    if (release) return release;
    const { changes } = await siteFileChanges(siteFiles, from, (path) => readText(join(root, path)));
    return changes.length > 0 ? true : undefined;
  } catch {
    return undefined;
  }
}

/** Whether tonight's build is needed, and why. */
export async function nightlyCheck(options: NightlyOptions = {}): Promise<NightlyResult> {
  const root = resolve(options.root ?? ".");
  const env = options.env ?? process.env;
  const mode = nightlyMode(options.mode ?? env[NIGHTLY_VARIABLE]);
  if (mode === "off") return { build: false, update: false, reasons: ["off"], mode };

  const now = options.now ?? new Date();
  const [live, update] = await Promise.all([
    liveRecord(siteCopyFrom(env).url ?? (await siteUrl(root)), options.fetch ?? fetch),
    availableUpdate(root, options.siteFiles ?? [], options.fetchJson ?? fetchJsonFromNetwork),
  ]);
  const reasons: NightlyReason[] = [];
  if (mode === "always") reasons.push("always");
  if (!live) reasons.push("no-record");
  else {
    const built = builtFrom(root, env);
    const changed =
      (built.commit !== undefined && built.commit !== live.commit) ||
      (built.content !== undefined && built.content !== live.content);
    if (changed) reasons.push("changed");
    if (live.currentUntil && new Date(live.currentUntil) <= now) reasons.push("dated");
  }
  if (update !== undefined) reasons.push("update");
  if (reasons.length === 0) reasons.push("current");
  return {
    build: !reasons.includes("current"),
    update: update !== undefined,
    reasons,
    mode,
    ...(live && { live }),
    ...(typeof update === "string" && { release: update }),
  };
}

const REASONS: Record<NightlyReason, string> = {
  always: "the site is set to build every night",
  off: "the site is set not to build at night",
  "no-record": `the live site's ${BUILD_RECORD_PATH} couldn't be read`,
  changed: "the site has changed since the live site was built",
  dated: "something it shows by today's date has changed since it was built",
  update: "an update is available",
  current: "nothing has changed since the live site was built",
};

/**
 * What the check found, for the log, and `build=…` and `update=…` in `output`:
 * on GitHub Actions the step's outputs, which the next jobs' conditions read,
 * or a file a GitLab job's shell reads.
 */
export async function reportNightly(
  result: NightlyResult,
  output: string | undefined = process.env.GITHUB_OUTPUT,
): Promise<string[]> {
  const why = result.reasons.map((reason) => REASONS[reason]).join(", and ");
  const lines = [result.build ? `Building the site tonight: ${why}.` : `Not building the site tonight: ${why}.`];
  if (result.update) {
    lines.push(
      result.release
        ? `Goodfellow ${result.release} is installed first, if the site still builds with it.`
        : "The site's own files are brought up to date first.",
    );
  }
  if (result.live?.currentUntil && result.build === false) {
    lines.push(`The live site stays current until ${result.live.currentUntil}.`);
  }
  if (output) await appendFile(output, `build=${result.build}\nupdate=${result.update}\n`);
  return lines;
}
