// Brings this copy of the sign-in service up to date with the newest release of Goodfellow, whose
// create-goodfellow package carries it on npm (templates/sign-in/). The update workflow runs it each
// week; Cloudflare deploys the change once it's pushed. It keeps your Worker's name, takes only a
// release that's been out a day, as Goodfellow's site updates do, never past npm's latest tag or a
// deprecated one, never goes back to an older one, and takes it only where npm's provenance, whose
// Sigstore signature it checks, says Goodfellow's own release workflow built it.
import { execFileSync } from "node:child_process";
import { verify, X509Certificate } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DAY = 24 * 60 * 60 * 1000;
/** Where every release of Goodfellow is built. */
export const RELEASE_REPOSITORY = "https://github.com/goodfellow-cms/goodfellow-cms";
export const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";
/**
 * Sigstore's certificate authority (Fulcio), which signs the certificates of GitHub's workflows: its intermediate and
 * root, from Sigstore's trusted root (`trusted_root.json`), valid until 2031.
 */
export const FULCIO_CHAIN = `-----BEGIN CERTIFICATE-----
MIICGjCCAaGgAwIBAgIUALnViVfnU0brJasmRkHrn/UnfaQwCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MjA0MTMyMDA2MTVaFw0zMTEwMDUxMzU2NThaMDcxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjEeMBwGA1UEAxMVc2lnc3RvcmUtaW50ZXJtZWRpYXRlMHYwEAYHKoZIzj0C
AQYFK4EEACIDYgAE8RVS/ysH+NOvuDZyPIZtilgUF9NlarYpAd9HP1vBBH1U5CV7
7LSS7s0ZiH4nE7Hv7ptS6LvvR/STk798LVgMzLlJ4HeIfF3tHSaexLcYpSASr1kS
0N/RgBJz/9jWCiXno3sweTAOBgNVHQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYB
BQUHAwMwEgYDVR0TAQH/BAgwBgEB/wIBADAdBgNVHQ4EFgQU39Ppz1YkEZb5qNjp
KFWixi4YZD8wHwYDVR0jBBgwFoAUWMAeX5FFpWapesyQoZMi0CrFxfowCgYIKoZI
zj0EAwMDZwAwZAIwPCsQK4DYiZYDPIaDi5HFKnfxXx6ASSVmERfsynYBiX2X6SJR
nZU84/9DZdnFvvxmAjBOt6QpBlc4J/0DxvkTCqpclvziL6BCCPnjdlIB3Pu3BxsP
mygUY7Ii2zbdCdliiow=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIB9zCCAXygAwIBAgIUALZNAPFdxHPwjeDloDwyYChAO/4wCgYIKoZIzj0EAwMw
KjEVMBMGA1UEChMMc2lnc3RvcmUuZGV2MREwDwYDVQQDEwhzaWdzdG9yZTAeFw0y
MTEwMDcxMzU2NTlaFw0zMTEwMDUxMzU2NThaMCoxFTATBgNVBAoTDHNpZ3N0b3Jl
LmRldjERMA8GA1UEAxMIc2lnc3RvcmUwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAAT7
XeFT4rb3PQGwS4IajtLk3/OlnpgangaBclYpsYBr5i+4ynB07ceb3LP0OIOZdxex
X69c5iVuyJRQ+Hz05yi+UF3uBWAlHpiS5sh0+H2GHE7SXrk1EC5m1Tr19L9gg92j
YzBhMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRY
wB5fkUWlZql6zJChkyLQKsXF+jAfBgNVHSMEGDAWgBRYwB5fkUWlZql6zJChkyLQ
KsXF+jAKBggqhkjOPQQDAwNpADBmAjEAj1nHeXZp+13NWBNa+EDsDP8G1WWg1tCM
WP/WHPqpaVo0jhsweNFZgSs0eE7wYI4qAjEA2WB9ot98sIkoF3vZYdd3/VtWB5b9
TNMea7Ix/stJ5TfcLLeABLE4BNJOsQ4vnBHJ
-----END CERTIFICATE-----`;

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
 * lower than `current`, the release this copy has, where it knows it. A `latest` that's a prerelease (`0.14.0-rc.1`)
 * allows only what comes before it, and one that isn't a version at all allows nothing. `undefined` where there's
 * none to take.
 */
