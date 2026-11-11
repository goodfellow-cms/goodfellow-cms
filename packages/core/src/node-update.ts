import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findBuildCause } from "./build-problems.js";
import { CONTENT_REPOSITORY_DIR, INSTALLED_RECORD_FILE, SITE_FILE, UPDATES_FILE } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
import { commandToRun } from "./node-command.js";
import { type VerifiedRelease, verifiedSource } from "./node-provenance.js";
import { sameSource } from "./provenance.js";
import {
  type FetchJson,
  GOODFELLOW_REGISTRY,
  goodfellowRegistryUrl,
  parseInstalledRecord,
  planUpdate,
  REGISTRY_PACKAGES,
  RegistryError,
} from "./registry.js";
import {
  agedReleases,
  availableUpdates,
  chooseUpdate,
  compareReleases,
  GOODFELLOW_RELEASE_SOURCE,
  NPM_REGISTRY,
  parseUpdateSettings,
  releaseVersion,
  releaseVersions,
  siteVersion,
  UPDATE_AGE_DAYS,
  type UpdateResult,
  updateSettingsFile,
  VERSION_PACKAGE,
  withSiteOverrides,
} from "./updates.js";

/**
 * A file sites start with that a release changes, such as a Next.js site's
 * admin pages. Updates bring it up to date where it's still exactly as an
 * earlier release wrote it, leave it where someone has changed it, and put
 * the earlier one back when going back to a release before `since`.
 */
export interface SiteFile {
  path: string;
  /** The first release with `content`. */
  since: string;
  content: string;
  /** What earlier releases wrote, oldest first; empty where they had no such file. */
  earlier: readonly string[];
}

/** The changes that bring site files to `release`, and the ones someone changed, which stay as they are. */
export async function siteFileChanges(
  files: readonly SiteFile[],
  release: string,
  read: (path: string) => Promise<string | undefined>,
): Promise<{ changes: FileChange[]; kept: string[] }> {
  const changes: FileChange[] = [];
  const kept: string[] = [];
  for (const file of files) {
    const text = (await read(file.path))?.replace(/\r\n/g, "\n");
    if (compareReleases(release, file.since) >= 0) {
      if (text === file.content) continue;
      const known = text === undefined ? file.earlier.length === 0 : file.earlier.includes(text);
      if (known) changes.push({ path: file.path, content: file.content });
      else if (text !== undefined) kept.push(file.path);
      continue;
    }
    // Going back to a release before the file changed puts back what that release wrote.
    if (text !== file.content) continue;
    const earlier = file.earlier.at(-1);
    changes.push(earlier === undefined ? { path: file.path, delete: true } : { path: file.path, content: earlier });
  }
  return { changes, kept };
}

/** Runs a command in the site's folder, and says how it went and what it printed. */
export type RunCommand = (command: string, args: string[], cwd: string) => Promise<{ code: number; output: string }>;

