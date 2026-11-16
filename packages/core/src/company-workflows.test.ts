// The company example's workflows' scripts, which sites copy, run with bash against a stand-in for wrangler, as
// GitHub's runners run them (`bash -e`, with pipefail).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

/**
 * A stand-in for curl, answering Cloudflare's API: the account's workers.dev subdomain as \`$SUBDOMAIN\` says, the
 * accounts the token reaches as \`$ACCOUNTS\` lists them, the zone \`$ZONE\` names, the Worker's domains as
 * \`$DOMAINS\` lists them, and connecting one (kept in \`$STATE/put\`) as \`$PUT\` answers.
 */
const FAKE_CURL = `#!/usr/bin/env bash
echo "$*" >> "$STATE/curl"
case "$*" in
  *"/workers/subdomain"*)
    [ "$SUBDOMAIN" = none ] && { echo '{"success":false,"errors":[{"code":10007}]}'; exit 0; }
    printf '{"success":true,"result":{"subdomain":"%s"}}' "$SUBDOMAIN";;
  *"-X PUT"*"/workers/domains"*)
    while [ $# -gt 0 ]; do [ "$1" = --data ] && printf '%s' "$2" > "$STATE/put"; shift; done
    if [ -n "$PUT" ]; then echo "$PUT"; else echo '{"success":true,"result":{}}'; fi;;
  *"/workers/domains?hostname="*) printf '{"success":true,"result":%s}' "\${DOMAINS:-[]}";;
  *"/zones?name=$ZONE&"*) echo '{"success":true,"result":[{"id":"9a7b5c3d1e0f2a4b6c8d0e1f2a3b4c5d"}]}';;
  *"/zones?name="*) echo '{"success":true,"result":[]}';;
  *"/client/v4/accounts") printf '{"success":true,"result":%s}' "\${ACCOUNTS:-[]}";;
  *) echo "unexpected: $*" >&2; exit 1;;
esac
`;

