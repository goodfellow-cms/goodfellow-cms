/**
 * Sets up a copy of the sign-in service: `pnpm run setup` in packages/worker.
 *
 * 1. Deploys the worker with Wrangler, to learn its address.
 * 2. Creates the two GitHub Apps from manifests: a page on this computer posts
 *    each to GitHub, and GitHub comes back with a code that gives the app's id,
 *    keys and secret, so nothing is copied by hand.
 * 3. Puts the apps' names and the setup page's address in wrangler.jsonc, sets
 *    the secrets through Wrangler's standard input, deploys again and checks
 *    the service answers.
 *
 * Run it again to change the setup page's address or replace the apps; it
 * keeps the apps and the session key the service already has unless asked.
 * Secrets are never printed, put in a command line or written to disk.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  APP_KINDS,
  appManifest,
  appSecrets,
  convertManifest,
  deployedAddress,
  hasAppSecrets,
  manifestAction,
  newSessionKey,
  readVar,
  setupPage,
  slugVar,
  withVars,
} from "../dist/setup.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const configPath = join(root, "wrangler.jsonc");
const windows = process.platform === "win32";
const APP_NAMES = { edit: "Goodfellow CMS", owner: "Goodfellow CMS owner" };
const GOODFELLOW_SIGN_IN = "https://sign-in.goodfellow-cms.workers.dev";
// For trying the script against a fake GitHub, as the worker's own settings allow.
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

/** Deploys the worker, and gives its address. */
async function deploy() {
  const folder = await mkdtemp(join(tmpdir(), "goodfellow-sign-in-"));
  const output = join(folder, "wrangler-output.json");
  try {
    const { code } = await wrangler(["deploy"], { env: { WRANGLER_OUTPUT_FILE_PATH: output } });
    if (code !== 0) throw new Error("Wrangler couldn't deploy the service. Its messages above say why.");
    return deployedAddress(await readFile(output, "utf8").catch(() => ""));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The names of the secrets the deployed worker has. */
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

/** Creates both apps through a page on this computer, and gives what GitHub said about each. */
function createApps({ worker, organization, isPublic }) {
  const state = randomBytes(16).toString("hex");
  const created = {};
  let problem;
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const origin = `http://127.0.0.1:${server.address().port}`;
      const back = url.pathname.match(/^\/created\/(edit|owner)$/);
      if (back) {
        const kind = back[1];
        const code = url.searchParams.get("code");
        if (url.searchParams.get("state") !== state || !code) {
          problem = "GitHub came back without the app's details. Try again.";
        } else if (!created[kind]) {
          try {
            created[kind] = await convertManifest(code, fetch, GITHUB_API);
            console.log(`Created ${kind === "edit" ? "the editors' app" : "the owners' app"}, ${created[kind].slug}.`);
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
      const next = APP_KINDS.find((kind) => !created[kind]);
      const page = setupPage({
        created,
        problem,
        next: next && {
          kind: next,
          action: manifestAction(state, organization, GITHUB_WEB),
          manifest: appManifest({
            kind: next,
            name: APP_NAMES[next],
            worker,
            redirect: `${origin}/created/${next}`,
            public: isPublic,
          }),
        },
      });
      problem = undefined;
      response
        .writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          connection: "close",
        })
        .end(page);
      if (!next) {
        server.close();
        server.closeAllConnections();
        resolve(created);
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = `http://127.0.0.1:${server.address().port}/`;
      console.log(`\nOpening ${address} in your browser, to create the apps on GitHub.`);
      console.log("If it doesn't open, open that address yourself. This waits until both apps are created.\n");
      openBrowser(address);
    });
  });
}

function parseOrigins(answer) {
  const origins = answer
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error(`${origin} isn't a web address.`);
    }
    if (url.protocol !== "https:") throw new Error(`${origin} must start with https://.`);
  }
  return origins.map((origin) => new URL(origin).origin).join(",");
}

