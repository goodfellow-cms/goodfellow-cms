// Writes each migration's SQL into migrations/sqlite/ (which D1 applies) and migrations/postgres/ (which Neon
// does), from lib/db/migrations/. Run `npm run migrations` after adding or changing one; a test checks they match.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type DatabaseType, migrationFiles } from "../lib/db/migrations/index.ts";

const root = join(import.meta.dirname, "..");
for (const type of ["sqlite", "postgres"] satisfies DatabaseType[]) {
  const dir = join(root, "migrations", type);
  await mkdir(dir, { recursive: true });
  for (const [name, sql] of migrationFiles(type)) {
    await writeFile(join(dir, name), sql);
    console.log(`Wrote migrations/${type}/${name}`);
  }
}
