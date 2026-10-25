/**
 * Reading packages from npm's registry and their files from jsDelivr, both of
 * which answer browsers, for themes and plugins alike: searching by keyword,
 * listing releases with their provenance, and choosing the release to offer.
 * Nothing here runs a package's code.
 */
import { compareReleases, inRange, NPM_REGISTRY, releaseVersion } from "./updates.js";

/** npm packages' files, at an exact release, from jsDelivr. */
export const JSDELIVR_NPM = "https://cdn.jsdelivr.net/npm";
/** jsDelivr's list of a release's files. */
export const JSDELIVR_DATA = "https://data.jsdelivr.com/v1/packages/npm";
/** The package whose release a theme's or plugin's `peerDependencies` range names. */
export const GOODFELLOW_PEER = "@goodfellow-cms/core";
/**
 * How many days old a release must be before it's offered: most harmful
 * releases of npm packages are found and removed within a few days.
 */
export const RELEASE_AGE_DAYS = 3;

export type PackageErrorCode = "unavailable" | "not-found" | "not-a-theme" | "not-a-plugin" | "bad-file";

/** Thrown when a package can't be found or read; the admin panel says what happened from `code`. */
export class PackageError extends Error {
  override name = "PackageError";
  constructor(
    readonly code: PackageErrorCode,
    message: string,
    readonly file?: string,
  ) {
    super(message);
  }
}

/** The part of `fetch` reading packages uses, so core needs no DOM types. Pass the browser's or Node's `fetch`. */
export type PackageFetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface PackageFetchOptions {
  fetch?: PackageFetch;
}

const globalFetch: PackageFetch = (url) => (globalThis as unknown as { fetch: PackageFetch }).fetch(url);
const host = (url: string) => new URL(url).hostname;

export function packageFetch(options: PackageFetchOptions): PackageFetch {
  return options.fetch ?? globalFetch;
}

async function request(url: string, fetcher: PackageFetch) {
  try {
    return await fetcher(url);
  } catch (error) {
    throw new PackageError("unavailable", `Couldn't reach ${host(url)}: ${(error as Error).message}`);
  }
}

/** A JSON answer; a missing one throws `not-found`. */
export async function getPackageJson(url: string, fetcher: PackageFetch): Promise<unknown> {
  const response = await request(url, fetcher);
  if (response.status === 404) throw new PackageError("not-found", `${url} wasn't found.`);
  if (!response.ok) throw new PackageError("unavailable", `${host(url)} answered ${response.status}.`);
  return response.json();
}

/** A file's text; a missing one throws `bad-file` naming it. */
export async function getPackageText(url: string, file: string, fetcher: PackageFetch): Promise<string> {
  const response = await request(url, fetcher);
  if (response.status === 404) throw new PackageError("bad-file", `The package has no ${file}.`, file);
  if (!response.ok) throw new PackageError("unavailable", `${host(url)} answered ${response.status}.`);
  return response.text();
}

/** npm's address for a package's metadata. */
export function packageMetadataUrl(name: string): string {
  return `${NPM_REGISTRY}/${name.replace("/", "%2F")}`;
}

/** A file of a package's release, from jsDelivr. */
export function packageFileUrl(name: string, version: string, file: string): string {
  return `${JSDELIVR_NPM}/${name}@${version}/${file}`;
}

/** A package as a search lists it. */
export interface PackageListing {
  name: string;
  description: string;
  /** Its newest release, whether or not it's offered yet. */
  version: string;
  /** Who published it on npm. */
  publisher?: string;
}

/** Packages on npm with a keyword, newest-looking first, optionally matching words, that `isName` accepts. */
export async function searchPackages(
  keyword: string,
  isName: (name: string) => boolean,
  words: string,
  options: PackageFetchOptions & { size: number },
): Promise<PackageListing[]> {
  const text = `keywords:${keyword}${words.trim() ? ` ${words.trim()}` : ""}`;
  const answer = (await getPackageJson(
    `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&size=${options.size}`,
    packageFetch(options),
  )) as { objects?: { package?: Record<string, unknown> }[] };
  const listings: PackageListing[] = [];
  for (const { package: found } of answer.objects ?? []) {
    const name = typeof found?.name === "string" ? found.name : "";
    const version = typeof found?.version === "string" ? found.version : "";
    const keywords = Array.isArray(found?.keywords) ? found.keywords : [];
    if (!isName(name) || !releaseVersion(version) || !keywords.includes(keyword)) continue;
    const publisher = (found?.publisher as { username?: unknown } | undefined)?.username;
    listings.push({
      name,
      version,
      description: typeof found?.description === "string" ? found.description : "",
      ...(typeof publisher === "string" && { publisher }),
    });
  }
  return listings;
}

/** Lifecycle scripts npm runs when a package is installed, unless scripts are turned off, as sites' `.npmrc` does. */
export const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall"] as const;

