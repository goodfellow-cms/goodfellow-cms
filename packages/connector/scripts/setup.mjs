/**
 * Sets up a copy of the Claude connector: `pnpm run setup` in packages/connector.
 *
 * 1. Creates the connector's D1 database, if it doesn't have one, puts its id
 *    in wrangler.jsonc and creates its table.
 * 2. Deploys the connector with Wrangler, to learn its address.
 * 3. Creates the Goodfellow for Claude GitHub App from a manifest: a page on
 *    this computer posts it to GitHub, and GitHub comes back with a code that
 *    gives the app's id, keys and secret, so nothing is copied by hand.
 * 4. Optionally, takes a GitLab OAuth application's id and secret.
 * 5. Sets the secrets through Wrangler's standard input, deploys again and
 *    checks the connector answers.
 *
 * Run it again to replace the app or add GitLab; it keeps what the connector
 * already has unless asked. Secrets are never printed, put in a command line
 * or written to disk.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { convertManifest, deployedAddress, manifestAction, newSessionKey } from "@goodfellow-cms/worker/setup";
import {
  connectorManifest,
  connectorSecrets,
  DATABASE_NAME,
  databaseId,
  GITHUB_SECRETS,
  setupPage,
  withDatabaseId,
} from "../dist/setup.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "wrangler.jsonc");
const windows = process.platform === "win32";
const GITHUB_WEB = process.env.GITHUB_WEB ?? "https://github.com";
const GITHUB_API = process.env.GITHUB_API ?? "https://api.github.com";

/** Runs Wrangler in this package, sending `input` to it, or letting it ask its own questions. */
function wrangler(args, { input, capture = false, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(windows ? "npx.cmd" : "npx", ["--yes", "wrangler@4", ...args], {
      cwd: root,
      stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"],
      env: { ...process.env, ...env },
      // Windows runs npx.cmd only through a shell. The arguments are this script's own.
      shell: windows,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout }));
    if (input !== undefined) child.stdin.end(input);
  });
}

async function ask(question) {
  const lines = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await lines.question(question)).trim();
  } finally {
    lines.close();
  }
}

/** Asks without showing what's typed. */
async function askSecret(question) {
  process.stdout.write(question);
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const lines = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    return (await lines.question("")).trim();
  } finally {
    lines.close();
    process.stdout.write("\n");
  }
}

async function yesNo(question, yes) {
  const answer = (await ask(`${question} ${yes ? "(Y/n)" : "(y/N)"} `)).toLowerCase();
  return answer ? answer.startsWith("y") : yes;
}

function openBrowser(url) {
  const command = windows ? "explorer" : process.platform === "darwin" ? "open" : "xdg-open";
  try {
    spawn(command, [url], { stdio: "ignore", detached: true })
      .on("error", () => {})
      .unref();
  } catch {
    // The address is printed too.
  }
}

async function database() {
  const list = async () => databaseId((await wrangler(["d1", "list", "--json"], { capture: true })).stdout);
  let id = await list();
  if (!id) {
    console.log(`Creating the connector's database, ${DATABASE_NAME}.\n`);
    const { code } = await wrangler(["d1", "create", DATABASE_NAME], { capture: true });
    if (code !== 0) throw new Error("Wrangler couldn't create the database. Its messages above say why.");
    id = await list();
  }
  if (!id) throw new Error(`Wrangler didn't list the ${DATABASE_NAME} database.`);
  const config = await readFile(configPath, "utf8");
  const changed = withDatabaseId(config, id);
  if (changed !== config) await writeFile(configPath, changed);
  const { code } = await wrangler(["d1", "migrations", "apply", "DB", "--remote"], { input: "y\n" });
  if (code !== 0) throw new Error("Wrangler couldn't create the database's table. Its messages above say why.");
  return changed !== config;
}

