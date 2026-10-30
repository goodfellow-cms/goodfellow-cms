/**
 * Checking, where the site is built, that a plugin or theme installed before
 * it's `RELEASE_AGE_DAYS` old may be: the admin panel's choice is only a
 * request, since a browser can lie. A release counts only with provenance
 * whose Sigstore signature verifies (`sigstore`, loaded only here, never in
 * browsers), signed by the workflow its statement names, about this very
 * package file, from the same repository and workflow as the release it
 * updates. Then the lockfile is written with that release, and nothing newer
 * than it (`writeEarlyLockfile()`, which `goodfellow-early` runs in sites'
 * lockfile jobs); a theme's is checked as the site builds (`checkEarlyTheme()`).
 */
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { INSTALLED_PLUGINS_FILE, THEME_FILE } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
import { type ThemeRecord, themeRecordSchema } from "./content/themes.js";
import { commandToRun } from "./node-command.js";
import { getPackageJson, oldEnough, type PackageFetch, packageMetadataUrl, RELEASE_AGE_DAYS } from "./npm-packages.js";
import { parseInstalledPlugins } from "./plugin-packages.js";
import {
  attestationsUrl,
  type EarlyInstallRecord,
  type ProvenanceSource,
  type ProvenanceStatement,
  provenanceAttestation,
  sameSource,
} from "./provenance.js";
import { compareReleases } from "./updates.js";

/** Who must have signed a statement: the OpenID issuer and the workflow's identity in the certificate. */
export interface SignerIdentity {
  issuer: string;
  uri: string;
}

/** Checks a Sigstore bundle's signature, certificate and transparency log entries, throwing when it can't. */
export type BundleVerifier = (bundle: unknown, identity: SignerIdentity) => Promise<void>;

/** Sigstore's own verification, with its public trust root, loaded only when it's used. */
export function sigstoreVerifier(): BundleVerifier {
  return async (bundle, identity) => {
    const { verify } = await import("sigstore");
    await verify(bundle as Parameters<typeof verify>[0], {
      certificateIssuer: identity.issuer,
      certificateIdentityURI: identity.uri,
    });
  };
}

/**
 * The identity a workflow's certificate has, where npm's provenance comes
 * from: GitHub Actions' and GitLab.com's. Other places can't be checked, so
 * their releases are never installed early.
 */
export function signerIdentity(statement: ProvenanceStatement): SignerIdentity | undefined {
  if (!statement.ref) return undefined;
  const host = /^https:\/\/([^/]+)\//.exec(statement.repositoryUrl)?.[1]?.toLowerCase();
  if (host === "github.com") {
    return {
      issuer: "https://token.actions.githubusercontent.com",
      uri: `${statement.repositoryUrl}/${statement.workflow}@${statement.ref}`,
    };
  }
  if (host === "gitlab.com") {
    return { issuer: "https://gitlab.com", uri: `${statement.repositoryUrl}//${statement.workflow}@${statement.ref}` };
  }
  return undefined;
}

export interface ProvenanceOptions {
  fetch?: PackageFetch;
  verify?: BundleVerifier;
  now?: Date;
}

/** Why a release's provenance doesn't count. */
export type ProvenanceProblem = "no-provenance" | "unverified" | "unavailable";

/** A release's verified source and when it was published, or why it has none. */
export type VerifiedRelease =
  | { ok: true; source: ProvenanceSource; published: string }
  | { ok: false; problem: ProvenanceProblem; published?: string; message: string };

function hexOf(integrity: string): string | undefined {
  const match = /^sha512-(.+)$/.exec(integrity);
  return match?.[1] ? Buffer.from(match[1], "base64").toString("hex") : undefined;
}

/** The package URL npm's statements name a release by: `pkg:npm/name@1.0.0`, `pkg:npm/%40scope/name@1.0.0`. */
function packageUrls(name: string, version: string): string[] {
  return [`pkg:npm/${name}@${version}`, `pkg:npm/${name.replace(/^@/, "%40")}@${version}`];
}

/**
 * Where a release was built, from its provenance, once its signature is
 * checked: signed by the workflow the statement names, about the file npm
 * serves for this release (its `integrity`).
 */
