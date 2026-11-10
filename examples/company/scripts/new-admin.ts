// Makes an admin, someone who owns the site, with a password typed here, which is never shown or kept:
// `npm run new-admin -- olive@example.org "Olive Owner" --remote` (or `--local` for the database on this computer).
// With DATABASE_URL set, it adds them to that Postgres database instead. It's how a new site gets its first admin.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Kysely } from "kysely";
import { dialectFor } from "../lib/db/dialect.ts";
import { addAdmin, d1AdminSql, type NewAdmin, newAdminProblem } from "../lib/db/new-admin.ts";

/** Reads a line from the terminal without showing what's typed. */
function hiddenLine(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let line = "";
    const done = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", read);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(line);
    };
    const read = (typed: string) => {
      for (const character of typed) {
        if (character === "\r" || character === "\n") return done();
        if (character === "\u0003") return done(new Error("Stopped."));
        if (character === "\u007f" || character === "\b") line = line.slice(0, -1);
        else line += character;
      }
    };
    stdin.on("data", read);
  });
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const [email = "", ...words] = args.filter((arg) => !arg.startsWith("--"));
const where = args.includes("--remote") ? "--remote" : args.includes("--local") ? "--local" : undefined;
const postgres = process.env.DATABASE_URL;
if (!where && !postgres) {
  fail('Say which database: npm run new-admin -- olive@example.org "Olive Owner" --remote (or --local).');
}
// A password typed here never reaches a log, so CI can't make admins.
if (process.env.CI || !process.stdin.isTTY)
  fail("Run this in a terminal of your own, where you can type the password.");

const password = await hiddenLine("Their password (it isn't shown): ");
if ((await hiddenLine("The same password again: ")) !== password) fail("The two passwords aren't the same.");
const person: NewAdmin = { email, name: words.join(" "), password };
const problem = newAdminProblem(person);
if (problem) fail(problem);

if (where) {
  const sql = await d1AdminSql(person);
  const folder = await mkdtemp(join(tmpdir(), "new-admin-"));
  try {
    const file = join(folder, "admin.sql");
    await writeFile(file, sql, { mode: 0o600 });
    // wrangler's own script, run with this Node, so it needs no shell on any computer.
    const wrangler = join(dirname(createRequire(import.meta.url).resolve("wrangler/package.json")), "bin/wrangler.js");
    const run = spawnSync(process.execPath, [wrangler, "d1", "execute", "DB", where, "--file", file, "--yes"], {
      stdio: "inherit",
    });
    if (run.status !== 0) fail("wrangler couldn't add them. If they already have an account, it says so above.");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
} else {
  const db = new Kysely<unknown>({ dialect: (await dialectFor({ DATABASE_URL: postgres })).dialect });
  try {
    await addAdmin({ db, type: "postgres" }, person);
  } finally {
    await db.destroy();
  }
}
console.log(`${person.email} is an admin. They sign in at /sign-in/.`);
