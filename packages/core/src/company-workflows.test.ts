// The company example's workflows' scripts, which sites copy, run with bash against a stand-in for wrangler, as
// GitHub's runners run them (`bash -e`, with pipefail).
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflows = join(import.meta.dirname, "../../../examples/company/.github/workflows");

/** The `run` script of the step named `step`, or of the job's last step, in a workflow's job. */
function script(workflow: string, job: string, step?: string): string {
  const steps = parse(readFileSync(join(workflows, workflow), "utf8")).jobs[job].steps as {
    name?: string;
    run?: string;
  }[];
  const found = step ? steps.find((each) => each.name === step) : steps.at(-1);
  if (!found?.run) throw new Error(`No step ${step ?? "at the end"} in ${workflow}'s ${job}.`);
  return found.run;
}

/**
 * A stand-in for `npx wrangler`, keeping what it's made in `$STATE`, with the Worker's secrets as `$SECRETS` says:
 * their list, or how listing them fails.
 */
const FAKE_NPX = `#!/usr/bin/env bash
shift
command="$*"
case "$command" in
  "d1 list --json") [ -f "$STATE/db" ] && echo '[{"uuid":"0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c","name":"acme"}]' || echo '[]';;
  "d1 create acme") touch "$STATE/db"; echo "Created";;
  "kv namespace list") echo "wrangler 4"; [ -f "$STATE/kv" ] && printf '[\\n  {"id":"0123456789abcdef0123456789abcdef","title":"acme-cache"}\\n]\\n' || echo '[]';;
  "kv namespace create acme-cache") touch "$STATE/kv"; echo "Created";;
  "secret list --format json")
    case "$SECRETS" in
      missing) echo 'X [ERROR] Worker "acme" not found.' >&2; exit 1;;
      missing-code) echo "This Worker does not exist on your account. [code: 10007]" >&2; exit 1;;
      broken) echo "X [ERROR] A request to the Cloudflare API failed." >&2; exit 1;;
      *) echo "$SECRETS";;
    esac;;
  deploy*)
    echo "deployed"
    # What the deploy gives the Worker, from the file after --secrets-file, where it's given one.
    while [ $# -gt 0 ]; do [ "$1" = --secrets-file ] && cp "$2" "$STATE/sent"; shift; done;;
  *) echo "unexpected: $command" >&2; exit 1;;
esac
`;

/** A stand-in for curl, answering Cloudflare's question about the account's workers.dev subdomain as `$SUBDOMAIN` says. */
const FAKE_CURL = `#!/usr/bin/env bash
case "$*" in
  *"/accounts/account-1/workers/subdomain"*)
    [ "$SUBDOMAIN" = none ] && { echo '{"success":false,"errors":[{"code":10007}]}'; exit 0; }
    printf '{"success":true,"result":{"subdomain":"%s"}}' "$SUBDOMAIN";;
  *) echo "unexpected: $*" >&2; exit 1;;
esac
`;

/** wrangler.jsonc as the company example has it, with the example's address or `address`. */
const wranglerJsonc = (address = "https://www.example.com") => `{
  "name": "acme",
  "kv_namespaces": [{ "binding": "VINEXT_KV_CACHE", "id": "your-kv-namespace-id" }],
  "d1_databases": [{ "binding": "DB", "database_name": "acme", "database_id": "your-database-id" }],
  "vars": { "GOODFELLOW_SITE_URL": "${address}" }
}
`;

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs a script with the stand-in first on PATH, in a folder of its own. */
function run(text: string, env: Record<string, string> = {}, wrangler = wranglerJsonc()) {
  dir = mkdtempSync(join(tmpdir(), "company-workflow-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  for (const [name, fake] of [
    ["npx", FAKE_NPX],
    ["curl", FAKE_CURL],
  ] as const) {
    writeFileSync(join(bin, name), fake);
    chmodSync(join(bin, name), 0o755);
  }
  writeFileSync(join(dir, "wrangler.jsonc"), wrangler);
  const state = join(dir, "state");
  mkdirSync(state);
  const output = join(dir, "output");
  writeFileSync(output, "");
  const result = spawnSync("bash", ["-eo", "pipefail", "-c", text.replaceAll("goodfellow-company", "acme")], {
    cwd: dir,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      STATE: state,
      GITHUB_OUTPUT: output,
      RUNNER_TEMP: dir,
      GITHUB_STEP_SUMMARY: join(dir, "summary"),
      CLOUDFLARE_API_TOKEN: "cloudflare-token",
      CLOUDFLARE_ACCOUNT_ID: "account-1",
      ...env,
    },
  });
  const sent = (() => {
    try {
      return JSON.parse(readFileSync(join(state, "sent"), "utf8")) as Record<string, string>;
    } catch {
      return undefined;
    }
  })();
  return { ...result, outputs: readFileSync(output, "utf8"), sent };
}

