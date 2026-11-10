// Where Better Auth counts requests to its routes, sign-in attempts among them, so its rate limit holds across every
// copy of the Worker rather than in each one's memory. One row for each address and route, by `key`.
import type { Kysely } from "kysely";
import type { DatabaseType } from "../types.ts";

/** This migration's statements, in order, for `type`'s database. */
export function statements(db: Kysely<unknown>, _type: DatabaseType) {
  return [
    db.schema
      .createTable("rateLimit")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("key", "text", (column) => column.notNull().unique())
      .addColumn("count", "integer", (column) => column.notNull())
      // Milliseconds since 1970, which outgrow a 32-bit integer.
      .addColumn("lastRequest", "bigint", (column) => column.notNull()),
  ];
}
