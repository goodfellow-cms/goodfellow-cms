// Copies the starter and the examples into templates/ (the company example for full-stack sites), with the version of every
// Goodfellow package, so the published create-goodfellow has everything it copies.
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordRelease } from "../../worker/deploy/update.mjs";
import { bundleTemplate } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "../../..");
const out = join(here, "../templates");

// The company example is for full-stack sites (--server cloudflare). Each is copied from the files git keeps, never
// the folder as it is, since a developer's copy holds build output and secrets that .gitignore leaves out (.env.local
// for trying plugins, .dev.vars), and the copy stops where anything that looks like a secret is still there.
const sources = {
  starter: "templates/starter",
  parish: "examples/parish",
  next: "templates/next",
  company: "examples/company",
};

rmSync(out, { recursive: true, force: true });
for (const [name, source] of Object.entries(sources)) {
  await bundleTemplate(repo, source, join(out, name));
}

// The block registry, so new sites can start with the recommended blocks without downloading them.
cpSync(join(repo, "packages/registry/r"), join(out, "registry"), { recursive: true });

// The token broker's released page, for a site's sign-in page of its own (--broker).
cpSync(join(repo, "packages/broker/site"), join(out, "broker"), { recursive: true });

// The sign-in worker as the Deploy to Cloudflare button deploys it, which copies of it update themselves from.
cpSync(join(repo, "packages/worker/deploy"), join(out, "sign-in"), { recursive: true });
cpSync(join(repo, "packages/worker/dist/bundle/worker.js"), join(out, "sign-in", "worker.js"));
// The release it comes from, so a new copy's first update never takes an older one.
const signInPackage = join(out, "sign-in", "package.json");
const ownVersion = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
writeFileSync(signInPackage, recordRelease(readFileSync(signInPackage, "utf8"), ownVersion));

const versions = {};
for (const dir of readdirSync(join(repo, "packages"))) {
  const pkg = JSON.parse(readFileSync(join(repo, "packages", dir, "package.json"), "utf8"));
  if (!pkg.private) versions[pkg.name] = pkg.version;
}
writeFileSync(join(out, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`);
