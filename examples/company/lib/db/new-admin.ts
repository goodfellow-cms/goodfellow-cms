// Makes an admin, someone who owns the site, as `npm run new-admin` does, with Better Auth itself, so the account
// and its password are stored just as signing in reads them.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { generateRandomString } from "better-auth/crypto";
import { admin } from "better-auth/plugins/admin";
import { createAdmin, type NewAdmin, newAdminProblem } from "../admins.ts";

export { MIN_ADMIN_PASSWORD, type NewAdmin, newAdminProblem } from "../admins.ts";

/** Where D1's migrations are, as `npm run migrations` writes them. */
export const SQLITE_MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations/sqlite");

/** Adds the admin to `database`, refusing an email address someone already has. */
export async function addAdmin(database: BetterAuthOptions["database"], person: NewAdmin): Promise<void> {
  const problem = newAdminProblem(person);
  if (problem) throw new Error(problem);
  // Nothing here signs a session or makes a link, so the secret and address are only ones Better Auth won't warn
  // about.
  const siteAuth = betterAuth({
    database,
    baseURL: "http://localhost",
    secret: generateRandomString(32),
    plugins: [admin()],
  });
  await createAdmin(await siteAuth.$context, person);
}

/** A value as SQLite writes it in SQL. */
function sqlValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * The SQL that adds the admin to a D1 database, which wrangler runs there: the rows Better Auth writes, made in a
 * SQLite database of its own with the same migrations, since D1 can't be reached from this computer but through
 * wrangler.
 */
export async function d1AdminSql(person: NewAdmin, migrations = SQLITE_MIGRATIONS_DIR): Promise<string> {
  const db = new DatabaseSync(":memory:");
  try {
    for (const name of (await readdir(migrations)).sort()) db.exec(await readFile(join(migrations, name), "utf8"));
    await addAdmin(db, person);
    const lines: string[] = [];
    // The account, and the row that retires the setup code, left as it is where the site has it already.
    for (const table of ["user", "account", "verification"]) {
      for (const row of db.prepare(`select * from "${table}"`).all()) {
        const columns = Object.keys(row);
        lines.push(
          `insert${table === "verification" ? " or ignore" : ""} into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns
            .map((column) => sqlValue(row[column]))
            .join(", ")});`,
        );
      }
    }
    return `${lines.join("\n")}\n`;
  } finally {
    db.close();
  }
}
