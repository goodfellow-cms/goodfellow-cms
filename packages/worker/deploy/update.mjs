// Brings this copy of the sign-in service up to date with the newest release of Goodfellow, whose
// create-goodfellow package carries it on npm (templates/sign-in/). The update workflow runs it each
// week; Cloudflare deploys the change once it's pushed. It keeps your Worker's name, takes only a
// release that's been out a day, as Goodfellow's site updates do, never past npm's latest tag or a
// deprecated one, never goes back to an older one, and takes it only where npm's provenance says
// Goodfellow's own release workflow built it.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 24 * 60 * 60 * 1000;
/** Where every release of Goodfellow is built. */
export const RELEASE_REPOSITORY = "https://github.com/goodfellow-cms/goodfellow-cms";
export const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";

/** A release's version as numbers, or `undefined` for anything but `x.y.z`. */
function parts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "");
  return match ? match.slice(1).map(Number) : undefined;
}

function compare(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * The release to take, from npm's publish times: the highest version that's been out a day, no higher than the
 * `latest` tag where npm names one, and not deprecated, so a release Goodfellow takes back is never taken; never one
 * lower than `current`, the release this copy has, where it knows it. `undefined` where there's none to take.
 */
export function chooseRelease(time, current, now = Date.now(), { latest, deprecated = [] } = {}) {
  const takenBack = new Set(deprecated);
  const old = Object.entries(time ?? {})
    .filter(([version, at]) => parts(version) && now - Date.parse(at) > DAY && !takenBack.has(version))
    .filter(([version]) => !parts(latest) || compare(version, latest) <= 0)
    .map(([version]) => version)
    .sort(compare);
  const highest = old.at(-1);
  if (!highest) return undefined;
  return parts(current) && compare(highest, current) < 0 ? current : highest;
}

/**
 * Why the release's provenance doesn't show Goodfellow's release workflow built the packed file, or `undefined`
 * where it does: `answer` is npm's attestations for the release, and `integrity` the packed file's (`sha512-…`).
 * Its signature is checked by `npm audit signatures`; this checks what it says.
 */
export function provenanceProblem(answer, integrity) {
  for (const attestation of answer?.attestations ?? []) {
    if (attestation?.predicateType !== SLSA_PROVENANCE) continue;
    let statement;
    try {
      statement = JSON.parse(Buffer.from(attestation.bundle?.dsseEnvelope?.payload ?? "", "base64").toString("utf8"));
    } catch {
      return "its provenance can't be read";
    }
    const workflow = statement?.predicate?.buildDefinition?.externalParameters?.workflow;
    const repository = String(workflow?.repository ?? "")
      .replace(/\.git$/, "")
      .toLowerCase();
    if (repository !== RELEASE_REPOSITORY) return `it was built by ${workflow?.repository ?? "an unknown repository"}`;
    if (workflow?.path !== RELEASE_WORKFLOW) return `it was built by ${workflow?.path ?? "an unknown workflow"}`;
    const sha512 = Buffer.from(String(integrity).replace(/^sha512-/, ""), "base64").toString("hex");
    if (!(statement.subject ?? []).some((subject) => subject?.digest?.sha512 === sha512)) {
      return "its provenance is for another file";
    }
    return undefined;
  }
  return "it has no provenance";
}

function main() {
  const npm = (args, cwd) =>
    execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
      encoding: "utf8",
      shell: process.platform === "win32",
      ...(cwd && { cwd }),
    });
  const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const own = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  // npm's record of the package: when each release was published, its tags, and which are deprecated.
  const info = JSON.parse(
    execFileSync("curl", ["-fsSL", "https://registry.npmjs.org/create-goodfellow"], { encoding: "utf8" }),
  );
  const deprecated = Object.entries(info.versions ?? {})
    .filter(([, manifest]) => manifest?.deprecated)
    .map(([version]) => version);
  const release = chooseRelease(info.time, own.goodfellowRelease, Date.now(), {
    latest: info["dist-tags"]?.latest,
    deprecated,
  });
  if (!release) throw new Error("npm lists no release of create-goodfellow old enough to use.");
  if (release === own.goodfellowRelease) {
    console.log(`Already up to date with Goodfellow ${release}.`);
    return;
  }

  const work = mkdtempSync(join(tmpdir(), "goodfellow-sign-in-"));
  const [packed] = JSON.parse(
    npm(["pack", `create-goodfellow@${release}`, "--pack-destination", work, "--json", "--ignore-scripts"]),
  );
  // npm checks the packed file's registry signature and provenance (installed alone, as packed, so another
  // package's signatures never stop an update), and what the provenance says is checked here.
  const verify = join(work, "verify");
  const installed = join(verify, "node_modules", "create-goodfellow");
  mkdirSync(installed, { recursive: true });
  execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", installed, "--strip-components=1"]);
  writeFileSync(
    join(verify, "package.json"),
    `${JSON.stringify({ private: true, dependencies: { "create-goodfellow": release } }, null, 2)}\n`,
  );
  const entry = {
    version: release,
    resolved: `https://registry.npmjs.org/create-goodfellow/-/${packed.filename}`,
    integrity: packed.integrity,
  };
  writeFileSync(
    join(verify, "package-lock.json"),
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        requires: true,
        packages: { "": { dependencies: { "create-goodfellow": release } }, "node_modules/create-goodfellow": entry },
      },
      null,
      2,
    )}\n`,
  );
  npm(["audit", "signatures"], verify);
  const url = JSON.parse(npm(["view", `create-goodfellow@${release}`, "dist.attestations.url", "--json"]));
  const problem = provenanceProblem(
    JSON.parse(execFileSync("curl", ["-fsSL", url], { encoding: "utf8" })),
    packed.integrity,
  );
  if (problem) throw new Error(`create-goodfellow ${release} isn't taken, since ${problem}.`);

  execFileSync("tar", ["-xzf", join(work, packed.filename), "-C", work]);
  const from = join(work, "package", "templates", "sign-in");
  if (!existsSync(join(from, "worker.js"))) {
    console.log(`create-goodfellow ${release} doesn't carry the sign-in service yet.`);
    return;
  }
  for (const file of ["worker.js", "deploy.mjs", "update.mjs", "package.json", "package-lock.json", "README.md"]) {
    if (existsSync(join(from, file))) cpSync(join(from, file), join(here, file));
  }
  if (existsSync(join(from, "_npmrc"))) cpSync(join(from, "_npmrc"), join(here, ".npmrc"));
  // The release this copy has now, so a later run never goes back to an older one.
  const updated = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
  writeFileSync(join(here, "package.json"), `${JSON.stringify({ ...updated, goodfellowRelease: release }, null, 2)}\n`);
  // The release's settings, with the name you deployed it under.
  const mine = JSON.parse(readFileSync(join(here, "wrangler.json"), "utf8"));
  const theirs = JSON.parse(readFileSync(join(from, "wrangler.json"), "utf8"));
  writeFileSync(join(here, "wrangler.json"), `${JSON.stringify({ ...theirs, name: mine.name }, null, 2)}\n`);
  console.log(`Up to date with Goodfellow ${release}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