export interface UpdateOptions {
  /** The site's folder. Defaults to the current folder. */
  root?: string;
  /**
   * `fixes` (the default) for the newest fixes of the site's release; `automatic`
   * for the same, unless `content/updates.json` turns automatic updates off, as
   * the nightly update does; `latest`; or a release such as `0.5.0`. An older
   * release goes back to it, and skips the site's release from then on.
   */
  to?: string;
  /** Publishes the update, once the site has built with it, as a commit pushed to `branch`. */
  publish?: boolean;
  /**
   * Commits the update, once the site has built with it, without pushing it,
   * so a job that runs none of the site's code can publish it. In GitHub
   * Actions it says `commit=true` in the step's outputs when it made one.
   */
  commit?: boolean;
  /** The branch to publish to. Defaults to CI's branch, or `main`. */
  branch?: string;
  /**
   * Also updates the blocks the site installed from Goodfellow's registry. Off unless asked, since
   * the nightly update's publishing job takes only Goodfellow's packages and the site's files: the
   * job that made the update ran the site's packages, which could have written any code. Owners
   * update blocks on the Blocks screen, and developers with `--blocks`.
   */
  blocks?: boolean;
  /** Goodfellow's block registry, as `https://…/{name}.json`. Defaults to the release being installed. */
  registry?: string;
  /** Files of the site's own that releases change, such as `goodfellow-next`'s admin pages. */
  siteFiles?: readonly SiteFile[];
  /** For tests. */
  fetchJson?: FetchJson;
  /** Checks Goodfellow's releases' provenance before an automatic update. Defaults to `verifiedSource()`. */
  verifyRelease?: ReleaseVerifier;
  now?: Date;
  run?: RunCommand;
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/**
 * A day after npm says `version` was published, or now if that's sooner, for
 * `npm install --before`, or nothing where npm doesn't say. A time still to
 * come would hold nothing back.
 */
function installedBefore(packument: unknown, version: string, now: Date): string | undefined {
  const time = (packument as { time?: Record<string, unknown> } | undefined)?.time?.[version];
  const published = typeof time === "string" ? Date.parse(time) : Number.NaN;
  return Number.isNaN(published)
    ? undefined
    : new Date(Math.min(published + 24 * 60 * 60 * 1000, now.getTime())).toISOString();
}

/** Says where a release of a package was built, once its provenance is checked, as `verifiedSource()` does. */
export type ReleaseVerifier = (name: string, version: string) => Promise<VerifiedRelease>;

/**
 * The Goodfellow packages a release of `names` installs: those, and every
 * Goodfellow package their releases at `version` depend on, however deep, as
 * npm's metadata lists them, since all of them are released together.
 */
async function goodfellowPackagesAt(names: string[], version: string, fetchJson: FetchJson): Promise<string[]> {
  const found = new Set(names);
  const queue = [...names];
  for (let name = queue.shift(); name; name = queue.shift()) {
    // A release whose metadata can't be read throws, so the update stops rather than miss what it brings.
    const manifest = (await fetchJson(`${NPM_REGISTRY}/${name}/${version}`)) as {
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
    };
    for (const group of [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies]) {
      for (const dependency of Object.keys(group ?? {})) {
        if (isGoodfellowPackage(dependency) && !found.has(dependency)) {
          found.add(dependency);
          queue.push(dependency);
        }
      }
    }
  }
  return [...found].sort();
}

/**
 * What's wrong with each Goodfellow package's release `version`, in words:
 * provenance that's missing, doesn't verify, or names anything but
 * Goodfellow's own release workflow.
 */
async function unverifiedReleases(names: string[], version: string, verify: ReleaseVerifier): Promise<string[]> {
  const problems = await Promise.all(
    names.map(async (name) => {
      const release = await verify(name, version);
      if (!release.ok) return release.message;
      return sameSource(release.source, GOODFELLOW_RELEASE_SOURCE)
        ? undefined
        : `${name} ${version} was built by ${release.source.workflow} in ${release.source.repository}, not by Goodfellow's release workflow.`;
    }),
  );
  return problems.filter((problem): problem is string => problem !== undefined);
}

/** A Goodfellow package as `package-lock.json` installs it: the file it came from, and its `integrity`. */
interface LockedPackage {
  name: string;
  version: string;
  resolved: unknown;
  integrity: unknown;
}

/**
 * The Goodfellow packages `package-lock.json` installs, by name and version,
 * wherever they are in its tree.
 */
async function lockedGoodfellowPackages(root: string): Promise<LockedPackage[]> {
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8")) as {
    packages?: Record<string, { version?: unknown; link?: unknown; resolved?: unknown; integrity?: unknown }>;
  };
  const locked = new Map<string, LockedPackage>();
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf("node_modules/");
    if (at < 0) continue;
    const name = path.slice(at + "node_modules/".length);
    if (!isGoodfellowPackage(name)) continue;
    // A link is a folder of the site's own, which npm installs nothing into.
    if (entry.link === true) continue;
    if (typeof entry.version !== "string") throw new Error(`${path} in package-lock.json has no version.`);
    const { version, resolved, integrity } = entry;
    locked.set(`${name}@${version} ${String(integrity)}`, { name, version, resolved, integrity });
  }
  // A site always has some, so none means the lockfile isn't one this can read.
  if (locked.size === 0) throw new Error("package-lock.json names no Goodfellow packages.");
  return [...locked.values()];
}

