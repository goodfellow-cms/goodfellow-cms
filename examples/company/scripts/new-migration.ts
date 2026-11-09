// Makes a migration, named by the time it's made: `npm run migration -- add-jobs` writes
// lib/db/migrations/<YYYYMMDDHHMMSS>_add-jobs.ts, for its tables, then `npm run migrations` writes its SQL.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATION_NAME, MIGRATIONS_DIR } from "../lib/db/migrations-sql.ts";

const what = (process.argv[2] ?? "").toLowerCase();
const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const file = `${stamp}_${what}.ts`;
// A first guess at its table, which `add-jobs` names `jobs`.
const table = what.replace(/^(add|create)-/, "").replace(/-/g, "_");
if (!MIGRATION_NAME.test(file)) {
  console.error("Say what the migration does, in lowercase words joined by hyphens: npm run migration -- add-jobs");
  process.exit(1);
}
await writeFile(
  join(MIGRATIONS_DIR, file),
  `import type { Kysely } from "kysely";
import { type DatabaseType, typesFor } from "../types.ts";

/** This migration's statements, in order, for \`type\`'s database. */
export function statements(db: Kysely<unknown>, type: DatabaseType) {
  const { date } = typesFor(type);
  return [db.schema.createTable("${table}").addColumn("id", "text", (column) => column.primaryKey().notNull()).addColumn("createdAt", date, (column) => column.notNull())];
}
`,
  { flag: "wx" },
);
console.log(`Wrote lib/db/migrations/${file}. Change it, then run npm run migrations.`);
