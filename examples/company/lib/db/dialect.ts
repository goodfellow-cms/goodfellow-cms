// The one module that knows which database the site uses. Everything else sees a Kysely dialect, never a driver.
import type { Dialect, PostgresPool } from "kysely";
import type { SiteEnv } from "../env.ts";
import type { DatabaseType } from "./migrations/index.ts";

export interface SiteDialect {
  dialect: Dialect;
  type: DatabaseType;
}

/**
 * The database the site's environment names: Cloudflare D1, bound as `DB`,
 * or Postgres (such as Neon) at `DATABASE_URL`. Each driver is imported only
 * where it's used, so a Worker bound to D1 never bundles Postgres's.
 */
export async function dialectFor(env: SiteEnv): Promise<SiteDialect> {
  if (env.DB) {
    const { D1Dialect } = await import("kysely-d1");
    return { dialect: new D1Dialect({ database: env.DB as never }), type: "sqlite" };
  }
  if (env.DATABASE_URL) {
    const [{ PostgresDialect }, { Pool }] = await Promise.all([import("kysely"), import("@neondatabase/serverless")]);
    // Neon's Pool works as pg's does, which is what Kysely's Postgres dialect is written for; its own types differ.
    const pool = new Pool({ connectionString: env.DATABASE_URL }) as unknown as PostgresPool;
    return { dialect: new PostgresDialect({ pool }), type: "postgres" };
  }
  throw new Error("No database: bind a D1 database as DB, or set DATABASE_URL.");
}