/**
 * What's wrong with each Goodfellow package npm installed, in words: one that
 * didn't come from npm's registry, whose provenance doesn't verify as
 * `unverifiedReleases()` checks it, or whose file isn't the one that
 * provenance is about (its `integrity`).
 */
async function unverifiedInstalls(locked: LockedPackage[], verify: ReleaseVerifier): Promise<string[]> {
  const problems = await Promise.all(
    locked.map(async ({ name, version, resolved, integrity }) => {
      if (typeof resolved !== "string" || !resolved.startsWith(`${NPM_REGISTRY}/`)) {
        return [`${name} ${version} wasn't installed from npm's registry.`];
      }
      const release = await verify(name, version);
      if (!release.ok) return [release.message];
      if (!sameSource(release.source, GOODFELLOW_RELEASE_SOURCE)) {
        return [
          `${name} ${version} was built by ${release.source.workflow} in ${release.source.repository}, not by Goodfellow's release workflow.`,
        ];
      }
      return typeof integrity === "string" && integrity === release.integrity
        ? []
        : [`${name} ${version} as npm installed it isn't the file its provenance is about.`];
    }),
  );
  return problems.flat();
}

/** Goodfellow's packages, which are all released together with the same version. */
function isGoodfellowPackage(name: string): boolean {
  return name.startsWith("@goodfellow-cms/") || name === "goodfellow" || name === "create-goodfellow";
}

/** Who update commits say made them. */
const AUTHOR = ["-c", "user.name=Goodfellow updates", "-c", "user.email=updates@goodfellow.invalid"];