/** One release of a package, as npm describes it. */
export interface PackageRelease {
  version: string;
  /** When it was published, as an ISO 8601 date. */
  published: string;
  /** The Goodfellow releases it says it works with. */
  goodfellow?: string;
  /** Whether npm has a record of where it was built, which npm checked when it was published. */
  provenance: boolean;
  /** Its source repository, as its `package.json` says; npm checked it matches where it was built when it has provenance. */
  repository?: string;
  /** Why its publisher says not to use it, if they do. */
  deprecated?: string;
  /** The packages it needs, with the ranges it accepts. */
  dependencies?: Record<string, string>;
  /** The install scripts it has (`INSTALL_SCRIPTS`), with what each runs. */
  installScripts?: Record<string, string>;
}

/** A repository's web address from `package.json`'s spelling: `git+https://github.com/a/b.git` → `https://github.com/a/b`. */
function repositoryAddress(url: string): string {
  const shorthand = /^(github|gitlab):([\w.-]+\/[\w.-]+)$/.exec(url);
  if (shorthand) return `https://${shorthand[1]}.com/${shorthand[2]}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/\.git$/, "");
}

function strings(value: unknown): Record<string, string> | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** The releases in npm's metadata for a package, oldest first. Pre-releases are left out. */
export function releasesIn(metadata: unknown): PackageRelease[] {
  const { versions, time } = (metadata ?? {}) as {
    versions?: Record<string, Record<string, unknown>>;
    time?: Record<string, string>;
  };
  const releases: PackageRelease[] = [];
  for (const [version, details] of Object.entries(versions ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    const peers = (details.peerDependencies ?? {}) as Record<string, unknown>;
    const dist = (details.dist ?? {}) as { attestations?: { provenance?: unknown } };
    const repository = details.repository;
    const url =
      typeof repository === "string"
        ? repository
        : typeof (repository as { url?: unknown } | undefined)?.url === "string"
          ? (repository as { url: string }).url
          : undefined;
    const scripts = strings(details.scripts) ?? {};
    const installScripts = Object.fromEntries(
      INSTALL_SCRIPTS.flatMap((name) => (scripts[name] ? [[name, scripts[name]]] : [])),
    );
    // npm runs `node-gyp rebuild` for packages with a binding.gyp and no install script of their own.
    if (details.gypfile === true && !installScripts.install) installScripts.install = "node-gyp rebuild";
    const dependencies = strings(details.dependencies);
    releases.push({
      version,
      published: time?.[version] ?? "",
      ...(typeof peers[GOODFELLOW_PEER] === "string" && { goodfellow: peers[GOODFELLOW_PEER] }),
      provenance: dist.attestations?.provenance !== undefined,
      ...(url && { repository: repositoryAddress(url) }),
      ...(typeof details.deprecated === "string" && { deprecated: details.deprecated }),
      ...(dependencies && { dependencies }),
      ...(Object.keys(installScripts).length > 0 && { installScripts }),
    });
  }
  return releases.sort((a, b) => compareReleases(a.version, b.version));
}

/** A package's releases on npm, oldest first. */
export async function packageReleases(name: string, options: PackageFetchOptions = {}): Promise<PackageRelease[]> {
  return releasesIn(await getPackageJson(packageMetadataUrl(name), packageFetch(options)));
}

/** Which release of a package to offer, and why newer ones aren't. */
export interface ReleaseChoice {
  /** The newest release that's old enough, says it works with this Goodfellow release, and isn't deprecated. */
  release?: PackageRelease;
  /** A newer release that will be offered once it's `RELEASE_AGE_DAYS` old. */
  waiting?: PackageRelease;
  /** A newer release that doesn't say it works with this Goodfellow release. */
  incompatible?: PackageRelease;
}

/** Whether a release says it works with a Goodfellow release; one that doesn't say isn't offered. */
export function worksWith(release: Pick<PackageRelease, "goodfellow">, goodfellow: string): boolean {
  return release.goodfellow !== undefined && inRange(goodfellow, release.goodfellow);
}

/** Whether a release was published at least `RELEASE_AGE_DAYS` before `now`. */
export function oldEnough(release: Pick<PackageRelease, "published">, now: Date = new Date()): boolean {
  return Date.parse(release.published) <= now.getTime() - RELEASE_AGE_DAYS * 86_400_000;
}

/** The release of a package to offer on a Goodfellow release, from its releases oldest first. */
export function chooseRelease(
  releases: readonly PackageRelease[],
  goodfellow: string,
  now: Date = new Date(),
): ReleaseChoice {
  const choice: ReleaseChoice = {};
  for (const release of [...releases].reverse()) {
    if (release.deprecated) continue;
    if (!worksWith(release, goodfellow)) {
      choice.incompatible ??= release;
      continue;
    }
    if (!oldEnough(release, now)) {
      choice.waiting ??= release;
      continue;
    }
    choice.release = release;
    break;
  }
  if (choice.waiting && choice.release && compareReleases(choice.waiting.version, choice.release.version) <= 0) {
    delete choice.waiting;
  }
  if (
    choice.incompatible &&
    choice.release &&
    compareReleases(choice.incompatible.version, choice.release.version) <= 0
  ) {
    delete choice.incompatible;
  }
  return choice;
}
