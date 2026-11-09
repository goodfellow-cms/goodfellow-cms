// Better Auth's tables, with the admin plugin's columns: users, their sessions, their sign-in accounts, and the
// links sign-in emails carry. Written once from `npx @better-auth/cli generate`, in Kysely's schema builder, so
// SQLite (D1) and Postgres (Neon) get the same tables; `migrations.test.ts` checks Better Auth finds nothing missing.
// A migration is a file of its own, named by when it was made (`npm run migration -- <what it does>`).
import type { Kysely } from "kysely";
import { type DatabaseType, typesFor } from "../types.ts";

/** This migration's statements, in order, for `type`'s database. */
export function statements(db: Kysely<unknown>, type: DatabaseType) {
  const { date, flag } = typesFor(type);
  const schema = db.schema;
  return [
    schema
      .createTable("user")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("email", "text", (column) => column.notNull().unique())
      .addColumn("emailVerified", flag, (column) => column.notNull())
      .addColumn("image", "text")
      .addColumn("createdAt", date, (column) => column.notNull())
      .addColumn("updatedAt", date, (column) => column.notNull())
      .addColumn("role", "text")
      .addColumn("banned", flag)
      .addColumn("banReason", "text")
      .addColumn("banExpires", date),
    schema
      .createTable("session")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("expiresAt", date, (column) => column.notNull())
      .addColumn("token", "text", (column) => column.notNull().unique())
      .addColumn("createdAt", date, (column) => column.notNull())
      .addColumn("updatedAt", date, (column) => column.notNull())
      .addColumn("ipAddress", "text")
      .addColumn("userAgent", "text")
      .addColumn("userId", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
      .addColumn("impersonatedBy", "text"),
    schema
      .createTable("account")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("accountId", "text", (column) => column.notNull())
      .addColumn("providerId", "text", (column) => column.notNull())
      .addColumn("userId", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
      .addColumn("accessToken", "text")
      .addColumn("refreshToken", "text")
      .addColumn("idToken", "text")
      .addColumn("accessTokenExpiresAt", date)
      .addColumn("refreshTokenExpiresAt", date)
      .addColumn("scope", "text")
      .addColumn("password", "text")
      .addColumn("createdAt", date, (column) => column.notNull())
      .addColumn("updatedAt", date, (column) => column.notNull()),
    schema
      .createTable("verification")
      .addColumn("id", "text", (column) => column.primaryKey().notNull())
      .addColumn("identifier", "text", (column) => column.notNull())
      .addColumn("value", "text", (column) => column.notNull())
      .addColumn("expiresAt", date, (column) => column.notNull())
      .addColumn("createdAt", date, (column) => column.notNull())
      .addColumn("updatedAt", date, (column) => column.notNull()),
    schema.createIndex("session_userId_idx").on("session").column("userId"),
    schema.createIndex("account_userId_idx").on("account").column("userId"),
    schema.createIndex("verification_identifier_idx").on("verification").column("identifier"),
  ];
}
