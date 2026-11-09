// Every migration in lib/db/migrations/, and each one's SQL for SQLite (D1) and Postgres (Neon), compiled without a
// database. There's no list of migrations to add to: each is a file of its own, found by its name, so two branches
// that each add one never touch the same file.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import type { DatabaseType } from "./types.ts";

export type { DatabaseType } from "./types.ts";

/** Where the migrations are. */
export const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/**
 * A migration's file name: when it was made, to the second (`YYYYMMDDHHMMSS`), then what it does, such as
 * `20261109033700_auth.ts`. Branches made at different times never pick the same name, and the time keeps them in
 * the order they were written. `npm run migration -- <what it does>` makes one.
 */
export const MIGRATION_NAME = /^(\d{14})_([a-z0-9][a-z0-9-]*)\.ts$/;

/** A migration: its statements, built against a database of `type`. */
export interface Migration {
  statements(db: Kysely<unknown>, type: DatabaseType): { compile(): { sql: string } }[];
}

/** The migrations' names, oldest first, such as `20261109033700_auth`. */
export async function migrationNames(dir = MIGRATIONS_DIR): Promise<string[]> {
  return (await readdir(dir))
    .filter((file) => MIGRATION_NAME.test(file))
    .map((file) => file.replace(/\.ts$/, ""))
    .sort();
}

/** A Kysely that compiles queries for `type`'s database, and runs none. */
function compiler(type: DatabaseType): Kysely<unknown> {
  return new Kysely<unknown>({
    dialect:
      type === "sqlite"
        ? {
            createAdapter: () => new SqliteAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new SqliteIntrospector(db),
            createQueryCompiler: () => new SqliteQueryCompiler(),
          }
        : {
            createAdapter: () => new PostgresAdapter(),
            createDriver: () => new DummyDriver(),
            createIntrospector: (db) => new PostgresIntrospector(db),
            createQueryCompiler: () => new PostgresQueryCompiler(),
          },
  });
}

/**
 * Each migration's SQL file for `type`'s database, by file name, such as
 * `20261109033700_auth.sql`: one statement a line. D1 and the Postgres
 * migrator apply each file that hasn't run, whatever order branches merge in.
 */
export async function migrationFiles(type: DatabaseType, dir = MIGRATIONS_DIR): Promise<Map<string, string>> {
  const db = compiler(type);
  const files = new Map<string, string>();
  for (const name of await migrationNames(dir)) {
    const migration = (await import(pathToFileURL(join(dir, `${name}.ts`)).href)) as Migration;
    const sql = migration.statements(db, type).map((statement) => `${statement.compile().sql};`);
    files.set(
      `${name}.sql`,
      `-- Written by scripts/emit-migrations.ts from lib/db/migrations/${name}.ts.\n${sql.join("\n")}\n`,
    );
  }
  return files;
}