async function checkService(worker) {
  // A new deployment can take a few seconds to answer everywhere.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const health = await (await fetch(`${worker}/health`)).json();
      if (health.ok && health.apps?.edit && health.apps?.owner) return health;
    } catch {
      // Not answering yet.
    }
    await new Promise((done) => setTimeout(done, 3000));
  }
  return undefined;
}

async function main() {
  console.log("Setting up the sign-in service, which lets editors sign in to Goodfellow sites with GitHub.");
  console.log("You need a Cloudflare account (the free plan is enough) and a GitHub account.\n");
  console.log("First, deploying the service to Cloudflare to learn its address. Wrangler may ask you to sign in");
  console.log("to Cloudflare, and to choose your workers.dev address.\n");

  let worker = await deploy();
  if (!worker) {
    worker = (await ask("Wrangler didn't say the service's address. What is it? (https://…) ")).replace(/\/$/, "");
  }
  if (!/^https:\/\/[^\s/]+$/.test(worker)) throw new Error(`${worker} isn't the service's address.`);
  console.log(`\nThe service's address is ${worker}.\n`);

  const secrets = await secretNames();
  const haveApps = APP_KINDS.every((kind) => hasAppSecrets(kind, secrets));
  let created = {};
  if (
    !haveApps ||
    (await yesNo(
      "The service already has its GitHub Apps. Create new ones? Everyone will need to sign in again.",
      false,
    ))
  ) {
    const organization =
      (await ask("Which GitHub organization should own the apps? Leave this empty for your own account: ")) ||
      undefined;
    const isPublic = await yesNo(
      "Can sites owned by anyone use them? Answer no if only sites owned by the apps' owner will.",
      true,
    );
    created = await createApps({ worker, organization, isPublic });
  }

  const config = await readFile(configPath, "utf8");
  const currentOrigins = readVar(config, "SETUP_ORIGINS") ?? "";
  const originsAnswer = await ask(
    `If you run a setup page for creating sites, what's its address? Press Enter to keep ${
      currentOrigins || "none"
    }, or type none: `,
  );
  const origins = !originsAnswer ? currentOrigins : originsAnswer === "none" ? "" : parseOrigins(originsAnswer);

  const vars = { SETUP_ORIGINS: origins };
  for (const kind of APP_KINDS) if (created[kind]) vars[slugVar(kind)] = created[kind].slug;
  const changed = withVars(config, vars);
  if (changed !== config) {
    await writeFile(configPath, changed);
    console.log("Saved the new settings in wrangler.jsonc.");
  }

  const values = {};
  for (const kind of APP_KINDS) if (created[kind]) Object.assign(values, appSecrets(kind, created[kind]));
  // A new key would sign everyone out, so the service keeps the one it has.
  if (!secrets.includes("SESSION_KEY")) values.SESSION_KEY = newSessionKey();
  if (Object.keys(values).length) {
    console.log("\nGiving the service its secrets.\n");
    const { code } = await wrangler(["secret", "bulk"], { input: JSON.stringify(values) });
    if (code !== 0) throw new Error("Wrangler couldn't set the service's secrets. Its messages above say why.");
  }

  console.log("\nDeploying the service again with its settings.\n");
  await deploy();

  const health = await checkService(worker);
  if (!health) {
    throw new Error(`The service at ${worker} isn't answering as it should yet. Try ${worker}/health in a minute.`);
  }
  console.log(`\nThe sign-in service is working at ${worker}.\n`);
  console.log("Next:");
  console.log(
    `- Install the editors' app on your sites' repositories: ${GITHUB_WEB}/apps/${health.apps.edit.slug}/installations/new`,
  );
  console.log("  (or let the sign-in screen offer it, the first time someone signs in to a site).");
  if (worker !== GOODFELLOW_SIGN_IN) {
    console.log(`- In each site's goodfellow.config.tsx, use it: github({ repo: "…", signIn: "${worker}" })`);
  }
  if (changed !== config) {
    console.log("- Keep the changes to wrangler.jsonc, so later deploys keep the same settings.");
  }
  console.log(
    "- To stop one computer using up the day's requests, see the Limits section of the docs' Sign-in service page.",
  );
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
