// The one module that knows which database the site uses. Everything else sees a Kysely dialect, never a driver.
import type { Dialect } from "kysely";
import type { SiteEnv } from "../env.ts";
import type { DatabaseType } from "./types.ts";

export interface SiteDialect {
  dialect: Dialect;
  type: DatabaseType;
}

/**
 * The database the site's environment names: Cloudflare D1, bound as `DB`,
 * or Postgres (Neon, or any other) at `DATABASE_URL`. Each driver is imported
 * only where it's used, so a Worker bound to D1 never loads Postgres's.
 */
export async function dialectFor(env: SiteEnv): Promise<SiteDialect> {
  if (env.DB) {
    const { D1Dialect } = await import("kysely-d1");
    return { dialect: new D1Dialect({ database: env.DB as never }), type: "sqlite" };
  }
  if (env.DATABASE_URL) {
    // node-postgres: in Node, as on Vercel, and in Workers through Hyperdrive, which it has a build for (workerd).
    const [{ PostgresDialect }, { Pool }] = await Promise.all([import("kysely"), import("pg")]);
    return {
      dialect: new PostgresDialect({ pool: new Pool({ connectionString: env.DATABASE_URL }) }),
      type: "postgres",
    };
  }
  throw new Error("No database: bind a D1 database as DB, or set DATABASE_URL.");
}
