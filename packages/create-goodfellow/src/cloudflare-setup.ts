// Putting a new full-stack site online on Cloudflare from the computer it was made on, with wrangler, step by step,
// each asked first and each one that's skipped or fails left to the README. Secrets are typed into wrangler's own
// prompt, never here, but the session key, which this makes.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { commandToRun } from "@goodfellow-cms/core/node";

/** What a program printed and how it ended, or only how it ended where it printed to the terminal itself. */
export interface RunResult {
  status: number | null;
  stdout: string;
}

/**
 * Runs a program in the site's folder: in the terminal (`inherit`) for what asks the person something, such as
 * signing in or a secret, otherwise reading what it prints, given `input` on its standard input.
 */
export type Runner = (command: string, args: string[], options?: { inherit?: boolean; input?: string }) => RunResult;

/** Runs programs for real, in `cwd`. */
export function runIn(cwd: string): Runner {
  return (command, args, { inherit = false, input } = {}) => {
    const run = commandToRun(command, args);
    const result = spawnSync(run.file, run.args, {
      cwd,
      shell: run.shell,
      encoding: "utf8",
      ...(input !== undefined && { input }),
      stdio: inherit ? "inherit" : [input === undefined ? "inherit" : "pipe", "pipe", "inherit"],
    });
    return { status: result.status, stdout: result.stdout ?? "" };
  };
}

/** The placeholders wrangler.jsonc has where Cloudflare's ids go. */
export const DATABASE_ID_PLACEHOLDER = "your-database-id";
export const KV_ID_PLACEHOLDER = "your-kv-namespace-id";

/** The D1 database's id in what `wrangler d1 create` prints, in its TOML or JSON form. */
export function d1DatabaseId(output: string): string | undefined {
  return /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i.exec(output)?.[1];
}

/** The KV namespace's id in what `wrangler kv namespace create` prints. */
export function kvNamespaceId(output: string): string | undefined {
  return /"?id"?\s*[:=]\s*"([0-9a-f]{32})"/i.exec(output)?.[1];
}

/** wrangler.jsonc with the ids Cloudflare gave put in place of its placeholders. */
export function withCloudflareIds(wrangler: string, ids: { database?: string; kv?: string }): string {
  let text = wrangler;
  if (ids.database) text = text.replace(`"${DATABASE_ID_PLACEHOLDER}"`, `"${ids.database}"`);
  if (ids.kv) text = text.replace(`"${KV_ID_PLACEHOLDER}"`, `"${ids.kv}"`);
  return text;
}

/** A session key for Better Auth: 32 random bytes, as `openssl rand -base64 32` makes. */
export function newSessionKey(): string {
  return randomBytes(32).toString("base64");
}

export interface CloudflareSetupOptions {
  /** The site's folder. */
  target: string;
  /** Its Worker's name, which its D1 database has too, and its KV namespace with `-cache`. */
  worker: string;
  run: Runner;
  /** Asks a question, giving the answer. */
  ask: (question: string) => Promise<string>;
  /** Says something to the person. */
  say: (line: string) => void;
  /** Makes the session key; tests give their own. */
  sessionKey?: () => string;
}

/** Whether an answer to a question with a default of yes is yes. */
function yes(answer: string): boolean {
  return !/^\s*n/i.test(answer);
}

/**
 * Puts the site online on Cloudflare with wrangler: signs in, makes its D1 database and KV namespace and writes
 * their ids into wrangler.jsonc, builds and deploys it (which applies the database's migrations), sets its secrets,
 * and makes its first admin. Each step is asked first. Gives the steps still to do, for the person to follow in the
 * README; stops at the first that fails, since the ones after it need it.
 */
