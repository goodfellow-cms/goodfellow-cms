// Packs the starters for the setup page (/new-site), which creates sites in the
// browser: each template's files, the block registry for "Recommended" blocks,
// the token broker's page, and the versions of Goodfellow's packages, all from create-goodfellow's
// bundled copy, so the page makes the same sites as `npm create goodfellow`.
//
// With GOODFELLOW_STARTER_LOCKFILES=1, as .github/workflows/docs.yml sets, it
// also writes each starter's package-lock.json, which the sites' deploy setups
// need for `npm ci`. That needs the versions to be on npm, so it's off otherwise.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { sitePackageJson } from "@goodfellow-cms/core";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const bundled = join(dirname(require.resolve("create-goodfellow/package.json")), "templates");
const out = join(here, "../public/starters");
const withLockfiles = process.env.GOODFELLOW_STARTER_LOCKFILES === "1";

function filesIn(dir) {
  return readdirSync(dir, { recursive: true })
    .map((file) => join(dir, file))
    .filter((file) => statSync(file).isFile());
}

/** Text as it is, and anything that isn't UTF-8 as base64. */
function encode(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { base64: Buffer.from(bytes).toString("base64") };
  }
}

/** Runs npm, which is a .cmd file on Windows, started through a shell. */
function npm(args, cwd) {
  const windows = process.platform === "win32";
  execFileSync(windows ? `npm ${args.join(" ")}` : "npm", windows ? [] : args, {
    cwd,
    stdio: "inherit",
    shell: windows,
  });
}

function lockfile(packageJson) {
  const dir = mkdtempSync(join(tmpdir(), "goodfellow-starter-"));
  try {
    writeFileSync(join(dir, "package.json"), packageJson);
    npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], dir);
    return readFileSync(join(dir, "package-lock.json"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const versions = JSON.parse(readFileSync(join(bundled, "versions.json"), "utf8"));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(bundled, "registry"), join(out, "registry"), { recursive: true });

for (const name of ["starter", "parish", "next"]) {
  const dir = join(bundled, name);
  const files = Object.fromEntries(
    filesIn(dir).map((file) => [relative(dir, file).split(sep).join("/"), encode(readFileSync(file))]),
  );
  const starter = { versions, files };
  if (withLockfiles) {
    // Named "my-site" here: the page puts the new site's own name in its copy.
    starter.lockfile = lockfile(sitePackageJson(files["package.json"], "my-site", versions));
  }
  writeFileSync(join(out, `${name}.json`), JSON.stringify(starter));
}
// The token broker's released page, for a site's sign-in page of its own.
const broker = join(bundled, "broker");
writeFileSync(
  join(out, "broker.json"),
  JSON.stringify({
    files: Object.fromEntries(
      filesIn(broker).map((file) => [relative(broker, file).split(sep).join("/"), encode(readFileSync(file))]),
    ),
  }),
);
console.log(`Packed the starters into public/starters${withLockfiles ? ", with their lockfiles" : ""}.`);
