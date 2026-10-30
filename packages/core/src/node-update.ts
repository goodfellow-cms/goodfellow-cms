import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findBuildCause } from "./build-problems.js";
import { CONTENT_REPOSITORY_DIR, INSTALLED_RECORD_FILE, SITE_FILE, UPDATES_FILE } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
import { commandToRun } from "./node-command.js";
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
  availableUpdates,
  chooseUpdate,
  compareReleases,
  NPM_REGISTRY,
  parseUpdateSettings,
  releaseVersion,
  releaseVersions,
  siteVersion,
  type UpdateResult,
  updateSettingsFile,
  VERSION_PACKAGE,
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
  /** Goodfellow's block registry, as `https://…/{name}.json`. Defaults to the release being installed. */
  registry?: string;
  /** Files of the site's own that releases change, such as `goodfellow-next`'s admin pages. */
  siteFiles?: readonly SiteFile[];
  /** For tests. */
  fetchJson?: FetchJson;
  run?: RunCommand;
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/** A day after npm says `version` was published, for `npm install --before`, or nothing where it doesn't say. */
function installedBefore(packument: unknown, version: string): string | undefined {
  const time = (packument as { time?: Record<string, unknown> } | undefined)?.time?.[version];
  const published = typeof time === "string" ? Date.parse(time) : Number.NaN;
  return Number.isNaN(published) ? undefined : new Date(published + 24 * 60 * 60 * 1000).toISOString();
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
 * Puck version they use, and blocks from Goodfellow's registry, whose files are
 * replaced only where nobody changed them. Then it installs the packages and
 * builds the site. If either fails, every file goes back as it was. With
 * `publish`, a site that built is published as one commit.
 */
export async function update(options: UpdateOptions = {}): Promise<UpdateResult> {
  const root = resolve(options.root ?? ".");
  const fetchJson = options.fetchJson ?? fetchJsonFromNetwork;
  const run = options.run ?? runCommand;
  const log = options.log ?? ((line: string) => console.log(line));
  const env = options.env ?? process.env;

  const read = (path: string) => readFile(join(root, path), "utf8").catch(() => undefined);
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
  const packument = await fetchJson(`${NPM_REGISTRY}/${VERSION_PACKAGE}`);
  const versions = releaseVersions(packument);
  const to = chooseUpdate(from, versions, target === "automatic" ? "fixes" : target, settings.skip);
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
  if (!to && current?.changes.length === 0) {
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
    await run("npm", ["ci", "--no-audit", "--no-fund"], root);
  };
  const failed = async (result: Omit<UpdateResult, "state" | "from" | "to">): Promise<UpdateResult> => {
    await restore();
    log(`The update to ${to ?? from} didn't work, so nothing changed.`);
    return { state: "failed", from, ...(to && { to }), ...(rollback && { rollback }), ...result };
  };

  // Goodfellow is up to date, but files of the site's own aren't yet: they're all this run changes.
  if (!to && current) {
    for (const change of current.changes) await apply(change);
    const files = current.changes.map((change) => change.path);
    log("Building the site with them…");
    const built = await run("npm", ["run", "build"], root);
    if (built.code !== 0) {
      const cause = findBuildCause(built.output);
      return failed({ step: "build", ...(cause && { cause }), files });
    }
    if ((options.publish || options.commit) && !(await publish(`Update the site's files for Goodfellow ${from}`))) {
      return failed({ step: "publish", files });
    }
    log(`Brought these files up to date for Goodfellow ${from}:\n  ${files.join("\n  ")}`);
    if (current.kept.length > 0) log(keptMessage(current.kept));
    return { state: "up-to-date", from, files, ...(current.kept.length > 0 && { kept: current.kept }) };
  }
  if (!to) return { state: "up-to-date", from };

  // Every Goodfellow package to the same release, and Puck to the version that release uses.
  const site = JSON.parse(packageText) as Record<string, unknown> & {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
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
  await apply({ path: "package.json", content: `${JSON.stringify(site, null, 2)}\n` });
  await remember("package-lock.json");

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

  // Blocks from Goodfellow's registry, from the release being installed.
  const kept: string[] = [];
  let record = parseInstalledRecord(await read(INSTALLED_RECORD_FILE));
  const registries = { [GOODFELLOW_REGISTRY]: options.registry ?? goodfellowRegistryUrl(to) };
  const packages = [...REGISTRY_PACKAGES, ...Object.keys(site.dependencies ?? {})];
  for (const [name, block] of Object.entries(record.blocks)) {
    if (!block.source.startsWith(`${GOODFELLOW_REGISTRY}/`)) continue;
    try {
      const plan = await planUpdate({ name, record, registries, fetchJson, readFile: read, packages });
      for (const change of plan.changes) await apply(change);
      record = plan.record;
      kept.push(...plan.kept);
    } catch (error) {
      if (!(error instanceof RegistryError)) throw error;
      // A block newer than the release the site goes back to stays as it is.
      if (rollback && error.problem.code === "unreachable") {
        log(`The block ${name} isn't in Goodfellow ${to}'s blocks, so it stays as it is.`);
        continue;
      }
      log(`The block ${name} couldn't be updated: ${error.problem.code}.`);
      return failed({ step: "blocks" });
    }
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
  const before = to ? installedBefore(packument, to) : undefined;
  const install = ["install", "--no-audit", "--no-fund", ...(before ? [`--before=${before}`] : [])];
  if ((await run("npm", install, root)).code !== 0) return failed({ step: "install" });
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