export function chooseRelease(time, current, now = Date.now(), { latest, deprecated = [] } = {}) {
  const takenBack = new Set(deprecated);
  const ceiling = latest === undefined ? undefined : /^(\d+\.\d+\.\d+)(-[0-9A-Za-z.-]+)?$/.exec(latest);
  if (latest !== undefined && !ceiling) return undefined;
  const belowCeiling = (version) =>
    !ceiling || (ceiling[2] ? compare(version, ceiling[1]) < 0 : compare(version, ceiling[1]) <= 0);
  const old = Object.entries(time ?? {})
    .filter(([version, at]) => parts(version) && now - Date.parse(at) > DAY && !takenBack.has(version))
    .filter(([version]) => belowCeiling(version))
    .map(([version]) => version)
    .sort(compare);
  const highest = old.at(-1);
  if (!highest) return undefined;
  return parts(current) && compare(highest, current) < 0 ? current : highest;
}

/**
 * A copy's package.json text with the Goodfellow release it now has, which `chooseRelease()` never goes below:
 * written by each update, and by create-goodfellow's build for the copy it carries, so a new copy starts with it.
 */
export function recordRelease(packageJson, release) {
  return `${JSON.stringify({ ...JSON.parse(packageJson), goodfellowRelease: release }, null, 2)}\n`;
}

/**
 * Why a Sigstore bundle wasn't signed by Goodfellow's release workflow, or `undefined` where it was: its DSSE
 * signature verifies with the bundle's certificate, which names the workflow and was issued through `chain`.
 * The certificate's validity, ten minutes around the signing, isn't checked, since only the transparency log says
 * when that was; the statement it signs names the packed file's digest, so an old one can't vouch for a new file.
 */
export function bundleProblem(bundle, chain = FULCIO_CHAIN) {
  try {
    const leaf = new X509Certificate(Buffer.from(bundle?.verificationMaterial?.certificate?.rawBytes ?? "", "base64"));
    const workflow = `URI:${RELEASE_REPOSITORY}/${RELEASE_WORKFLOW}@`;
    if (!(leaf.subjectAltName ?? "").split(", ").some((name) => name.startsWith(workflow))) {
      return "its provenance wasn't signed by Goodfellow's release workflow";
    }
    // Up the chain, each certificate issued and signed by the next, ending at the root, which signs itself.
    const authorities = (chain.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
      (pem) => new X509Certificate(pem),
    );
    let current = leaf;
    for (const authority of authorities) {
      if (!current.checkIssued(authority) || !current.verify(authority.publicKey)) {
        return "its provenance's certificate isn't Sigstore's";
      }
      current = authority;
    }
    if (authorities.length === 0 || !current.checkIssued(current) || !current.verify(current.publicKey)) {
      return "its provenance's certificate isn't Sigstore's";
    }
    const envelope = bundle.dsseEnvelope;
    const payload = Buffer.from(envelope.payload, "base64");
    // DSSE's pre-authentication encoding, which is what's signed.
    const signed = Buffer.concat([
      Buffer.from(`DSSEv1 ${Buffer.byteLength(envelope.payloadType)} ${envelope.payloadType} ${payload.length} `),
      payload,
    ]);
    const signature = Buffer.from(envelope.signatures?.[0]?.sig ?? "", "base64");
    if (!verify("sha256", signed, leaf.publicKey, signature)) return "its provenance's signature doesn't verify";
    return undefined;
  } catch {
    return "its provenance's signature can't be checked";
  }
}

/**
 * Why the release's provenance doesn't show Goodfellow's release workflow built the packed file, or `undefined`
 * where it does: `answer` is npm's attestations for the release, and `integrity` the packed file's (`sha512-…`).
 * The statement's signature and certificate are checked here (`bundleProblem()`) before anything it says is read,
 * since it's fetched apart from what `npm audit signatures` checks.
 */
export function provenanceProblem(answer, integrity, chain = FULCIO_CHAIN) {
  for (const attestation of answer?.attestations ?? []) {
    if (attestation?.predicateType !== SLSA_PROVENANCE) continue;
    const unsigned = bundleProblem(attestation.bundle, chain);
    if (unsigned) return unsigned;
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
  writeFileSync(join(here, "package.json"), recordRelease(readFileSync(join(here, "package.json"), "utf8"), release));
  // The release's settings, with the name you deployed it under.
  const mine = JSON.parse(readFileSync(join(here, "wrangler.json"), "utf8"));
  const theirs = JSON.parse(readFileSync(join(from, "wrangler.json"), "utf8"));
  writeFileSync(join(here, "wrangler.json"), `${JSON.stringify({ ...theirs, name: mine.name }, null, 2)}\n`);
  console.log(`Up to date with Goodfellow ${release}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
