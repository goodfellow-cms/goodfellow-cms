#!/usr/bin/env node
// Run by sites' lockfile jobs, from npm itself (`npm exec --package=@goodfellow-cms/core@…`), never from the
// site's own packages: writes package-lock.json where a plugin was installed before it was three days old,
// once its provenance checks out, and otherwise fails, publishing nothing.
import { EarlyInstallError, writeEarlyLockfile } from "../dist/node.js";

try {
  const { written, early } = await writeEarlyLockfile(process.cwd());
  if (!written) console.log("package-lock.json already has every package package.json names.");
  for (const install of early) {
    console.log(
      `Installed ${install.name} ${install.release} before it was three days old: it was built by ${install.early.repository} (${install.early.workflow}), as ${install.early.from} was.`,
    );
  }
} catch (error) {
  if (error instanceof EarlyInstallError) {
    for (const found of error.problems) console.log(`::error::${found.message}`);
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
