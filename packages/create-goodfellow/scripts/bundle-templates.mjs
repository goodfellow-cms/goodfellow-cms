// Copies the starter and the examples into templates/ (the company example for full-stack sites), with the version of every
// Goodfellow package, so the published create-goodfellow has everything it copies.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyTemplate } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const out = join(here, "../templates");

const sources = { starter: "templates/starter", parish: "examples/parish", next: "templates/next" };

rmSync(out, { recursive: true, force: true });
for (const [name, source] of Object.entries(sources)) {
  await copyTemplate(join(repo, source), join(out, name), { bundling: true });
}

// The company example, for full-stack sites (--server cloudflare): only the files git keeps, since its build writes
// files into its folder that .gitignore leaves out, and a developer's copy holds secrets (.dev.vars, .env.local).
const tracked = mkdtempSync(join(tmpdir(), "goodfellow-company-"));
try {
  const paths = execFileSync("git", ["ls-files", "-z", "--", "examples/company"], { cwd: repo, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const path of paths) {
    const to = join(tracked, path.slice("examples/company/".length));
    mkdirSync(dirname(to), { recursive: true });
    cpSync(join(repo, path), to);
  }
  await copyTemplate(tracked, join(out, "company"), { bundling: true });
} finally {
  rmSync(tracked, { recursive: true, force: true });
}

// The block registry, so new sites can start with the recommended blocks without downloading them.
cpSync(join(repo, "packages/registry/r"), join(out, "registry"), { recursive: true });

// The token broker's released page, for a site's sign-in page of its own (--broker).
cpSync(join(repo, "packages/broker/site"), join(out, "broker"), { recursive: true });

// The sign-in worker as the Deploy to Cloudflare button deploys it, which copies of it update themselves from.
cpSync(join(repo, "packages/worker/deploy"), join(out, "sign-in"), { recursive: true });
cpSync(join(repo, "packages/worker/dist/bundle/worker.js"), join(out, "sign-in", "worker.js"));

const versions = {};
for (const dir of readdirSync(join(repo, "packages"))) {
  const pkg = JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8"));
  if (!pkg.private) versions[pkg.name] = pkg.version;
}
writeFileSync(join(out, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
