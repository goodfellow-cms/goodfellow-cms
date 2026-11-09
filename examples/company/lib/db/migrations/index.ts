// Every migration, in order, and each one's SQL for SQLite (D1) and Postgres (Neon), compiled without a database.
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
import * as auth from "./0001_auth.ts";
import type { DatabaseType } from "./types.ts";

export type { DatabaseType } from "./types.ts";

/** A migration: its statements, built against a database of `type`. */
export interface Migration {
  statements(db: Kysely<unknown>, type: DatabaseType): { compile(): { sql: string } }[];
}

/** The migrations, by name, in the order they run. A new one goes at the end, with the next number. */
export const MIGRATIONS: Record<string, Migration> = {
  "0001_auth": auth,
};

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
 * `0001_auth.sql`: one statement a line, as `wrangler d1 migrations apply`
 * and Postgres read them.
 */
export function migrationFiles(type: DatabaseType): Map<string, string> {
  const db = compiler(type);
  const files = new Map<string, string>();
  for (const [name, migration] of Object.entries(MIGRATIONS)) {
    const sql = migration.statements(db, type).map((statement) => `${statement.compile().sql};`);
    files.set(
      `${name}.sql`,
      `-- Written by scripts/emit-migrations.ts from lib/db/migrations/${name}.ts.\n${sql.join("\n")}\n`,
    );
  }
  return files;
}