const runCommand: RunCommand = (command, args, cwd) =>
  new Promise((done) => {
    // Shown as it runs, as CI logs show it, and kept to find what the build said.
    let output = "";
    const run = commandToRun(command, args);
    const child = spawn(run.file, run.args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: run.shell });
    const keep = (chunk: Buffer, to: NodeJS.WriteStream) => {
      output += chunk.toString();
      to.write(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => keep(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => keep(chunk, process.stderr));
    child.on("error", (error) => done({ code: 1, output: `${output}${error.message}` }));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });

async function fetchJsonFromNetwork(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * Updates a site to a newer Goodfellow release: its Goodfellow packages and the
 * Puck version they use, and, with `blocks`, blocks from Goodfellow's registry,
 * whose files are replaced only where nobody changed them. Then it installs the packages and
 * builds the site. If either fails, every file goes back as it was. With
 * `publish`, a site that built is published as one commit.
 */
export async function update(options: UpdateOptions = {}): Promise<UpdateResult> {
  const undo: { written: () => boolean; restore: () => Promise<void> } = {
    written: () => false,
    restore: async () => {},
  };
  try {
    return await updateSite(options, undo);
  } catch (error) {
    // Anything else that goes wrong once files are written, such as a file that can't be read, puts them back too.
    if (undo.written()) await undo.restore();
    throw error;
  }
}

async function updateSite(
  options: UpdateOptions,
  undo: { written: () => boolean; restore: () => Promise<void> },
): Promise<UpdateResult> {
  const root = resolve(options.root ?? ".");
  const fetchJson = options.fetchJson ?? fetchJsonFromNetwork;
  const run = options.run ?? runCommand;
  const log = options.log ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;

  // Only a file that isn't there is missing: one that can't be read stops the update, rather than being taken as
  // missing and written over, or deleted when the update is undone.
  const read = (path: string) =>
    readFile(join(root, path), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  const packageText = await readFile(join(root, "package.json"), "utf8");
  const from = siteVersion(packageText);
  if (!from) {
    throw new Error(`${join(root, "package.json")} doesn't use a published release of ${VERSION_PACKAGE}.`);
  }
  const settingsText = await read(UPDATES_FILE);
  const settings = parseUpdateSettings(settingsText);
  const target = options.to ?? "fixes";
  if (target === "automatic" && !settings.automatic) {
    log(`Automatic updates are turned off in ${UPDATES_FILE}, so Goodfellow ${from} stays as it is.`);
    return { state: "up-to-date", from, paused: true };
  }
  const now = options.now ?? new Date();
  const packument = await fetchJson(`${NPM_REGISTRY}/${VERSION_PACKAGE}`);
  // Automatic updates wait until a release is old enough, and never take one that's deprecated.
  const versions = target === "automatic" ? agedReleases(packument, now) : releaseVersions(packument);
  const to = chooseUpdate(from, versions, target === "automatic" ? "fixes" : target, settings.skip);
  const waiting =
    // Only a release too young to install yet: one npm says is deprecated never is.
    target === "automatic" && !to
      ? chooseUpdate(from, agedReleases(packument, now, 0), "fixes", settings.skip)
      : undefined;
  if (waiting) {
    log(
      `Goodfellow ${waiting} isn't installed automatically yet: automatic updates wait until a release is ${UPDATE_AGE_DAYS} days old, and never install one npm says is deprecated. Update with \`--to ${waiting}\` to install it now.`,
    );
  }
  // Fixes leave out newer releases, such as 0.8.0 for a site on 0.7.x, which are only installed when asked for.
  const newer =
    !to && (target === "fixes" || target === "automatic")
      ? availableUpdates(from, versions, settings.skip).newer
      : undefined;
  const upToDate = newer
    ? `Goodfellow ${from} has every fix for its release. ${newer} is a newer release, with new features and changes: update with \`--to latest\` to install it.`
    : `Goodfellow ${from} is up to date.`;
  const siteFiles = options.siteFiles ?? [];
  const current = to ? undefined : await siteFileChanges(siteFiles, from, read);
  if (!to && current?.changes.length === 0 && !options.blocks) {
    log(upToDate);
    if (current.kept.length > 0) log(keptMessage(current.kept));
    return { state: "up-to-date", from, ...(current.kept.length > 0 && { kept: current.kept }) };
  }
  const rollback = to !== undefined && compareReleases(to, from) < 0;
  log(
    !to
      ? `${upToDate} Bringing the site's own files up to date for it…`
      : rollback
        ? `Going back from Goodfellow ${from} to ${to}…`
        : `Updating Goodfellow from ${from} to ${to}…`,
  );

  // Every file the update writes, as it was, to put back if the update doesn't work.
  const originals = new Map<string, string | undefined>();
  const remember = async (path: string) => {
    if (!originals.has(path)) originals.set(path, await read(path));
  };
  const apply = async (change: FileChange) => {
    // Writing what a file already holds changes nothing, so it's left out of what the run changed.
    if ("content" in change && (await read(change.path)) === change.content) return;
    await remember(change.path);
    const file = join(root, change.path);
    if ("delete" in change) await rm(file, { force: true });
    else if ("content" in change) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, change.content);
    }
  };
  const restore = async () => {
    for (const [path, text] of originals) {
      const file = join(root, path);
      if (text === undefined) await rm(file, { force: true });
      else await writeFile(file, text);
    }
    // Put the packages back as the lockfile says, for the build that follows.
    // Without scripts on an automatic run, as its install was.
    await run("npm", ["ci", "--no-audit", "--no-fund", ...(target === "automatic" ? ["--ignore-scripts"] : [])], root);
  };
  undo.written = () => originals.size > 0;
  undo.restore = restore;
  const failed = async (result: Omit<UpdateResult, "state" | "from" | "to">): Promise<UpdateResult> => {
    await restore();
    log(`The update to ${to ?? from} didn't work, so nothing changed.`);
    return { state: "failed", from, ...(to && { to }), ...(rollback && { rollback }), ...result };
  };

  /**
   * Blocks from Goodfellow's registry, from `release`'s registry, written where nobody changed them; the files
   * someone did change, or a failure.
   */
  async function updateBlocks(release: string): Promise<{ kept: string[] } | { failed: UpdateResult }> {
    const kept: string[] = [];
    let record: ReturnType<typeof parseInstalledRecord>;
    try {
      // Only a site without the record has no blocks: one that's there but can't be read isn't taken as empty,
      // which would skip every block.
      record = parseInstalledRecord(await read(INSTALLED_RECORD_FILE));
    } catch {
      // What was written before is put back, as for any other failure.
      log(`${INSTALLED_RECORD_FILE} can't be read, so the blocks weren't updated.`);
      return { failed: await failed({ step: "blocks" }) };
    }
    const registries = { [GOODFELLOW_REGISTRY]: options.registry ?? goodfellowRegistryUrl(release) };
    const dependencies = (JSON.parse(packageText) as { dependencies?: Record<string, string> }).dependencies;
    const packages = [...REGISTRY_PACKAGES, ...Object.keys(dependencies ?? {})];
    for (const [name, block] of Object.entries(record.blocks)) {
      if (!block.source.startsWith(`${GOODFELLOW_REGISTRY}/`)) continue;
      try {
        const plan = await planUpdate({ name, record, registries, fetchJson, readFile: read, packages });
        for (const change of plan.changes) await apply(change);
        record = plan.record;
        kept.push(...plan.kept);
      } catch (error) {
        if (!(error instanceof RegistryError)) {
          // Such as a block's file that can't be read, which is never taken as missing and written over.
          log(`The block ${name} couldn't be updated: ${error instanceof Error ? error.message : String(error)}`);
          return { failed: await failed({ step: "blocks" }) };
        }
        // A block newer than the release the site goes back to stays as it is.
        if (rollback && error.problem.code === "unreachable") {
          log(`The block ${name} isn't in Goodfellow ${release}'s blocks, so it stays as it is.`);
          continue;
        }
        log(`The block ${name} couldn't be updated: ${error.problem.code}.`);
        return { failed: await failed({ step: "blocks" }) };
      }
    }
    return { kept };
  }

  // Goodfellow is up to date, but files of the site's own, or with `blocks` its registry blocks, may not be yet:
  // they're all this run changes.
  if (!to && current) {
    for (const change of current.changes) await apply(change);
    const kept = [...current.kept];
    if (options.blocks) {
      const blocks = await updateBlocks(from);
      if ("failed" in blocks) return blocks.failed;
      kept.push(...blocks.kept);
    }
    const files = current.changes.map((change) => change.path);
    if (originals.size === 0) {
      log(upToDate);
      if (kept.length > 0) log(keptMessage(kept));
      return { state: "up-to-date", from, ...(kept.length > 0 && { kept }) };
    }
    log("Building the site with them…");
    const built = await run("npm", ["run", "build"], root);
    if (built.code !== 0) {
      const cause = findBuildCause(built.output);
      return failed({ step: "build", ...(cause && { cause }), files });
    }
    if ((options.publish || options.commit) && !(await publish(`Update the site's files for Goodfellow ${from}`))) {
      return failed({ step: "publish", files });
    }
    log(`Brought these files up to date for Goodfellow ${from}:\n  ${[...originals.keys()].join("\n  ")}`);
    if (kept.length > 0) log(keptMessage(kept));
    return { state: "up-to-date", from, ...(files.length > 0 && { files }), ...(kept.length > 0 && { kept }) };
  }
  if (!to) return { state: "up-to-date", from };

  // Every Goodfellow package to the same release, and Puck to the version that release uses.
  const site = JSON.parse(packageText) as Record<string, unknown> & {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // An automatic update installs only what Goodfellow's own release workflow built, as each package's provenance
  // says, so a release published any other way, such as with a stolen npm token, never reaches sites by itself.
  const verify: ReleaseVerifier = options.verifyRelease ?? ((name, version) => verifiedSource(name, version));
  if (target === "automatic") {
    // The site's own Goodfellow packages, and the ones they bring, such as @goodfellow-cms/ai with the Next.js adapter.
    const problems = await goodfellowPackagesAt(
      [...new Set([...Object.keys(site.dependencies ?? {}), ...Object.keys(site.devDependencies ?? {})])].filter(
        isGoodfellowPackage,
      ),
      to,
      fetchJson,
    ).then(
      (names) => unverifiedReleases(names, to, verify),
      (error: unknown) => [
        `Goodfellow ${to}'s packages couldn't be read from npm: ${error instanceof Error ? error.message : String(error)}`,
      ],
    );
    if (problems.length > 0) {
      for (const problem of problems) log(problem);
      log(
        `Goodfellow ${to} isn't installed automatically, since it can't be shown to come from Goodfellow's releases.`,
      );
      // Nothing has changed yet, so there's nothing to put back.
      return { state: "failed", from, to, step: "provenance" };
    }
  }
  const manifest = (await fetchJson(`${NPM_REGISTRY}/${VERSION_PACKAGE}/${to}`).catch(() => ({}))) as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const puck = releaseVersion(
    manifest.dependencies?.["@puckeditor/core"] ?? manifest.peerDependencies?.["@puckeditor/core"] ?? "",
  );
  for (const dependencies of [site.dependencies, site.devDependencies]) {
    for (const [name, range] of Object.entries(dependencies ?? {})) {
      if (!dependencies) continue;
      if (isGoodfellowPackage(name)) dependencies[name] = `${/^[\^~]?/.exec(range)?.[0] ?? ""}${to}`;
      else if (name === "@puckeditor/core" && puck) dependencies[name] = puck;
    }
  }
  // Overrides that fix security advisories, for sites made before Goodfellow added them.
  const { overrides, added } = withSiteOverrides(site.overrides);
  site.overrides = overrides;
  await apply({ path: "package.json", content: `${JSON.stringify(site, null, 2)}\n` });
  await remember("package-lock.json");
  // npm keeps a package's own copy its lockfile already has, though an override no longer allows it, so the copies
  // of what an added override replaces are left out for npm to install again.
  const lockText = added.length > 0 ? await read("package-lock.json") : undefined;
  if (lockText) {
    const lock = JSON.parse(lockText) as { packages?: Record<string, unknown> };
    const replaced = Object.keys(lock.packages ?? {}).filter((path) =>
      added.some(([name, child]) => path.startsWith(`node_modules/${name}/`) && path.endsWith(`node_modules/${child}`)),
    );
    for (const path of replaced) delete lock.packages?.[path];
    if (replaced.length > 0) await apply({ path: "package-lock.json", content: `${JSON.stringify(lock, null, 2)}\n` });
  }

  // Going back skips the release the site went back from, so automatic updates don't install it again;
  // choosing a release no longer skips it.
  const exact = releaseVersion(target) === to;
  const skip = [...settings.skip.filter((version) => !(exact && version === to)), ...(rollback ? [from] : [])];
  const settingsFile = updateSettingsFile({ ...settings, skip });
  if (settingsFile !== updateSettingsFile(settings)) {
    // Content kept in a repository of its own is only a copy here, and isn't the code's to publish.
    if (existsSync(join(root, CONTENT_REPOSITORY_DIR, SITE_FILE))) {
      if (rollback) {
        log(
          `This site's content is kept in a repository of its own: add ${from} to "skip" in its ${UPDATES_FILE} there, or turn automatic updates off, so the nightly update doesn't install it again.`,
        );
      }
    } else await apply({ path: UPDATES_FILE, content: settingsFile });
  }

  // With `blocks`, blocks from Goodfellow's registry, from the release being installed.
  const kept: string[] = [];
  if (options.blocks) {
    const blocks = await updateBlocks(to);
    if ("failed" in blocks) return blocks.failed;
    kept.push(...blocks.kept);
  }

  // Files of the site's own, as the release being installed writes them.
  const own = await siteFileChanges(siteFiles, to, read);
  for (const change of own.changes) await apply(change);
  kept.push(...own.kept);
  const files = own.changes.map((change) => change.path);

  log("Installing packages…");
  // Only what npm had a day after the release came out, so a package published (or taken over) since
  // isn't installed into every site that updates overnight. The day lets in the release's own packages,
  // published one after another.
  const before = to ? installedBefore(packument, to, now) : undefined;
  // An automatic update runs no package's install script, whatever the site's `.npmrc` says, since what npm installed
  // is checked only once it has.
  const install = [
    "install",
    "--no-audit",
    "--no-fund",
    ...(before ? [`--before=${before}`] : []),
    ...(target === "automatic" ? ["--ignore-scripts"] : []),
  ];
  if ((await run("npm", install, root)).code !== 0) return failed({ step: "install" });
  // What npm installed may not be what its metadata said, such as a newer release a range takes, so an automatic
  // update checks every Goodfellow package the lockfile names before any of the site's code runs.
  if (target === "automatic") {
    const problems = await lockedGoodfellowPackages(root).then(
      (locked) => unverifiedInstalls(locked, verify),
      (error: unknown) => [
        `The packages npm installed couldn't be read: ${error instanceof Error ? error.message : String(error)}`,
      ],
    );
    if (problems.length > 0) {
      for (const problem of problems) log(problem);
      return failed({ step: "provenance" });
    }
  }
  log("Building the site with the update…");
  const built = await run("npm", ["run", "build"], root);
  if (built.code !== 0) {
    const cause = findBuildCause(built.output);
    return failed({ step: "build", ...(cause && { cause }) });
  }

  if (
    (options.publish || options.commit) &&
    !(await publish(rollback ? `Go back to Goodfellow ${to}` : `Update Goodfellow to ${to}`))
  ) {
    return failed({ step: "publish" });
  }

  log(
    rollback
      ? `Went back from Goodfellow ${from} to ${to}. Updates won't install ${from} again.`
      : `Updated Goodfellow from ${from} to ${to}.`,
  );
  if (files.length > 0) log(`Brought these files up to date for it:\n  ${files.join("\n  ")}`);
  if (kept.length > 0) log(keptMessage(kept));
  return { state: "updated", from, to, kept, ...(files.length > 0 && { files }), ...(rollback && { rollback }) };

  /** Commits what the update wrote and pushes it, unless only committing, saying whether that worked. */
  async function publish(message: string): Promise<boolean> {
    const branch = options.branch ?? env.GITHUB_REF_NAME ?? env.CI_DEFAULT_BRANCH ?? "main";
    const head = (await run("git", ["rev-parse", "HEAD"], root)).output.trim();
    const paths = [...originals.keys()];
    const push = options.publish === true;
    const steps: string[][] = [
      ["add", "--all", "--", ...paths],
      [...AUTHOR, "commit", "--message", message],
      ...(push ? [["push", "origin", `HEAD:refs/heads/${branch}`]] : []),
    ];
    for (const args of steps) {
      if ((await run("git", args, root)).code === 0) continue;
      // Someone may have published meanwhile: nothing is lost, and the next run tries again.
      if (head) await run("git", ["reset", "--hard", head], root);
      return false;
    }
    if (env.GITHUB_OUTPUT && !push) await appendFile(env.GITHUB_OUTPUT, "commit=true\n");
    else if (env.GITHUB_OUTPUT) {
      const sha = (await run("git", ["rev-parse", "HEAD"], root)).output.trim();
      await appendFile(env.GITHUB_OUTPUT, `sha=${sha}\n`);
    }
    return true;
  }
}

function keptMessage(kept: readonly string[]): string {
  return `Kept these files as they were, since someone changed them:\n  ${kept.join("\n  ")}`;
}
