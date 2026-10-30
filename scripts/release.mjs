#!/usr/bin/env node
// Releases Goodfellow's packages to npm, all with the same version. See RELEASING.md.
//
//   node scripts/release.mjs version            Turns the changesets into changelogs and new versions.
//   node scripts/release.mjs publish [--dry-run] [--yes] [--ci]
//                                               Publishes the versions npm doesn't have yet, then tags them.
//                                               The release workflow runs it with --ci once CI passes on master,
//                                               which stages them on npm instead, for a maintainer to approve.
//   node scripts/release.mjs wait [--minutes <n>]
//                                               Waits until every package is on npm, as the workflow does.
//   node scripts/release.mjs tag [--dry-run]    Tags the release once every package is on npm.
//   node scripts/release.mjs staged             Lists the versions waiting for approval on npm.
//   node scripts/release.mjs approve [--version <v>] [--otp <code>] [--yes]
//                                               Approves them, which publishes them.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

class ReleaseError extends Error {}

/** On Windows, pnpm and npm are .cmd files, which Node only starts through a shell. */
const windows = process.platform === "win32";

/** An argument as cmd.exe reads it: quoted unless it's plain. */
function quote(arg) {
  return /^[\w@+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

function spawn(command, args, options) {
  return windows
    ? spawnSync([command, ...args.map(quote)].join(" "), { cwd: root, shell: true, ...options })
    : spawnSync(command, args, { cwd: root, ...options });
}

/** Runs a command, showing its output. Throws if it fails. */
function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawn(command, args, { stdio: "inherit", ...options });
  if (result.error) throw new ReleaseError(`Couldn't run ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new ReleaseError(`${command} ${args.join(" ")} failed.`);
}

/** Runs a command and returns what it printed. */
function read(command, args, options = {}) {
  const result = spawn(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options });
  if (result.error) throw new ReleaseError(`Couldn't run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new ReleaseError(`${command} ${args.join(" ")} failed:\n${result.stderr?.trim() ?? ""}`);
  }
  return result.stdout.trim();
}

/** The packages that are published: every package in packages/ that isn't private. */
function packages() {
  return readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(root, "packages", entry.name);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      return { dir, manifest, name: manifest.name, version: manifest.version };
    })
    .filter(({ manifest }) => !manifest.private);
}

/** The packages in the order to publish them: each after the packages it depends on. */
function inDependencyOrder(list) {
  const byName = new Map(list.map((pkg) => [pkg.name, pkg]));
  const ordered = [];
  const visiting = new Set();
  const visit = (pkg) => {
    if (ordered.includes(pkg)) return;
    if (visiting.has(pkg.name)) throw new ReleaseError(`${pkg.name} depends on itself through other packages.`);
    visiting.add(pkg.name);
    const { dependencies = {}, peerDependencies = {}, devDependencies = {} } = pkg.manifest;
    for (const name of Object.keys({ ...dependencies, ...peerDependencies, ...devDependencies })) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency);
    }
    visiting.delete(pkg.name);
    ordered.push(pkg);
  };
  for (const pkg of [...list].sort((a, b) => a.name.localeCompare(b.name))) visit(pkg);
  return ordered;
}

