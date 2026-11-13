// What each person is entitled to (lib/entitlements.ts): a subscription, which the paywall asks for, or something
// bought once. Payments write it; `migrations.test.ts` checks Better Auth finds nothing missing.
import type { Kysely } from "kysely";
import { type DatabaseType, typesFor } from "../types.ts";

/** This migration's statements, in order, for `type`'s database. */
export function statements(db: Kysely<unknown>, type: DatabaseType) {
  const { date } = typesFor(type);
  return [
    db.schema
      .createTable("entitlement")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("userId", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
      .addColumn("kind", "text", (column) => column.notNull())
      .addColumn("reference", "text", (column) => column.notNull())
      .addColumn("expiresAt", date)
      .addColumn("createdAt", date, (column) => column.notNull()),
    db.schema.createIndex("entitlement_userId_idx").on("entitlement").column("userId"),
  ];
}