export async function verifiedSource(
  name: string,
  version: string,
  options: ProvenanceOptions = {},
): Promise<VerifiedRelease> {
  const fetcher = options.fetch ?? ((url) => fetch(url));
  let metadata: { versions?: Record<string, { dist?: { integrity?: unknown } }>; time?: Record<string, string> };
  let answer: unknown;
  try {
    metadata = (await getPackageJson(packageMetadataUrl(name), fetcher)) as typeof metadata;
    const published = metadata.time?.[version];
    const integrity = metadata.versions?.[version]?.dist?.integrity;
    if (!published || typeof integrity !== "string") {
      return { ok: false, problem: "unavailable", message: `npm has no release ${version} of ${name}.` };
    }
    try {
      answer = await getPackageJson(attestationsUrl(name, version), fetcher);
    } catch {
      return { ok: false, problem: "no-provenance", published, message: `${name} ${version} has no provenance.` };
    }
    const found = provenanceAttestation(answer);
    if (!found)
      return { ok: false, problem: "no-provenance", published, message: `${name} ${version} has no provenance.` };
    const digest = hexOf(integrity);
    const about = found.statement.subjects.some(
      (subject) => packageUrls(name, version).includes(subject.name) && subject.sha512 === digest,
    );
    const identity = signerIdentity(found.statement);
    if (!about || !identity) {
      return {
        ok: false,
        problem: "unverified",
        published,
        message: `${name} ${version}'s provenance isn't about the file npm serves, or names a workflow that can't be checked.`,
      };
    }
    try {
      await (options.verify ?? sigstoreVerifier())(found.bundle, identity);
    } catch (error) {
      return {
        ok: false,
        problem: "unverified",
        published,
        message: `${name} ${version}'s provenance didn't verify: ${(error as Error).message}`,
      };
    }
    return {
      ok: true,
      published,
      source: { repository: found.statement.repository, workflow: found.statement.workflow },
    };
  } catch (error) {
    return {
      ok: false,
      problem: "unavailable",
      message: `${name} ${version} couldn't be read: ${(error as Error).message}`,
    };
  }
}

/** A plugin or theme an install record says was installed early. */
export interface EarlyInstall {
  kind: "plugin" | "theme";
  name: string;
  release: string;
  early: EarlyInstallRecord;
}

/** Why an early install can't be used. */
export type EarlyProblem = "not-installed" | "not-newer" | "other-source" | ProvenanceProblem;

export type EarlyCheck =
  | { ok: true; published: string; young: boolean }
  | { ok: false; problem: EarlyProblem; message: string };

/**
 * Whether a release installed early may be: an update of the release the
 * site had (`installed`, where that's known), with both releases' verified
 * provenance from the record's repository and workflow. A release old enough
 * by now needs none of that.
 */
export async function checkEarlyInstall(
  install: EarlyInstall,
  installed: string | undefined,
  options: ProvenanceOptions = {},
): Promise<EarlyCheck> {
  const { name, release, early } = install;
  if (installed !== undefined && installed !== early.from) {
    return {
      ok: false,
      problem: "not-installed",
      message: `${name} ${release} was installed early as an update of ${early.from}, but the site had ${installed || "no release of it"}.`,
    };
  }
  if (compareReleases(release, early.from) <= 0) {
    return { ok: false, problem: "not-newer", message: `${name} ${release} isn't newer than ${early.from}.` };
  }
  const now = options.now ?? new Date();
  const next = await verifiedSource(name, release, options);
  if (next.published && oldEnough({ published: next.published }, now)) {
    return { ok: true, published: next.published, young: false };
  }
  if (!next.ok) return { ok: false, problem: next.problem, message: next.message };
  const before = await verifiedSource(name, early.from, options);
  if (!before.ok) return { ok: false, problem: before.problem, message: before.message };
  if (!sameSource(next.source, early) || !sameSource(before.source, early)) {
    return {
      ok: false,
      problem: "other-source",
      message: `${name} ${release} was built by ${next.source.repository} (${next.source.workflow}) and ${early.from} by ${before.source.repository} (${before.source.workflow}), not both by ${early.repository} (${early.workflow}).`,
    };
  }
  return { ok: true, published: next.published, young: true };
}

/** Thrown when an early install can't be used, naming each. */
export class EarlyInstallError extends Error {
  override name = "EarlyInstallError";
  constructor(readonly problems: { install: EarlyInstall; problem: EarlyProblem; message: string }[]) {
    super(
      `These were installed before they were ${RELEASE_AGE_DAYS} days old, which their provenance doesn't allow:\n${problems.map((found) => `  ${found.message}`).join("\n")}`,
    );
  }
}

/** Runs npm in a folder, for `writeEarlyLockfile()`; tests pass their own. */
export type NpmRunner = (args: string[], cwd: string) => Promise<number>;

const runNpm: NpmRunner = (args, cwd) =>
  new Promise((done) => {
    const run = commandToRun("npm", args);
    const child = spawn(run.file, run.args, { cwd, stdio: "inherit", shell: run.shell });
    child.on("error", () => done(1));
    child.on("close", (code) => done(code ?? 1));
  });