export async function setUpCloudflare({
  target,
  worker,
  run,
  ask,
  say,
  sessionKey = newSessionKey,
}: CloudflareSetupOptions): Promise<string[]> {
  const left: string[] = [];
  const later = (...steps: string[]) => {
    left.push(...steps);
    return left;
  };
  const wranglerFile = join(target, "wrangler.jsonc");
  const rest = [
    "Make the D1 database and KV namespace and put their ids in wrangler.jsonc (README.md, step 2).",
    "Set the site's address and secrets (step 3), then put it online (step 6) and make its first admin (step 7).",
  ];

  // Signing in, in wrangler's own browser window.
  const whoami = run("npx", ["wrangler", "whoami"]);
  if (whoami.status !== 0 || /not authenticated/i.test(whoami.stdout)) {
    if (!yes(await ask("\nSign in to Cloudflare with wrangler now? (Y/n) "))) return later(...rest);
    if (run("npx", ["wrangler", "login"], { inherit: true }).status !== 0) {
      say("Signing in to Cloudflare didn't finish.");
      return later("Sign in with npx wrangler login.", ...rest);
    }
  }

  // The database and the KV namespace, whose ids go into wrangler.jsonc.
  if (!yes(await ask(`\nMake the D1 database and the KV namespace, ${worker} and ${worker}-cache? (Y/n) `))) {
    return later(...rest);
  }
  const database = run("npx", ["wrangler", "d1", "create", worker]);
  const databaseId = database.status === 0 ? d1DatabaseId(database.stdout) : undefined;
  const kv = databaseId ? run("npx", ["wrangler", "kv", "namespace", "create", `${worker}-cache`]) : undefined;
  const kvId = kv?.status === 0 ? kvNamespaceId(kv.stdout) : undefined;
  await writeFile(
    wranglerFile,
    withCloudflareIds(await readFile(wranglerFile, "utf8"), {
      ...(databaseId && { database: databaseId }),
      ...(kvId && { kv: kvId }),
    }),
  );
  if (!databaseId || !kvId) {
    say(
      `wrangler couldn't make the ${databaseId ? "KV namespace" : "D1 database"}, or didn't say its id. If it already exists, its id is in Cloudflare's dashboard.`,
    );
    return later(...rest);
  }
  say(`Made them, and put their ids in wrangler.jsonc.`);

  // Built and put online here, which also applies the database's migrations: the secrets need the Worker to exist.
  if (!yes(await ask("\nBuild the site and put it online now? (Y/n) "))) {
    return later("Set the site's address and secrets (README.md, step 3), then put it online (step 6).", rest[1] ?? "");
  }
  if (
    run("npm", ["run", "build"], { inherit: true }).status !== 0 ||
    run("npm", ["run", "deploy"], { inherit: true }).status !== 0
  ) {
    say("The site couldn't be built or put online: what went wrong is above.");
    return later("Put it online with npm run build && npm run deploy (README.md, step 6).", rest[1] ?? "");
  }

  // The session key, made here, and the git token, which only wrangler's prompt sees.
  const key = run("npx", ["wrangler", "secret", "put", "BETTER_AUTH_SECRET"], { input: `${sessionKey()}\n` });
  if (key.status !== 0) say("The session key couldn't be set: set BETTER_AUTH_SECRET as README.md's step 3 says.");
  say(
    "\nThe site publishes with a fine-grained GitHub token that can change the content repository and nothing else (Contents: Read and write, on that one repository). Make it on GitHub, then paste it only when wrangler asks for it.",
  );
  if (yes(await ask("Set the token now? (Y/n) "))) {
    if (run("npx", ["wrangler", "secret", "put", "GOODFELLOW_GIT_TOKEN"], { inherit: true }).status !== 0) {
      left.push("Set GOODFELLOW_GIT_TOKEN with npx wrangler secret put GOODFELLOW_GIT_TOKEN (README.md, step 3).");
    }
  } else {
    left.push("Set GOODFELLOW_GIT_TOKEN with npx wrangler secret put GOODFELLOW_GIT_TOKEN (README.md, step 3).");
  }
  if (key.status !== 0) left.push("Set BETTER_AUTH_SECRET with npx wrangler secret put BETTER_AUTH_SECRET.");

  // The first admin, whose password is typed into the script's own hidden prompt.
  const email = (await ask("\nThe first admin's email address (leave empty to do this later): ")).trim();
  if (email === "") return later("Make the first admin with npm run new-admin (README.md, step 7).");
  const name = (await ask("Their name: ")).trim();
  if (run("npm", ["run", "new-admin", "--", email, name, "--remote"], { inherit: true }).status !== 0) {
    left.push("Make the first admin with npm run new-admin (README.md, step 7).");
  }
  return left;
}