/** A stand-in for gh, saying main's newest commit is \`$HEAD\`. */
const FAKE_GH = `#!/usr/bin/env bash
case "$*" in
  "api repos/someone/acme/commits/main --jq .sha") echo "$HEAD";;
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
    ["gh", FAKE_GH],
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
      GITHUB_REPOSITORY: "someone/acme",
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
  const kept = (name: string) => {
    try {
      return readFileSync(join(state, name), "utf8");
    } catch {
      return "";
    }
  };
  let summary = "";
  try {
    summary = readFileSync(join(dir, "summary"), "utf8");
  } catch {
    summary = "";
  }
  return { ...result, outputs: readFileSync(output, "utf8"), sent, put: kept("put"), curl: kept("curl"), summary };
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
  const deploy = script("deploy.yml", "deploy", "Deploy");

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
    // The publishing app's id and key go up with the rest.
    const app = run(deploy, {
      SECRETS: '[{"name":"BETTER_AUTH_SECRET","type":"secret_text"}]',
      GOODFELLOW_APP_ID: "5001",
      GOODFELLOW_APP_KEY: "-----BEGIN RSA PRIVATE KEY-----",
    });
    expect(app.status, app.stderr).toBe(0);
    expect(app.sent).toEqual({ GOODFELLOW_APP_ID: "5001", GOODFELLOW_APP_KEY: "-----BEGIN RSA PRIVATE KEY-----" });
  });

  it("puts only the main branch's newest commit online", () => {
    const ready = script("deploy.yml", "ready");
    const site = wranglerJsonc().replace("your-database-id", "d").replace("your-kv-namespace-id", "k");
    expect(run(ready, { GITHUB_REF: "refs/heads/main" }, site).outputs).toBe("ready=true\n");
    const other = run(ready, { GITHUB_REF: "refs/heads/someone-else" }, site);
    expect(other.outputs).toBe("ready=false\n");
    expect(other.stdout).toContain("Only the main branch is put online");
    // A run started again for an older commit deploys nothing.
    const head = script("deploy.yml", "deploy", "Check it's main's newest commit");
    expect(run(head, { HEAD: "abc123", DEPLOYING: "abc123" }).outputs).toBe("current=true\n");
    const older = run(head, { HEAD: "def456", DEPLOYING: "abc123" });
    expect(older.status).toBe(0);
    expect(older.outputs).toBe("current=false\n");
  });

  const connect = script("deploy.yml", "deploy", "Connect the domain");
  const ACCOUNT = "0123456789abcdef0123456789abcdef";

  it("gives the Worker the site's domain, where its zone is on the account, once", () => {
    const site = wranglerJsonc("https://www.acme.example");
    const made = run(connect, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ZONE: "acme.example" }, site);
    expect(made.status, made.stderr).toBe(0);
    expect(JSON.parse(made.put)).toEqual({
      hostname: "www.acme.example",
      service: "acme",
      zone_id: "9a7b5c3d1e0f2a4b6c8d0e1f2a3b4c5d",
      environment: "production",
    });
    expect(made.summary).toContain("The site is at https://www.acme.example.");
    // The zone is looked for from the address's own name up.
    expect(made.curl).toContain("/zones?name=www.acme.example&");
    // Connected already: nothing is asked of Cloudflare but that.
    const again = run(
      connect,
      {
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        ZONE: "acme.example",
        DOMAINS: '[{"hostname":"www.acme.example","service":"acme"}]',
      },
      site,
    );
    expect(again.put).toBe("");
    expect(again.curl).not.toContain("/zones");
  });

  it("only warns where the domain can't be connected, and leaves workers.dev addresses alone", () => {
    const site = wranglerJsonc("https://www.acme.example");
    const noZone = run(connect, { CLOUDFLARE_ACCOUNT_ID: ACCOUNT, ZONE: "other.example" }, site);
    expect(noZone.status).toBe(0);
    expect(noZone.stdout).toContain("::warning::www.acme.example's zone isn't on this Cloudflare account");
    expect(noZone.put).toBe("");
    const refused = run(
      connect,
      {
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        ZONE: "acme.example",
        PUT: '{"success":false,"errors":[{"message":"Hostname already has externally managed DNS records"}]}',
      },
      site,
    );
    expect(refused.status).toBe(0);
    expect(refused.stdout).toContain("(Hostname already has externally managed DNS records)");
    const workersDev = run(
      connect,
      { CLOUDFLARE_ACCOUNT_ID: ACCOUNT },
      wranglerJsonc("https://acme.acme-co.workers.dev"),
    );
    expect(workersDev.status).toBe(0);
    expect(workersDev.curl).toBe("");
    // The account from wrangler.jsonc, where there's no CLOUDFLARE_ACCOUNT_ID.
    const fromFile = run(
      connect,
      { CLOUDFLARE_ACCOUNT_ID: "", ZONE: "acme.example" },
      site.replace('"name": "acme",', `"name": "acme",\n  "account_id": "${ACCOUNT}",`),
    );
    expect(fromFile.curl).toContain(`/accounts/${ACCOUNT}/workers/domains`);
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

  it("finds the account where only the token says it, and refuses to guess between several", () => {
    const one = run(
      create,
      { CLOUDFLARE_ACCOUNT_ID: "", ACCOUNTS: '[{"id":"0123456789abcdef0123456789abcdef"}]' },
      wranglerJsonc("https://www.acme.example"),
    );
    expect(one.status, one.stdout + one.stderr).toBe(0);
    expect(one.outputs).toContain("account=0123456789abcdef0123456789abcdef\n");
    // The subdomain is asked of that account.
    const named = run(create, {
      CLOUDFLARE_ACCOUNT_ID: "",
      ACCOUNTS: '[{"id":"0123456789abcdef0123456789abcdef"}]',
      SUBDOMAIN: "acme-co",
    });
    expect(named.curl).toContain("/accounts/0123456789abcdef0123456789abcdef/workers/subdomain");
    for (const ACCOUNTS of [
      "[]",
      '[{"id":"0123456789abcdef0123456789abcdef"},{"id":"fedcba9876543210fedcba9876543210"}]',
      '[{"id":"x y"}]',
    ]) {
      const refused = run(create, { CLOUDFLARE_ACCOUNT_ID: "", ACCOUNTS }, wranglerJsonc("https://www.acme.example"));
      expect(refused.status, ACCOUNTS).not.toBe(0);
      expect(refused.stdout).toContain("Make the token for one account only");
    }
    // Named already, by the secret or wrangler.jsonc: not asked, and not written again.
    const given = run(create, {}, wranglerJsonc("https://www.acme.example"));
    expect(given.outputs).not.toContain("account=");
    expect(given.curl).toBe("");
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
      ACCOUNT: "0123456789abcdef0123456789abcdef",
      GITHUB_REF_NAME: "main",
    });
    expect(saved.status, saved.stderr).toBe(0);
    const log = spawnSync("git", ["--git-dir", join(dir, "remote.git"), "log", "--format=%s", "main"], {
      encoding: "utf8",
    }).stdout;
    expect(log).toBe("Name the site's Cloudflare account, database, and cache\nmeanwhile\nwrangler\nstart\n");
    const pushed = spawnSync("git", ["--git-dir", join(dir, "remote.git"), "show", "main:wrangler.jsonc"], {
      encoding: "utf8",
    }).stdout;
    expect(pushed).toContain('"database_id": "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c"');
    expect(pushed).toContain('"id": "0123456789abcdef0123456789abcdef"');
    expect(pushed).toContain('"GOODFELLOW_SITE_URL": "https://acme.acme-co.workers.dev"');
    expect(pushed).toContain('"name": "acme",\n  "account_id": "0123456789abcdef0123456789abcdef",\n');
    expect(readFileSync(join(dir, "summary"), "utf8")).toContain("https://acme.acme-co.workers.dev/setup/");
    // Anything but an address on workers.dev is refused, whatever the job before said.
    const refused = run(`${setUp}\n${save}`, {
      DATABASE: "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c",
      KV: "0123456789abcdef0123456789abcdef",
      ADDRESS: 'https://evil.example" x',
    });
    expect(refused.status).not.toBe(0);
    const badAccount = run(`${setUp}\n${save}`, {
      DATABASE: "0f2b1c4e-6a1d-4c8e-9b5a-2d7e8f9a0b1c",
      KV: "0123456789abcdef0123456789abcdef",
      ACCOUNT: 'x", "main": "evil',
      GITHUB_REF_NAME: "main",
    });
    expect(badAccount.status).not.toBe(0);
    expect(readFileSync(join(dir, "wrangler.jsonc"), "utf8")).not.toContain("evil");
  });
});

describe("the company example's deploy job's check of what the build handed over", () => {
  const example = join(import.meta.dirname, "../../../examples/company");
  const check = join(example, "scripts/check-build.ts");

  /** The build's config as vinext's build writes it for the example's wrangler.jsonc, in `root`. */
  const builtConfig = (root: string) => ({
    configPath: join(root, "wrangler.jsonc"),
    userConfigPath: join(root, "wrangler.jsonc"),
    topLevelName: "goodfellow-company",
    definedEnvironments: [],
    keep_vars: true,
    compatibility_date: "2026-11-01",
    compatibility_flags: ["nodejs_compat"],
    jsx_factory: "React.createElement",
    jsx_fragment: "React.Fragment",
    rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
    name: "goodfellow-company",
    main: "index.js",
    triggers: {},
    assets: {
      directory: "../client",
      html_handling: "none",
      not_found_handling: "none",
      binding: "ASSETS",
      run_worker_first: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    vars: { GOODFELLOW_SITE_URL: "https://www.example.com" },
    durable_objects: { bindings: [] },
    kv_namespaces: [{ binding: "VINEXT_KV_CACHE", id: "your-kv-namespace-id" }],
    d1_databases: [
      {
        binding: "DB",
        database_name: "goodfellow-company",
        database_id: "your-database-id",
        migrations_dir: "../../migrations/sqlite",
      },
    ],
    images: { binding: "IMAGES" },
    logfwdr: { bindings: [] },
    upload_source_maps: true,
    python_modules: { exclude: ["**/*.pyc"] },
    dev: { ip: "localhost", local_protocol: "http", upstream_protocol: "http", enable_containers: true },
    no_bundle: true,
  });

  /** Runs the check on a build's files, its config changed by `change`, with what it printed and its exit status. */
  function checked(change: (config: Record<string, unknown>, root: string) => void = () => {}) {
    dir = mkdtempSync(join(tmpdir(), "company-check-"));
    writeFileSync(join(dir, "wrangler.jsonc"), readFileSync(join(example, "wrangler.jsonc"), "utf8"));
    mkdirSync(join(dir, "dist/server"), { recursive: true });
    mkdirSync(join(dir, "dist/client"), { recursive: true });
    mkdirSync(join(dir, ".wrangler/deploy"), { recursive: true });
    writeFileSync(join(dir, "dist/server/index.js"), "export default {};\n");
    writeFileSync(
      join(dir, ".wrangler/deploy/config.json"),
      JSON.stringify({ configPath: "../../dist/server/wrangler.json", auxiliaryWorkers: [] }),
    );
    const config: Record<string, unknown> = builtConfig(dir);
    change(config, dir);
    writeFileSync(join(dir, "dist/server/wrangler.json"), JSON.stringify(config));
    const result = spawnSync("node", [check], { cwd: dir, encoding: "utf8" });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  }

  it("takes the build's config where it's wrangler.jsonc's, comments and all, with its files in dist/", () => {
    const { status, out } = checked();
    expect(status, out).toBe(0);
  });

  it("stops at anything that would run, or upload files outside dist/, with the deploy's keys in reach", () => {
    const changes: [string, (config: Record<string, unknown>, root: string) => void][] = [
      ["a command to build with", (config) => (config.build = { command: "env > leaked" })],
      ["an image to build", (config) => (config.containers = [{ class_name: "C", image: "./Dockerfile" }])],
      ["a file to upload from elsewhere", (config) => (config.text_blobs = { ENV: "/proc/self/environ" })],
      ["a Worker outside dist/", (config) => (config.main = "../../wrangler.jsonc")],
      ["static files outside dist/", (config) => ((config.assets as Record<string, unknown>).directory = "/")],
      ["a binding of its own", (config) => (config.vars = { GOODFELLOW_SITE_URL: "https://evil.example" })],
      [
        "migrations from elsewhere",
        (config) => (config.d1_databases = [{ ...(config.d1_databases as object[])[0], migrations_dir: "../client" }]),
      ],
      ["another wrangler.jsonc", (config) => (config.userConfigPath = "/tmp/wrangler.jsonc")],
      ["a key no build writes", (config) => (config.unsafe = { bindings: [{ name: "X", type: "x" }] })],
      ["a setting left out", (config) => delete config.keep_vars],
      ["bindings left out", (config) => delete config.kv_namespaces],
    ];
    for (const [what, change] of changes) {
      const { status, out } = checked(change);
      expect(status, what).toBe(1);
      expect(out, what).toContain("::error::");
    }
  });

  it("stops where the build's config is elsewhere, or its files are links", () => {
    const elsewhere = checked((_config, root) => {
      writeFileSync(join(root, "wrangler.json"), "{}");
      writeFileSync(join(root, ".wrangler/deploy/config.json"), JSON.stringify({ configPath: "../../wrangler.json" }));
    });
    expect(elsewhere.status).toBe(1);
    expect(elsewhere.out).toContain("isn't in dist/");
    const linked = checked((_config, root) => {
      rmSync(join(root, "dist/server/index.js"));
      symlinkSync("/proc/self/environ", join(root, "dist/server/index.js"));
    });
    expect(linked.status).toBe(1);
    expect(linked.out).toContain("is a link");
    // The folders themselves too, which every path in them would otherwise be inside as text.
    for (const folder of ["dist", ".wrangler"]) {
      const moved = checked((_config, root) => {
        renameSync(join(root, folder), join(root, `${folder}-elsewhere`));
        symlinkSync(join(root, `${folder}-elsewhere`), join(root, folder));
      });
      expect(moved.status, folder).toBe(1);
      expect(moved.out, folder).toContain(`${folder} is a link`);
    }
  });

  it("runs in the deploy job before anything reads the build's files, with none of the job's secrets", () => {
    const steps = parse(readFileSync(join(workflows, "deploy.yml"), "utf8")).jobs.deploy.steps as {
      name?: string;
      run?: string;
      uses?: string;
      env?: Record<string, string>;
    }[];
    const at = steps.findIndex((step) => step.name === "Check what the build handed over");
    expect(steps[at]?.run).toBe("node scripts/check-build.ts");
    expect(steps[at]?.env).toBeUndefined();
    expect(steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@"))).toBeLessThan(at);
    expect(steps.findIndex((step) => step.run === "npm ci")).toBeGreaterThan(at);
    expect(steps.findIndex((step) => step.run?.includes("wrangler d1 migrations apply"))).toBeGreaterThan(at);
  });
});
