// Writes each migration's SQL into migrations/sqlite/ (which D1 applies) and migrations/postgres/ (which
// `npm run migrate` applies to Postgres), from lib/db/migrations/. Run `npm run migrations` after adding or changing
// one; a test checks they match.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DatabaseType, migrationFiles } from "../lib/db/migrations-sql.ts";

const root = join(import.meta.dirname, "..");
for (const type of ["sqlite", "postgres"] satisfies DatabaseType[]) {
  const dir = join(root, "migrations", type);
  await mkdir(dir, { recursive: true });
  const files = await migrationFiles(type);
  for (const [name, sql] of files) {
    await writeFile(join(dir, name), sql);
    console.log(`Wrote migrations/${type}/${name}`);
  }
  // SQL whose migration is gone, or was renamed.
  for (const name of await readdir(dir)) {
    if (name.endsWith(".sql") && !files.has(name)) await rm(join(dir, name));
  }
}