/** Runs a step with `npm` stood in for, in a folder with `site` as package.json and `lockfile` as package-lock.json. */
function runWith(text: string, check: string, npm: string, site: object, lockfile?: object) {
  const folder = mkdtempSync(join(tmpdir(), "company-install-"));
  try {
    const bin = join(folder, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "npm"), npm);
    chmodSync(join(bin, "npm"), 0o755);
    writeFileSync(join(folder, "package.json"), JSON.stringify(site));
    if (lockfile) writeFileSync(join(folder, "package-lock.json"), JSON.stringify(lockfile));
    const result = spawnSync("bash", ["-eo", "pipefail", "-c", text], {
      cwd: folder,
      encoding: "utf8",
      env: { PATH: `${bin}:${process.env.PATH}`, STATE: folder, CHECK: check },
    });
    let npmCalls: string[] = [];
    try {
      npmCalls = readFileSync(join(folder, "npm"), "utf8").trim().split("\n");
    } catch {
      npmCalls = [];
    }
    return { ...result, npm: npmCalls };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")("the company example's workflows", () => {
  const deploy = script("deploy.yml", "deploy");

  it("makes a session key on the first deploy, where the Worker doesn't exist yet, however wrangler says so", () => {
    for (const SECRETS of ["missing", "missing-code", '[{"name":"OTHER","type":"secret_text"}]']) {
      const result = run(deploy, { SECRETS });
      expect(result.status, `${SECRETS}: ${result.stderr}`).toBe(0);
      expect(result.sent?.BETTER_AUTH_SECRET).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    }
  });

  it("keeps the Worker's session key, and the repository's where it has one", () => {
    const kept = run(deploy, { SECRETS: '[{"name":"BETTER_AUTH_SECRET","type":"secret_text"}]' });
    expect(kept.status).toBe(0);
    expect(kept.sent).toBeUndefined();
    const given = run(deploy, { SECRETS: "broken", BETTER_AUTH_SECRET: "the repository's", GOODFELLOW_GIT_TOKEN: "t" });
    expect(given.status).toBe(0);
    expect(given.sent).toEqual({ BETTER_AUTH_SECRET: "the repository's", GOODFELLOW_GIT_TOKEN: "t" });
  });

  it("stops rather than replace a session key it couldn't see", () => {
    const result = run(deploy, { SECRETS: "broken" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Couldn't read the Worker's secrets");
    expect(result.stdout).not.toContain("deployed");
  });

  it("writes a lockfile for its own run where the site has none, or package.json has changed, and installs from it", () => {
    const steps = parse(readFileSync(join(workflows, "setup-cloudflare.yml"), "utf8")).jobs.create.steps as {
      name?: string;
      run?: string;
      env?: Record<string, string>;
      with?: Record<string, unknown>;
    }[];
    // setup-node's cache needs a lockfile, so it isn't asked for.
    expect(steps.find((step) => step.with?.["node-version"])?.with?.cache).toBeUndefined();
    const install = steps.find((step) => step.name === "Install wrangler");
    if (!install?.run || !install.env?.CHECK) throw new Error("No Install wrangler step.");
    // A stand-in for npm, saying what it was asked.
    const npm = '#!/usr/bin/env bash\necho "npm $*" >> "$STATE/npm"\n';
    const site = { name: "acme", devDependencies: { wrangler: "4.0.0" } };
    // Without a lockfile: one is written, with releases at least 3 days old and no scripts, then installed from.
    let result = runWith(install.run, install.env.CHECK, npm, site);
    expect(result.status, result.stderr).toBe(0);
    expect(result.npm).toEqual([
      expect.stringMatching(/^npm install --package-lock-only --ignore-scripts --no-audit --no-fund --before=\d{4}-/),
      "npm ci",
    ]);
    // With one that has package.json's packages: only installed from.
    result = runWith(install.run, install.env.CHECK, npm, site, { packages: { "": site } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.npm).toEqual(["npm ci"]);
  });

  const create = script("setup-cloudflare.yml", "create", "Make the database and the cache");

  it("makes the database and the cache, says their ids, and keeps the site's own address", () => {
    const made = run(create, {}, wranglerJsonc("https://www.acme.example"));
    expect(made.status, made.stderr).toBe(0);
    expect(made.outputs).toBe("database=0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c\nkv=0123456789abcdef0123456789abcdef\n");
  });

  it("gives a site without an address the Worker's own, on the account's workers.dev subdomain", () => {
    const made = run(create, { SUBDOMAIN: "acme-co" });
    expect(made.status, made.stderr).toBe(0);
    expect(made.outputs).toContain("address=https://acme.acme-co.workers.dev\n");
    // An account without one, or an answer that isn't a subdomain, says what to do.
    for (const SUBDOMAIN of ["none", "evil.example/x"]) {
      const refused = run(create, { SUBDOMAIN });
      expect(refused.status, SUBDOMAIN).not.toBe(0);
      expect(refused.stdout).toContain("Choose one under Workers & Pages");
      expect(refused.outputs).not.toContain("address=");
    }
  });

  it("writes the ids and the address into wrangler.jsonc, and says where the site will be", () => {
    const save = script("setup-cloudflare.yml", "save", "Name them in wrangler.jsonc");
    // A checkout of the code, whose pushes go to a repository of its own.
    const setUp = `git init -q --bare remote.git && git init -q -b main . && git remote add origin remote.git
      git -c user.name=x -c user.email=x@example.org commit -q --allow-empty -m start && git add wrangler.jsonc
      git -c user.name=x -c user.email=x@example.org commit -q -m wrangler && git push -q origin main
      git branch --set-upstream-to=origin/main main >/dev/null`;
    // And a change that reached the branch while the first job ran.
    const moved = `git clone -q -b main remote.git other && git -C other -c user.name=y -c user.email=y@example.org commit -q --allow-empty -m meanwhile && git -C other push -q origin main`;
    const saved = run(`${setUp}\n${moved}\n${save}`, {
      DATABASE: "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c",
      KV: "0123456789abcdef0123456789abcdef",
      ADDRESS: "https://acme.acme-co.workers.dev",
      GITHUB_REF_NAME: "main",
    });
    expect(saved.status, saved.stderr).toBe(0);
    const log = spawnSync("git", ["--git-dir", join(dir, "remote.git"), "log", "--format=%s", "main"], {
      encoding: "utf8",
    }).stdout;
    expect(log).toBe("Name the site's Cloudflare database and cache\nmeanwhile\nwrangler\nstart\n");
    const pushed = spawnSync("git", ["--git-dir", join(dir, "remote.git"), "show", "main:wrangler.jsonc"], {
      encoding: "utf8",
    }).stdout;
    expect(pushed).toContain('"database_id": "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c"');
    expect(pushed).toContain('"id": "0123456789abcdef0123456789abcdef"');
    expect(pushed).toContain('"GOODFELLOW_SITE_URL": "https://acme.acme-co.workers.dev"');
    expect(readFileSync(join(dir, "summary"), "utf8")).toContain("https://acme.acme-co.workers.dev/setup/");
    // Anything but an address on workers.dev is refused, whatever the job before said.
    const refused = run(`${setUp}\n${save}`, {
      DATABASE: "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c",
      KV: "0123456789abcdef0123456789abcdef",
      ADDRESS: 'https://evil.example" x',
    });
    expect(refused.status).not.toBe(0);
  });
});
