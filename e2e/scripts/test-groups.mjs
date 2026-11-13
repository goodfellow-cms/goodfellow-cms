import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { SPECS_VARIABLE, specGroups, TEST_OPTIONS } from "../playwright.config.ts";

/**
 * `pnpm test:e2e`: every spec, in the groups `specGroups()` makes, one Playwright run after another, so each
 * run starts only the servers its specs use. Options given to it, such as `--project chromium`, go to every
 * run. Every group runs even when one fails, and the command fails if any did.
 */
const options = process.argv.slice(2);
// Playwright's command line run with Node itself, with no shell, which would read the filters' `^` and `|`.
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");

// The config reads the runs' arguments by the options it knows (`TEST_OPTIONS`), so check them against Playwright's
// own help first: an option an upgrade added, or one whose value changed, would otherwise start the wrong servers.
const help = spawnSync(process.execPath, [cli, "test", "--help"], { encoding: "utf8" });
if (help.status !== 0) {
  console.error(help.stderr);
  process.exit(1);
}
const listed = new Map();
for (const match of help.stdout.matchAll(/^ {2}(?:(-\w), )?(--?[\w-]+)(?: (<[^>]+>|\[[^\]]+\]))?/gm)) {
  const [, short, long, value] = match;
  const kind = !value ? "flag" : value.startsWith("[") ? "optional" : value.endsWith("...>") ? "values" : "value";
  for (const name of [short, long]) if (name) listed.set(name, kind);
}
const known = new Map(Object.entries(TEST_OPTIONS).flatMap(([kind, names]) => names.map((name) => [name, kind])));
const differ = [...new Set([...listed.keys(), ...known.keys()])].filter((name) => listed.get(name) !== known.get(name));
if (differ.length > 0) {
  console.error(
    `playwright.config.ts's TEST_OPTIONS doesn't match \`playwright test --help\` for ${differ.join(", ")}. Update it, so the servers each run starts are chosen from the right arguments.`,
  );
  process.exit(1);
}

const groups = specGroups();
const failed = [];
for (const [index, specs] of groups.entries()) {
  console.log(`\nSpecs ${index + 1} of ${groups.length}: ${specs.join(", ")}\n`);
  // Each file as a filter that matches it alone, with either slash: Playwright's filters are regular expressions
  // found anywhere in a test's path, so `blocks.spec.ts` would also match `wordpress-blocks.spec.ts`.
  const filters = specs.map((spec) => `(^|[\\\\/])tests[\\\\/]${spec.replaceAll(".", "\\.")}$`);
  // The config chooses the group's servers from the names themselves, never from the filters.
  const env = { ...process.env, [SPECS_VARIABLE]: specs.join(",") };
  const run = spawnSync(process.execPath, [cli, "test", ...filters, ...options], { stdio: "inherit", env });
  if (run.status !== 0) failed.push(index + 1);
}
if (failed.length > 0) {
  console.error(`\nSpecs ${failed.join(", ")} of ${groups.length} failed.`);
  process.exit(1);
}