async function deploy() {
  const folder = await mkdtemp(join(tmpdir(), "goodfellow-connector-"));
  const output = join(folder, "wrangler-output.json");
  try {
    const { code } = await wrangler(["deploy"], { env: { WRANGLER_OUTPUT_FILE_PATH: output } });
    if (code !== 0) throw new Error("Wrangler couldn't deploy the connector. Its messages above say why.");
    return deployedAddress(await readFile(output, "utf8").catch(() => ""));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

async function secretNames() {
  const { code, stdout } = await wrangler(["secret", "list", "--format", "json"], { capture: true });
  if (code !== 0) return [];
  try {
    const list = JSON.parse(stdout.slice(stdout.indexOf("[")));
    return Array.isArray(list) ? list.map((secret) => secret.name) : [];
  } catch {
    return [];
  }
}

/** Creates the app through a page on this computer, and gives what GitHub said about it. */
function createApp({ connector, organization, isPublic }) {
  const state = randomBytes(16).toString("hex");
  let created;
  let problem;
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (url.pathname === "/created") {
        const code = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state || !code) {
          problem = "GitHub came back without the app's details. Try again.";
        } else if (!created) {
          try {
            created = await convertManifest(code, fetch, GITHUB_API);
            console.log(`Created the app, ${created.slug}.`);
          } catch (error) {
            problem = error.message;
          }
        }
        response.writeHead(303, { location: "/", "cache-control": "no-store" }).end();
        return;
      }
      if (url.pathname !== "/") {
        response.writeHead(404).end();
        return;
      }
      const page = setupPage({
        created,
        problem,
        action: manifestAction(state, organization, GITHUB_WEB),
        manifest: connectorManifest({
          name: "Goodfellow for Claude",
          connector,
          redirect: `${origin}/created`,
          public: isPublic,
        }),
      });
      problem = undefined;
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "close",
        })
        .end(page);
      if (created) {
        server.close();
        server.closeAllConnections();
        resolve(created);
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = `http://127.0.0.1:${server.address().port}/`;
      console.log(`\nOpening ${address} in your browser, to create the app on GitHub.`);
      console.log("If it doesn't open, open that address yourself. This waits until the app is created.\n");
      openBrowser(address);
    });
  });
}

async function checkConnector(connector) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const health = await (await fetch(`${connector}/health`)).json();
      if (health.ok && health.database && (health.github || health.gitlab)) return health;
    } catch {
      // Not answering yet.
    }
    await new Promise((done) => setTimeout(done, 3000));
  }
  return undefined;
}

async function main() {
  console.log("Setting up the Claude connector, which lets Claude work on Goodfellow sites.");
  console.log("You need a Cloudflare account (the free plan is enough) and a GitHub account.");
  console.log("Wrangler may ask you to sign in to Cloudflare, and to choose your workers.dev address.\n");

  const changedConfig = await database();

  let connector = await deploy();
  if (!connector) {
    connector = (await ask("Wrangler didn't say the connector's address. What is it? (https://…) ")).replace(/\/$/, "");
  }
  if (!/^https:\/\/[^\s/]+$/.test(connector)) throw new Error(`${connector} isn't the connector's address.`);
  console.log(`\nThe connector's address is ${connector}.\n`);

  const secrets = await secretNames();
  const values = {};
  const haveApp = GITHUB_SECRETS.every((name) => secrets.includes(name));
  if (!haveApp || (await yesNo("The connector already has its GitHub App. Create a new one?", false))) {
    const organization =
      (await ask("Which GitHub organization should own the app? Leave this empty for your own account: ")) || undefined;
    const isPublic = await yesNo(
      "Can sites owned by anyone use it? Answer no if only sites owned by the app's owner will.",
      true,
    );
    Object.assign(values, connectorSecrets(await createApp({ connector, organization, isPublic })));
  }

  const haveGitLab = secrets.includes("GITLAB_CLIENT_ID");
  if (await yesNo(haveGitLab ? "Change the GitLab application?" : "Work on sites on GitLab.com too?", false)) {
    console.log("\nOn GitLab, add an application (Edit profile, then Applications), with:");
    console.log(`- Redirect URI: ${connector}/connect/gitlab/callback`);
    console.log("- Confidential: on");
    console.log("- Scopes: api\n");
    values.GITLAB_CLIENT_ID = await ask("Its Application ID: ");
    values.GITLAB_CLIENT_SECRET = await askSecret("Its Secret (not shown as you type): ");
  }

  // A new key would end every connection, so the connector keeps the one it has.
  if (!secrets.includes("SESSION_KEY")) values.SESSION_KEY = newSessionKey();
  if (Object.keys(values).length) {
    console.log("\nGiving the connector its secrets.\n");
    const { code } = await wrangler(["secret", "bulk"], { input: JSON.stringify(values) });
    if (code !== 0) throw new Error("Wrangler couldn't set the connector's secrets. Its messages above say why.");
    console.log("\nDeploying the connector again with its settings.\n");
    await deploy();
  }

  const health = await checkConnector(connector);
  if (!health) {
    throw new Error(
      `The connector at ${connector} isn't answering as it should yet. Try ${connector}/health in a minute.`,
    );
  }
  console.log(`\nThe Claude connector is working at ${connector}.\n`);
  console.log("Next:");
  console.log(`- In Claude, add a custom connector with the address ${connector}/mcp`);
  console.log("- The first time someone connects, they're asked to install the app on their site's repository.");
  if (changedConfig) console.log("- Keep the change to wrangler.jsonc, so later deploys use the same database.");
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
