// Builds Goodfellow's demo (/demo/admin/ on the docs site): the parish example as
// `npm create goodfellow` makes it, with the recommended blocks and the Gutenberg
// plugin, in demo mode. .github/workflows/docs.yml runs it after building the docs,
// from the same release, so the demo always has the release the docs describe.
//
//   node scripts/demo.mjs <base path, such as /goodfellow-cms/demo/> <folder to write it to>
//
// The site's packages come from npm, so the release must be published first.
// GOODFELLOW_SITE_URL, if set, is the demo's address, for its feeds and sitemap.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findPlugin, ScaffoldError } from "create-goodfellow";

const PLUGINS = ["goodfellow-plugin-gutenberg"];

const [base, out] = process.argv.slice(2);
if (!base || !out) {
  console.error("Usage: node scripts/demo.mjs <base path> <folder>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const createGoodfellow = dirname(require.resolve("create-goodfellow/package.json"));
const versions = JSON.parse(readFileSync(join(createGoodfellow, "templates/versions.json"), "utf8"));

/** Runs a command, which is a .cmd file on Windows for npm and npx, started through a shell. */
function run(command, args, cwd, env = {}) {
  const windows = process.platform === "win32";
  execFileSync(windows ? `${command} ${args.join(" ")}` : command, windows ? [] : args, {
    cwd,
    stdio: "inherit",
    shell: windows,
    env: { ...process.env, ...env },
  });
}

// A plugin can't be installed in its first days, or once no release says it works with
// this one, as for any site. The demo is then built without it, rather than not at all.
const plugins = [];
for (const name of PLUGINS) {
  try {
    await findPlugin(name, versions["@goodfellow-cms/core"] ?? "");
    plugins.push(name);
  } catch (error) {
    if (!(error instanceof ScaffoldError)) throw error;
    const message = `The demo is built without ${name}: ${error.message}`;
    console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
  }
}

const dir = mkdtempSync(join(tmpdir(), "goodfellow-demo-"));
try {
  const site = join(dir, "demo");
  run(
    process.execPath,
    [
      join(createGoodfellow, "bin/create-goodfellow.js"),
      site,
      "--template",
      "parish",
      "--blocks",
      "recommended",
      ...plugins.flatMap((name) => ["--plugin", name]),
      "--no-git",
      "--no-install",
      "--yes",
    ],
    dir,
  );
  const configPath = join(site, "goodfellow.config.tsx");
  const config = readFileSync(configPath, "utf8");
  if (!config.includes("defineConfig({\n")) throw new Error("The parish example's config has no defineConfig({ line.");
  writeFileSync(configPath, config.replace("defineConfig({\n", "defineConfig({\n  demo: true,\n"));
  run("npm", ["install", "--no-audit", "--no-fund"], site);
  // Kept out of search engines: it's the parish's made-up content, and changes all the time.
  run("npx", ["goodfellow", "build", "--base", base], site, { GOODFELLOW_NO_INDEX: "true" });
  rmSync(resolve(out), { recursive: true, force: true });
  cpSync(join(site, "dist"), resolve(out), { recursive: true });
  console.log(`Built the demo${plugins.length ? ` with ${plugins.join(", ")}` : ""} into ${out}.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