const LOCK_ONLY = ["--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"];

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  return text === undefined ? undefined : (JSON.parse(text) as Record<string, unknown>);
}

/** The release of a package the lockfile has, as installed in the site. */
function lockedRelease(lock: Record<string, unknown> | undefined, name: string): string | undefined {
  const entry = (lock?.packages as Record<string, { version?: unknown }> | undefined)?.[`node_modules/${name}`];
  return typeof entry?.version === "string" ? entry.version : undefined;
}

/** Whether the lockfile has every package and range `package.json` names, as `LOCKFILE_CHECK` asks. */
export function lockfileMatches(site: Record<string, unknown>, lock: Record<string, unknown> | undefined): boolean {
  const root = (lock?.packages as Record<string, Record<string, unknown>> | undefined)?.[""];
  if (!root) return false;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(Object.entries((a as object) ?? {}).sort()) ===
    JSON.stringify(Object.entries((b as object) ?? {}).sort());
  return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].every((key) =>
    same(site[key], root[key]),
  );
}

/**
 * Writes the lockfile, in a site's lockfile job, where plugins were installed
 * early: nothing when it has everything `package.json` names. Otherwise each
 * plugin installed early and still too new is checked first
 * (`checkEarlyInstall()`, with the release the lockfile has as the one
 * installed, unless it has this one already), throwing an `EarlyInstallError`
 * and changing nothing if any can't be used. Then the lockfile is written for
 * everything else with releases `RELEASE_AGE_DAYS` old, as ever, with those
 * plugins at the releases they update, and each is installed at its release
 * with nothing published after it, so its packages can't bring anything newer
 * than it. Returns whether it wrote the lockfile, and the plugins it installed early.
 */
export async function writeEarlyLockfile(
  root: string,
  options: ProvenanceOptions & { npm?: NpmRunner } = {},
): Promise<{ written: boolean; early: EarlyInstall[] }> {
  const packagePath = join(root, "package.json");
  const packageText = await readFile(packagePath, "utf8");
  const site = JSON.parse(packageText) as Record<string, unknown> & { dependencies?: Record<string, string> };
  const lock = await readJson(join(root, "package-lock.json"));
  if (lockfileMatches(site, lock)) return { written: false, early: [] };

  const record = parseInstalledPlugins(
    await readFile(join(root, INSTALLED_PLUGINS_FILE), "utf8").catch(() => undefined),
  );
  const young: { install: EarlyInstall; published: string }[] = [];
  const problems: EarlyInstallError["problems"] = [];
  for (const [name, plugin] of Object.entries(record.plugins)) {
    if (!plugin.early || site.dependencies?.[name] !== plugin.release) continue;
    const locked = lockedRelease(lock, name);
    const install: EarlyInstall = { kind: "plugin", name, release: plugin.release, early: plugin.early };
    // A lockfile that has this release already had it checked when it was written.
    const checked = await checkEarlyInstall(install, locked === plugin.release ? undefined : (locked ?? ""), options);
    if (!checked.ok) problems.push({ install, problem: checked.problem, message: checked.message });
    else if (checked.young) young.push({ install, published: checked.published });
  }
  if (problems.length > 0) throw new EarlyInstallError(problems);

  const npm = options.npm ?? runNpm;
  const now = options.now ?? new Date();
  const before = new Date(now.getTime() - RELEASE_AGE_DAYS * 86_400_000).toISOString();
  // Everything else first, as the site's lockfile is always written: with each plugin installed early at the
  // release it updates, since npm won't take a release newer than --before.
  const waiting = structuredClone(site);
  for (const { install } of young) if (waiting.dependencies) waiting.dependencies[install.name] = install.early.from;
  await writeFile(packagePath, `${JSON.stringify(waiting, null, 2)}\n`);
  try {
    if ((await npm(["install", ...LOCK_ONLY, `--before=${before}`], root)) !== 0) {
      throw new Error("npm couldn't write package-lock.json.");
    }
    for (const { install, published } of young) {
      const code = await npm(
        ["install", `${install.name}@${install.release}`, "--save-exact", ...LOCK_ONLY, `--before=${published}`],
        root,
      );
      if (code !== 0) throw new Error(`npm couldn't install ${install.name} ${install.release}.`);
    }
  } finally {
    // npm writes package.json too: it's put back as it was, which names the same releases.
    await writeFile(packagePath, packageText);
  }
  return { written: true, early: young.map(({ install }) => install) };
}

const run = promisify(execFile);

