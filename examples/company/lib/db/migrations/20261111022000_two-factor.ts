// Better Auth's two-factor plugin: whether each person has turned it on, and their authenticator app's secret and
// backup codes, which Better Auth keeps encrypted with BETTER_AUTH_SECRET. `failedVerificationCount` and
// `lockedUntil` stop someone guessing codes for an account whose password they have.
import type { Kysely } from "kysely";
import { type DatabaseType, typesFor } from "../types.ts";

/** This migration's statements, in order, for `type`'s database. */
export function statements(db: Kysely<unknown>, type: DatabaseType) {
  const { date, flag } = typesFor(type);
  const schema = db.schema;
  return [
    schema.alterTable("user").addColumn("twoFactorEnabled", flag),
    schema
      .createTable("twoFactor")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("secret", "text", (column) => column.notNull())
      .addColumn("backupCodes", "text", (column) => column.notNull())
      .addColumn("userId", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
      .addColumn("verified", flag)
      .addColumn("failedVerificationCount", "integer")
      .addColumn("lockedUntil", date),
    schema.createIndex("twoFactor_secret_idx").on("twoFactor").column("secret"),
    schema.createIndex("twoFactor_userId_idx").on("twoFactor").column("userId"),
  ];
}