/** The changesets waiting to be released. */
function pendingChangesets() {
  return readdirSync(join(root, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md");
}

function requireCleanTree() {
  const status = read("git", ["status", "--porcelain"]);
  if (status) throw new ReleaseError(`Commit or stash these changes first:\n${status}`);
}

/** Every package has the same version, since they're released together. */
function sharedVersion(list) {
  const versions = [...new Set(list.map((pkg) => pkg.version))];
  if (versions.length !== 1) {
    throw new ReleaseError(
      `The packages should all have the same version, but have ${versions.join(", ")}. Check .changeset/config.json's "fixed".`,
    );
  }
  return versions[0];
}

/** Whether this exact version is already on npm. */
function isPublished(name, version) {
  const result = spawn("npm", ["view", `${name}@${version}`, "version", "--json"], { encoding: "utf8" });
  if (result.error) throw new ReleaseError(`Couldn't run npm: ${result.error.message}`);
  if (result.status === 0) return result.stdout.trim() !== "";
  // npm reports a version it doesn't have as E404, on stdout with --json and on stderr.
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (/E404|404 Not Found/.test(output)) return false;
  throw new ReleaseError(`Couldn't ask npm about ${name}@${version}:\n${output.trim()}`);
}

/** Whether npm has any version of a package: trusted publishing only works for packages that exist. */
function isOnNpm(name) {
  const result = spawn("npm", ["view", name, "name", "--json"], { encoding: "utf8" });
  if (result.error) throw new ReleaseError(`Couldn't run npm: ${result.error.message}`);
  if (result.status === 0) return result.stdout.trim() !== "";
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (/E404|404 Not Found/.test(output)) return false;
  throw new ReleaseError(`Couldn't ask npm about ${name}:\n${output.trim()}`);
}

async function confirm(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`${question} [y/N] `)).trim());
  } finally {
    prompt.close();
  }
}

/** Staged publishing needs npm 11.15.0 or later. */
function requireStaging() {
  const current = read("npm", ["--version"]);
  const [major, minor] = current.split(".").map(Number);
  if (major < 11 || (major === 11 && minor < 15)) {
    throw new ReleaseError(
      `Staged publishing needs npm 11.15 or later, and this is npm ${current}. Update it with \`npm install --global npm@11\`.`,
    );
  }
}

function requireNpmSignIn({ dryRun = false } = {}) {
  const whoami = spawn("npm", ["whoami"], { encoding: "utf8" });
  if (whoami.error) throw new ReleaseError(`Couldn't run npm: ${whoami.error.message}`);
  if (whoami.status === 0) console.log(`\nSigned in to npm as ${whoami.stdout.trim()}.`);
  else if (dryRun) console.log("\nNot signed in to npm; a dry run doesn't need it.");
  else throw new ReleaseError("You aren't signed in to npm. Run `npm login`, then try again.");
}

function version() {
  requireCleanTree();
  if (pendingChangesets().length === 0) {
    throw new ReleaseError("There are no changesets, so there's nothing to release. Add them with `pnpm changeset`.");
  }
  run("pnpm", ["changeset", "version"]);
  // Keeps the lockfile in step with the new versions.
  run("pnpm", ["install", "--lockfile-only"]);
  const next = sharedVersion(packages());
  console.log(`
Every package is now ${next}. Next:
  1. Read the new CHANGELOG.md files and the version changes (git diff).
  2. Commit them on a branch, such as "Release ${next}", and open a pull request.
  3. Once CI passes, merge it. The release workflow then publishes ${next} to npm
     and updates the docs site.`);
}

/** Tells the workflow running this what happened, for its later steps. */
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

