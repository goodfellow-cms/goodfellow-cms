// Makes an admin, someone who owns the site, as `npm run new-admin` does, with Better Auth itself, so the account
// and its password are stored just as signing in reads them.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { generateRandomString } from "better-auth/crypto";
import { admin } from "better-auth/plugins/admin";

/** The person to make an admin. */
export interface NewAdmin {
  email: string;
  name: string;
  password: string;
}

/** The fewest characters an admin's password may have. */
export const MIN_ADMIN_PASSWORD = 12;

/** Where D1's migrations are, as `npm run migrations` writes them. */
export const SQLITE_MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations/sqlite");

/** What's wrong with the person's details, in words, or nothing. */
export function newAdminProblem({ email, name, password }: NewAdmin): string | undefined {
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) return "Give the admin's email address first.";
  if (name.trim() === "") return "Give the admin's name after their email address.";
  if (password.length < MIN_ADMIN_PASSWORD) return `Use a password of at least ${MIN_ADMIN_PASSWORD} characters.`;
  return undefined;
}

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
  const context = await siteAuth.$context;
  const email = person.email.toLowerCase();
  if (await context.internalAdapter.findUserByEmail(email)) throw new Error(`${email} already has an account.`);
  const user = await context.internalAdapter.createUser(
    { email, name: person.name.trim(), emailVerified: true, role: "admin" },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(person.password),
  });
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
    for (const table of ["user", "account"]) {
      for (const row of db.prepare(`select * from "${table}"`).all()) {
        const columns = Object.keys(row);
        lines.push(
          `insert into "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) values (${columns
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
