import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { findBuildCause } from "./build-problems.js";
import { CONTENT_REPOSITORY_DIR, INSTALLED_RECORD_FILE, SITE_FILE, UPDATES_FILE } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
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
  /** The branch to publish to. Defaults to CI's branch, or `main`. */
  branch?: string;
  /** Goodfellow's block registry, as `https://…/{name}.json`. Defaults to the release being installed. */
  registry?: string;
  /** For tests. */
  fetchJson?: FetchJson;
  run?: RunCommand;
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
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
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
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
  const to = chooseUpdate(
    from,
    releaseVersions(await fetchJson(`${NPM_REGISTRY}/${VERSION_PACKAGE}`)),
    target === "automatic" ? "fixes" : target,
    settings.skip,
  );
  if (!to) {
    log(`Goodfellow ${from} is up to date.`);
    return { state: "up-to-date", from };
  }
  const rollback = compareReleases(to, from) < 0;
  log(rollback ? `Going back from Goodfellow ${from} to ${to}…` : `Updating Goodfellow from ${from} to ${to}…`);

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
    log(`The update to ${to} didn't work, so nothing changed.`);
    return { state: "failed", from, to, ...(rollback && { rollback }), ...result };
  };

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

  log("Installing packages…");
  if ((await run("npm", ["install", "--no-audit", "--no-fund"], root)).code !== 0) return failed({ step: "install" });
  log("Building the site with the update…");
  const built = await run("npm", ["run", "build"], root);
  if (built.code !== 0) {
    const cause = findBuildCause(built.output);
    return failed({ step: "build", ...(cause && { cause }) });
  }

  if (options.publish) {
    const branch = options.branch ?? env.GITHUB_REF_NAME ?? env.CI_DEFAULT_BRANCH ?? "main";
    const head = (await run("git", ["rev-parse", "HEAD"], root)).output.trim();
    const paths = [...originals.keys()];
    const steps: string[][] = [
      ["add", "--all", "--", ...paths],
      [...AUTHOR, "commit", "--message", rollback ? `Go back to Goodfellow ${to}` : `Update Goodfellow to ${to}`],
      ["push", "origin", `HEAD:refs/heads/${branch}`],
    ];
    for (const args of steps) {
      if ((await run("git", args, root)).code === 0) continue;
      // Someone may have published meanwhile: nothing is lost, and the next run tries again.
      if (head) await run("git", ["reset", "--hard", head], root);
      return failed({ step: "publish" });
    }
    if (env.GITHUB_OUTPUT) {
      const sha = (await run("git", ["rev-parse", "HEAD"], root)).output.trim();
      await appendFile(env.GITHUB_OUTPUT, `sha=${sha}\n`);
    }
  }

  log(
    rollback
      ? `Went back from Goodfellow ${from} to ${to}. Updates won't install ${from} again.`
      : `Updated Goodfellow from ${from} to ${to}.`,
  );
  if (kept.length > 0) log(`Kept these block files as they were, since someone changed them:\n  ${kept.join("\n  ")}`);
  return { state: "updated", from, to, kept, ...(rollback && { rollback }) };
}