/** Says what happened, on the page of the workflow run, as well as in its log. */
function report(message) {
  console.log(`\n${message}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
}

/** The commit being released, as its short id and subject: `a5230f3 ("Release 0.2.0")`. */
function thisCommit() {
  return read("git", ["log", "-1", '--format=%h ("%s")']);
}

/**
 * The short id of GitHub's master, if it has moved on from the commit being
 * released, as it has when an earlier run is run again after a later merge.
 */
function newerMaster() {
  try {
    const sha = read("git", ["ls-remote", "origin", "refs/heads/master"]).split(/\s/)[0];
    return sha && sha !== read("git", ["rev-parse", "HEAD"]) ? sha.slice(0, 7) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Publishes the versions npm doesn't have yet. Run on your computer, it checks
 * you're on GitHub's master and runs the checks first, then publishes and tags
 * them. With `--ci`, the release workflow runs it after CI has passed on the
 * commit, so it only builds, and it stages the versions on npm, where a
 * maintainer approves them with two-factor authentication (`approve`); the
 * workflow then waits for them (`wait`) and tags them (`tag`).
 */
async function publish({ ci, dryRun, yes }) {
  requireCleanTree();
  if (!ci) {
    const branch = read("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch !== "master") throw new ReleaseError(`Publish from master, not ${branch}.`);
    run("git", ["fetch", "origin", "master", "--tags"]);
    if (read("git", ["rev-parse", "HEAD"]) !== read("git", ["rev-parse", "origin/master"])) {
      throw new ReleaseError(
        "This master isn't the same as GitHub's. Run `git pull` (and push anything of yours) first.",
      );
    }
  }

  const list = inDependencyOrder(packages());
  const next = sharedVersion(list);
  setOutput("version", next);
  setOutput("waiting", "false");
  // 0.0.0 is the version before the first release, never one to publish.
  if (next === "0.0.0") {
    console.log("\nThe packages haven't been given a version yet. Run `pnpm release:version` first.");
    return;
  }
  // A workflow run releases the commit it was started for, which may not be master's latest.
  const commit = ci ? `Commit ${thisCommit()}` : "This commit";
  const toPublish = list.filter((pkg) => !isPublished(pkg.name, pkg.version));
  if (toPublish.length === 0) {
    const waiting = pendingChangesets().length;
    const newer = ci ? newerMaster() : undefined;
    report(
      `${commit} is version ${next}, and every package is already on npm at ${next}, so there's nothing to publish.${
        newer
          ? ` master has moved on to ${newer} since: its own Release run starts once CI passes on it, and publishes its version if npm doesn't have it.`
          : waiting > 0
            ? ` To release the ${waiting} waiting changesets, run \`pnpm release:version\` and merge its pull request.`
            : ""
      }`,
    );
    return;
  }

  if (ci) {
    // npm sets up trusted publishing in a package's settings, so the workflow can't stage a package's first version.
    const unknown = toPublish.filter((pkg) => !isOnNpm(pkg.name)).map((pkg) => pkg.name);
    if (unknown.length > 0) {
      throw new ReleaseError(
        `${unknown.join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} on npm yet, and the workflow can only stage packages npm already has. Publish ${unknown.length === 1 ? "its" : "their"} first version from your computer with \`pnpm release:publish\`, which publishes only what npm doesn't have, then give ${unknown.length === 1 ? "it a trusted publisher" : "each a trusted publisher"} as RELEASING.md's "Adding a package" says, and run this workflow again to tag the release and deploy the docs.`,
      );
    }
    requireStaging();
  } else requireNpmSignIn({ dryRun });

  // Versions an earlier run staged are waiting for approval already, and npm won't stage them twice.
  const staged = ci ? alreadyStaged(toPublish) : new Set();
  const toPack = toPublish.filter((pkg) => !staged?.has(pkg.name));
  if (ci && staged === undefined) {
    console.log("\nnpm didn't say which versions are staged already, so this stages them all.");
  }
  if (toPack.length === 0) {
    if (!dryRun) setOutput("waiting", "true");
    report(
      `Every package npm doesn't have at ${next} is staged already, by an earlier run. Approve them with \`pnpm release:approve\` on your computer; this workflow waits for the approval, then tags the release and deploys the docs.`,
    );
    return;
  }
  // CI has passed on the commit the workflow publishes, end-to-end tests included.
  for (const step of ci ? ["build"] : ["lint", "typecheck", "test", "build"]) run("pnpm", [step]);

  const out = mkdtempSync(join(tmpdir(), "goodfellow-release-"));
  const failed = [];
  try {
    // pnpm writes the package's dependencies on other packages here (workspace:*) as their versions.
    const tarballs = toPack.map((pkg) => {
      const packed = JSON.parse(read("pnpm", ["pack", "--json", "--pack-destination", out], { cwd: pkg.dir }));
      return { ...pkg, tarball: packed.filename };
    });

    const verb = ci ? (dryRun ? "Would stage" : "Staging") : dryRun ? "Would publish" : "Publishing";
    console.log(`\n${verb} ${next}:`);
    for (const pkg of tarballs) console.log(`  ${pkg.name}`);
    const skipped = list.filter((pkg) => !toPublish.includes(pkg));
    if (skipped.length > 0) console.log(`Already on npm: ${skipped.map((pkg) => pkg.name).join(", ")}`);
    if (staged?.size) console.log(`Already staged, waiting for approval: ${[...staged].join(", ")}`);

    if (!ci && !dryRun && !yes && !(await confirm(`\nPublish ${tarballs.length} packages to npm?`))) {
      throw new ReleaseError("Nothing was published.");
    }
    // In GitHub Actions, npm records where each package was built (provenance).
    const flags = [
      "--access",
      "public",
      ...(process.env.GITHUB_ACTIONS ? ["--provenance"] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ];
    if (ci) {
      // Staging needs no two-factor code, and doesn't publish anything until a maintainer approves it.
      // One that fails doesn't stop the others: it may only have been staged by an earlier run npm didn't list.
      for (const pkg of tarballs) {
        // What a maintainer compares with what `approve` shows, so they approve the files this run built.
        report(`${pkg.name}@${pkg.version}: ${integrity(pkg.tarball)}`);
        if (!(await stage(pkg.tarball, flags))) failed.push(pkg.name);
      }
    } else {
      for (const pkg of tarballs) {
        // On your computer, npm asks for a one-time code or a browser sign-in itself if the account needs one.
        run("npm", ["publish", pkg.tarball, ...flags]);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }

  if (ci) {
    if (!dryRun) setOutput("waiting", "true");
    if (failed.length > 0) {
      throw new ReleaseError(
        `Couldn't stage ${failed.join(", ")}. If an earlier run staged them, approve them with \`pnpm release:approve\` and the release carries on. Otherwise, fix the problem and run the workflow again.`,
      );
    }
    if (!dryRun) {
      report(
        `Staged ${next}, from ${commit.toLowerCase()}. Approve it with \`pnpm release:approve\` on your computer; this workflow waits for the approval, then tags the release and deploys the docs.`,
      );
    }
    return;
  }
  tagRelease(list, next, { dryRun });
  if (!dryRun) {
    console.log(
      `\nReleased ${next}. To update the docs site, run the "Deploy docs" workflow in the repository's Actions tab.`,
    );
  }
}

/** How many times a package is staged before its failure is given up on, where npm says it may work again. */
const STAGE_ATTEMPTS = 3;

/**
 * npm's failures that staging again may get past, since nothing was staged: Sigstore's transparency log refusing a
 * package's provenance statement as one it has already, which is how npm's own retry of an upload the log was slow to
 * answer, but took, fails. Staging again signs afresh.
 */
const STAGE_AGAIN = /TLOG_CREATE_ENTRY_ERROR/;

/** Stages a tarball on npm, showing what npm says, and returns whether it was staged. */
async function stage(tarball, flags) {
  for (let attempt = 1; ; attempt += 1) {
    console.log(`\n$ npm stage publish ${tarball} ${flags.join(" ")}`);
    const result = spawn("npm", ["stage", "publish", tarball, ...flags], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    if (!result.error && result.status === 0) return true;
    if (attempt >= STAGE_ATTEMPTS || !STAGE_AGAIN.test(`${result.stdout ?? ""}${result.stderr ?? ""}`)) return false;
    console.log(
      `\nSigstore's transparency log refused the package's provenance as a duplicate, as it does when it was slow to answer npm, and nothing was staged. Staging it again in 30 seconds (attempt ${attempt + 1} of ${STAGE_ATTEMPTS}).`,
    );
    await sleep(30_000);
  }
}

/**
 * The names of these packages npm has staged at their versions already, or
 * `undefined` where npm won't say, as it may not to a workflow that signs in
 * with trusted publishing.
 */
function alreadyStaged(list) {
  try {
    return new Set(
      stagedVersions(list)
        .filter((item) => item.version === item.pkg.version)
        .map((item) => item.pkg.name),
    );
  } catch {
    return undefined;
  }
}

/** A tarball's digest as npm writes it (`sha512-…`), which npm keeps for every version it publishes. */
function integrity(file) {
  return `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`;
}

/**
 * The commit a version was released from: the first commit on master's own
 * history whose packages are at it, so a release tagged by a later run, after
 * master has moved on, is still tagged where its version was set.
 */
function releaseCommit(next) {
  const file = "packages/core/package.json";
  const commits = read("git", ["rev-list", "--first-parent", "--reverse", "HEAD", "--", file]).split("\n");
  for (const commit of commits.filter(Boolean)) {
    const shown = spawn("git", ["show", `${commit}:${file}`], { encoding: "utf8" });
    if (shown.status === 0 && JSON.parse(shown.stdout).version === next) return commit;
  }
  return read("git", ["rev-parse", "HEAD"]);
}

/** Tags the release, as Changesets would: one tag for each package, and one for the release. Returns whether the release's tag is new. */
function tagRelease(list, next, { dryRun, commit = "HEAD" }) {
  const tags = [...list.map((pkg) => `${pkg.name}@${pkg.version}`), `v${next}`];
  const existing = new Set(read("git", ["tag", "--list"]).split("\n"));
  const missing = tags.filter((tag) => !existing.has(tag));
  if (dryRun) {
    console.log(
      `\nWould tag ${missing.length > 0 ? missing.join(", ") : "nothing (all tagged)"} at ${commit.slice(0, 7)} and push the tags.`,
    );
    return false;
  }
  for (const tag of missing) run("git", ["tag", tag, commit]);
  if (missing.length > 0) run("git", ["push", "origin", ...missing.map((tag) => `refs/tags/${tag}`)]);
  return missing.includes(`v${next}`);
}

/** Tags the release once every package is on npm, for the release workflow after the versions are approved. */
function tag({ dryRun }) {
  const list = packages();
  const next = sharedVersion(list);
  setOutput("released", "false");
  if (next === "0.0.0") return;
  const missing = list.filter((pkg) => !isPublished(pkg.name, pkg.version));
  if (missing.length > 0) {
    console.log(`\nNot tagging ${next}: npm doesn't have ${missing.map((pkg) => pkg.name).join(", ")} at it yet.`);
    return;
  }
  const commit = releaseCommit(next);
  const released = tagRelease(list, next, { dryRun, commit });
  if (dryRun) return;
  setOutput("released", String(released));
  // The docs are built from the same commit, so they describe what was published.
  setOutput("sha", commit);
  console.log(released ? `\nReleased ${next}, from ${commit.slice(0, 7)}.` : `\n${next} was already tagged.`);
}

/**
 * Waits until every package is on npm at its version, checking every minute,
 * for the release workflow while a maintainer approves the staged versions.
 */
async function wait({ minutes }) {
  const list = packages();
  const next = sharedVersion(list);
  const deadline = Date.now() + minutes * 60_000;
  let shown = "";
  for (;;) {
    let missing;
    try {
      missing = list.filter((pkg) => !isPublished(pkg.name, pkg.version)).map((pkg) => pkg.name);
    } catch (error) {
      // npm not answering once doesn't end the wait.
      if (!(error instanceof ReleaseError)) throw error;
      console.log(error.message);
    }
    if (missing?.length === 0) {
      console.log(`\nEvery package is on npm at ${next}.`);
      return;
    }
    if (missing && missing.join() !== shown) {
      shown = missing.join();
      console.log(`${new Date().toISOString()} Waiting for ${next} to be approved: ${missing.join(", ")}`);
    }
    if (Date.now() >= deadline) {
      throw new ReleaseError(
        `After ${minutes} minutes, npm still doesn't have ${shown.split(",").join(", ")} at ${next}. Approve them with \`pnpm release:approve\`, then run the Release workflow again: it tags the release and deploys the docs.`,
      );
    }
    await sleep(60_000);
  }
}

/** The versions of these packages waiting for approval on npm. */
function stagedVersions(list) {
  return list.flatMap((pkg) => {
    const items = JSON.parse(read("npm", ["stage", "list", pkg.name, "--json"]) || "[]");
    return items.map((item) => ({ ...item, pkg }));
  });
}

/** The staged tarball's digest, where npm's list gives one. */
function stagedDigest(item) {
  return item.integrity ?? item.dist?.integrity ?? item.shasum ?? item.dist?.shasum;
}

function showStaged(items) {
  for (const item of items) {
    const by = item.actorType ? `${item.actor} (${item.actorType})` : (item.actor ?? "?");
    console.log(`  ${item.packageName}@${item.version}, staged ${item.createdAt ?? "?"} by ${by} (${item.id})`);
    console.log(`    ${stagedDigest(item) ?? "npm's list gives no digest; check the run that staged it"}`);
  }
}

/** Lists the versions waiting for approval on npm. */
function staged() {
  requireStaging();
  requireNpmSignIn();
  const list = inDependencyOrder(packages());
  const items = stagedVersions(list);
  if (items.length === 0) {
    console.log("\nNothing is waiting for approval on npm.");
    return;
  }
  console.log("\nWaiting for approval on npm:");
  showStaged(items);
  console.log("\nApprove them with `pnpm release:approve`.");
}

/**
 * Approves the staged versions, which publishes them. npm asks for a
 * one-time code or a browser sign-in itself, unless `--otp` gives the code.
 */
async function approve({ version: chosen, otp, yes }) {
  requireStaging();
  requireNpmSignIn();
  const list = inDependencyOrder(packages());
  const items = stagedVersions(list);
  const versions = [...new Set(items.map((item) => item.version))];
  if (items.length === 0) {
    console.log("\nNothing is waiting for approval on npm.");
    return;
  }
  const next = chosen ?? (versions.length === 1 ? versions[0] : undefined);
  if (!next) {
    throw new ReleaseError(
      `Several versions are waiting for approval (${versions.join(", ")}). Choose one, such as \`pnpm release:approve --version ${versions.at(-1)}\`.`,
    );
  }
  // Each package after the ones it depends on, so every version is installable once it's published.
  const chosenItems = list.flatMap((pkg) => items.filter((item) => item.pkg === pkg && item.version === next));
  if (chosenItems.length === 0) throw new ReleaseError(`Nothing is waiting for approval at ${next}.`);
  console.log(`\nApproving ${next}:`);
  showStaged(chosenItems);
  console.log(
    "\nCompare each digest with the one the Release workflow's run listed for it, on the run's page, before going on.",
  );
  if (!yes && !(await confirm(`\nPublish these ${chosenItems.length} packages to npm?`))) {
    throw new ReleaseError("Nothing was approved.");
  }
  for (const item of chosenItems) run("npm", ["stage", "approve", item.id, ...(otp ? ["--otp", otp] : [])]);
  console.log(
    `\nPublished ${next}. If the Release workflow is waiting, it tags the release and deploys the docs within a few minutes; if it gave up, run it again from the Actions tab.`,
  );
}

/** The value after an option, such as `--otp 123456`. */
function option(name) {
  const index = flags.indexOf(name);
  if (index === -1) return undefined;
  const value = flags[index + 1];
  if (!value || value.startsWith("--")) throw new ReleaseError(`${name} needs a value.`);
  return value;
}

const [command, ...flags] = process.argv.slice(2);
try {
  if (command === "version") version();
  else if (command === "publish") {
    await publish({ ci: flags.includes("--ci"), dryRun: flags.includes("--dry-run"), yes: flags.includes("--yes") });
  } else if (command === "wait") await wait({ minutes: Number(option("--minutes") ?? 300) });
  else if (command === "tag") tag({ dryRun: flags.includes("--dry-run") });
  else if (command === "staged") staged();
  else if (command === "approve") {
    await approve({ version: option("--version"), otp: option("--otp"), yes: flags.includes("--yes") });
  } else {
    throw new ReleaseError(
      "Run `node scripts/release.mjs` with version, publish, wait, tag, staged or approve. See the top of the script.",
    );
  }
} catch (error) {
  if (!(error instanceof ReleaseError)) throw error;
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