/**
 * The theme record as the commit before the one that last changed it had it:
 * `null` where it had none, and `undefined` where git's history can't say,
 * as in a shallow checkout that starts at that commit.
 */
async function earlierThemeRecord(root: string): Promise<ThemeRecord | null | undefined> {
  const git = async (...args: string[]) => (await run("git", args, { cwd: root })).stdout.trim();
  try {
    const commit = await git("log", "-n", "1", "--format=%H", "--", THEME_FILE);
    if (!commit) return undefined;
    const [, parent] = (await git("rev-list", "--parents", "-n", "1", commit)).split(" ");
    if (!parent) return (await git("rev-parse", "--is-shallow-repository")) === "true" ? undefined : null;
    const text = await git("show", `${parent}:${THEME_FILE}`).catch(() => undefined);
    if (text === undefined) return null;
    const parsed = themeRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return undefined;
  }
}

/**
 * Checks the site's theme, as it's built, where its record says it was
 * installed early: with the release before it from git's history, where the
 * checkout has it. Throws an `EarlyInstallError` when it can't be used.
 * Returns the theme it checked, if any.
 */
export async function checkEarlyTheme(
  root: string,
  options: ProvenanceOptions = {},
): Promise<EarlyInstall | undefined> {
  const text = await readFile(join(root, THEME_FILE), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const parsed = themeRecordSchema.safeParse(JSON.parse(text));
  const theme = parsed.success ? parsed.data : undefined;
  if (!theme?.early) return undefined;
  const install: EarlyInstall = { kind: "theme", name: theme.name, release: theme.release, early: theme.early };
  const earlier = await earlierThemeRecord(root);
  const installed = earlier === undefined ? undefined : earlier?.name === theme.name ? earlier.release : "";
  const checked = await checkEarlyInstall(install, installed, options);
  if (!checked.ok) throw new EarlyInstallError([{ install, problem: checked.problem, message: checked.message }]);
  return install;
}

function changeText(change: FileChange): string | undefined {
  if ("delete" in change) return undefined;
  return "bytes" in change ? new TextDecoder().decode(change.bytes) : change.content;
}

/**
 * The early installs a set of changes brings, with the release each updates
 * as the site has it now (`read` gives a file as it is), so a server can check
 * them before it writes them: in `plugins/installed/installed.json` and the
 * theme record, those that weren't there before.
 */
export async function earlyInstallsIn(
  changes: readonly FileChange[],
  read: (path: string) => Promise<string | undefined>,
): Promise<{ install: EarlyInstall; installed: string }[]> {
  const found: { install: EarlyInstall; installed: string }[] = [];
  const plugins = changes.find((change) => change.path === INSTALLED_PLUGINS_FILE);
  const pluginsText = plugins && changeText(plugins);
  if (pluginsText !== undefined) {
    const now = parseInstalledPlugins(pluginsText);
    const before = parseInstalledPlugins(await read(INSTALLED_PLUGINS_FILE)).plugins;
    for (const [name, plugin] of Object.entries(now.plugins)) {
      const was = before[name];
      if (!plugin.early || (was?.release === plugin.release && was.early)) continue;
      found.push({
        install: { kind: "plugin", name, release: plugin.release, early: plugin.early },
        installed: was?.release ?? "",
      });
    }
  }
  const theme = changes.find((change) => change.path === THEME_FILE);
  const themeText = theme && changeText(theme);
  if (themeText !== undefined) {
    const now = themeRecordSchema.safeParse(JSON.parse(themeText));
    const beforeText = await read(THEME_FILE);
    const was = beforeText === undefined ? undefined : themeRecordSchema.safeParse(JSON.parse(beforeText)).data;
    const record = now.success ? now.data : undefined;
    if (record?.early && !(was?.name === record.name && was.release === record.release && was.early)) {
      found.push({
        install: { kind: "theme", name: record.name, release: record.release, early: record.early },
        installed: was?.name === record.name ? was.release : "",
      });
    }
  }
  return found;
}

/**
 * Checks the early installs a set of changes brings (`earlyInstallsIn()`),
 * giving what's wrong with each, for a server to refuse them.
 */
export async function earlyChangeProblems(
  changes: readonly FileChange[],
  read: (path: string) => Promise<string | undefined>,
  options: ProvenanceOptions = {},
): Promise<EarlyInstallError["problems"]> {
  const problems: EarlyInstallError["problems"] = [];
  for (const { install, installed } of await earlyInstallsIn(changes, read)) {
    const checked = await checkEarlyInstall(install, installed, options);
    if (!checked.ok) problems.push({ install, problem: checked.problem, message: checked.message });
  }
  return problems;
}
