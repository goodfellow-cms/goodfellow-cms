// Applies the migrations Postgres hasn't had yet to the database at DATABASE_URL, such as Neon's, before the code
// that needs them goes online. Sites on Cloudflare's D1 use `wrangler d1 migrations apply` instead.
import { Kysely } from "kysely";
import { dialectFor } from "../lib/db/dialect.ts";
import { migratePostgres } from "../lib/db/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL to the Postgres database to migrate.");
  process.exit(1);
}
const db = new Kysely<unknown>({ dialect: (await dialectFor({ DATABASE_URL: url })).dialect });
try {
  const results = await migratePostgres(db);
  for (const { migrationName, status } of results)
    console.log(`${status === "Success" ? "Applied" : status}: ${migrationName}`);
  if (results.length === 0) console.log("Nothing to apply.");
} finally {
  await db.destroy();
}
