// Applies migrations/postgres/ to a Postgres database with Kysely's Migrator, which records each one it runs, so a
// migration runs once whatever order branches merge in. D1 has no address to connect to from outside a Worker, so
// `wrangler d1 migrations apply` applies migrations/sqlite/ there instead; both read the same SQL files.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Kysely, sql } from "kysely";
import { type Migration, type MigrationResult, Migrator } from "kysely/migration";

/** Where the Postgres migrations' SQL is, as `npm run migrations` writes it. */
export const POSTGRES_MIGRATIONS_DIR = join(import.meta.dirname, "../../migrations/postgres");

/** Each SQL file's statements, one a line, by the file's name without `.sql`. */
async function sqlMigrations(dir: string): Promise<Record<string, Migration>> {
  const migrations: Record<string, Migration> = {};
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort()) {
    const statements = (await readFile(join(dir, file), "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("--"));
    migrations[file.replace(/\.sql$/, "")] = {
      async up(db) {
        for (const statement of statements) await sql.raw(statement).execute(db);
      },
    };
  }
  return migrations;
}

/** Runs every migration `db` hasn't had yet, oldest first, each in a transaction of its own. */
export async function migratePostgres(db: Kysely<unknown>, dir = POSTGRES_MIGRATIONS_DIR): Promise<MigrationResult[]> {
  const migrator = new Migrator({ db, provider: { getMigrations: () => sqlMigrations(dir) } });
  const { error, results = [] } = await migrator.migrateToLatest();
  if (error) throw error;
  return results;
}
