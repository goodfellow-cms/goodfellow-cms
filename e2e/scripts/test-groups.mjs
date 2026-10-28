import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { specGroups } from "../playwright.config.ts";

/**
 * `pnpm test:e2e`: every spec, in the groups `specGroups()` makes, one Playwright run after another, so each
 * run starts only the servers its specs use. Options given to it, such as `--project chromium`, go to every
 * run. Every group runs even when one fails, and the command fails if any did.
 */
const options = process.argv.slice(2);
// Playwright's command line run with Node itself, with no shell, which would read the filters' `^` and `|`.
const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const groups = specGroups();
const failed = [];
for (const [index, specs] of groups.entries()) {
  console.log(`\nSpecs ${index + 1} of ${groups.length}: ${specs.join(", ")}\n`);
  // Each file as a filter that matches it alone, with either slash: Playwright's filters are regular expressions
  // found anywhere in a test's path, so `blocks.spec.ts` would also match `wordpress-blocks.spec.ts`.
  const filters = specs.map((spec) => `(^|[\\\\/])tests[\\\\/]${spec.replaceAll(".", "\\.")}$`);
  const run = spawnSync(process.execPath, [cli, "test", ...filters, ...options], { stdio: "inherit" });
  if (run.status !== 0) failed.push(index + 1);
}
if (failed.length > 0) {
  console.error(`\nSpecs ${failed.join(", ")} of ${groups.length} failed.`);
  process.exit(1);
}
