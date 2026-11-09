// The column types that differ between the site's two databases, so each migration is written once.

/** Which database a migration is for: D1 is SQLite, Neon is Postgres. */
export type DatabaseType = "sqlite" | "postgres";

/** Dates and yes-or-no columns, as Better Auth stores them in each database. */
export function typesFor(type: DatabaseType) {
  return type === "sqlite"
    ? ({ date: "date", flag: "integer" } as const)
    : ({ date: "timestamptz", flag: "boolean" } as const);
}
