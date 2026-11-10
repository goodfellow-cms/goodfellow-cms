import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Kysely } from "kysely";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { authOptions, authorizeWith } from "../auth.ts";
import type { SiteEnv } from "../env.ts";
import { dialectFor } from "./dialect.ts";
import { migratePostgres } from "./migrate.ts";
import { migrationFiles, migrationNames } from "./migrations-sql.ts";

const ROOT = join(import.meta.dirname, "../..");
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: "http://localhost:4321",
};

/** A database with every migration, and what closes it. */
interface Migrated {
  database: Parameters<typeof authOptions>[0];
  close(): Promise<void>;
}

/** A SQLite database with every migration D1 applies, as `wrangler d1 migrations apply` leaves it. */
async function migratedSqlite(): Promise<Migrated> {
  const db = new DatabaseSync(":memory:");
  const dir = join(ROOT, "migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  return { database: db, close: async () => db.close() };
}

/**
 * A new Postgres database beside the one at `DATABASE_URL`, with every migration `npm run migrate` applies, through
 * the site's own dialect. Closing it drops it.
 */
async function migratedPostgres(): Promise<Migrated> {
  const server = new URL(process.env.DATABASE_URL ?? "");
  const name = `company_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: server.href });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(server);
  url.pathname = `/${name}`;
  const db = new Kysely<unknown>({ dialect: (await dialectFor({ DATABASE_URL: url.href })).dialect });
  await migratePostgres(db);
  return {
    database: { db, type: "postgres" },
    async close() {
      await db.destroy();
      await admin.query(`drop database ${name}`);
      await admin.end();
    },
  };
}

/** Each database the site runs on that this computer has: SQLite always, Postgres where `DATABASE_URL` names one. */
const DATABASES: [string, () => Promise<Migrated>][] = [
  ["SQLite", migratedSqlite],
  ...(process.env.DATABASE_URL ? [["Postgres", migratedPostgres] as [string, () => Promise<Migrated>]] : []),
];

/** Runs `test` with a migrated database, closing it after. */
async function withDatabase(open: () => Promise<Migrated>, test: (database: Migrated["database"]) => Promise<void>) {
  const migrated = await open();
  try {
    await test(migrated.database);
  } finally {
    await migrated.close();
  }
}

describe("the database's migrations", () => {
  it("match their SQL files, which `npm run migrations` writes", async () => {
    for (const type of ["sqlite", "postgres"] as const) {
      const dir = join(ROOT, "migrations", type);
      const written = new Map(
        await Promise.all(
          (await readdir(dir)).map(async (name) => [name, await readFile(join(dir, name), "utf8")] as const),
        ),
      );
      expect(written).toEqual(await migrationFiles(type));
    }
  });

  it("are found by their names, so branches that each add one change no file in common", async () => {
    const dir = await mkdtemp(join(tmpdir(), "company-migrations-"));
    try {
      // Two branches' migrations, merged in either order, and files that aren't migrations.
      for (const name of ["20261201090000_add-jobs.ts", "20261130170000_add-orders.ts", "notes.md", "draft.ts"]) {
        await writeFile(join(dir, name), "");
      }
      expect(await migrationNames(dir)).toEqual(["20261130170000_add-orders", "20261201090000_add-jobs"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe.each(DATABASES)("the migrated database, on %s", (_, open) => {
  it("leaves Better Auth nothing to add, with the admin plugin's columns", () =>
    withDatabase(open, async (database) => {
      const plan = await getMigrations(authOptions(database, SITE_ENV));
      expect(plan.toBeCreated).toEqual([]);
      expect(plan.toBeAdded).toEqual([]);
      expect(plan.toBeAddedIndexes).toEqual([]);
      expect(plan.schemaProblems).toEqual([]);
    }));

  it("lets editors sign in, and tells Goodfellow who they are", () =>
    withDatabase(open, async (database) => {
      const auth = betterAuth(authOptions(database, SITE_ENV));
      const context = await auth.$context;
      const person = async (email: string, role: string) => {
        // As an admin invites them.
        const user = await context.internalAdapter.createUser(
          { email, name: email.split("@")[0], emailVerified: true, role },
          { method: "admin" },
        );
        await context.internalAdapter.linkAccount({
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: await context.password.hash("correct horse battery staple"),
        });
      };
      await person("olive@example.org", "admin");
      await person("eddie@example.org", "editor");
      await person("vic@example.org", "visitor");
      const signedIn = async (email: string) => {
        const response = await auth.api.signInEmail({
          body: { email, password: "correct horse battery staple" },
          asResponse: true,
        });
        const cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        return new Request("http://localhost:4321/api/goodfellow/session/", { headers: { cookie } });
      };
      expect(await authorizeWith(auth, await signedIn("olive@example.org"))).toMatchObject({ role: "owner" });
      expect(await authorizeWith(auth, await signedIn("eddie@example.org"))).toEqual({
        login: "eddie@example.org",
        name: "eddie",
        email: "eddie@example.org",
        role: "editor",
      });
      // Signed in, but not someone who edits the site.
      expect(await authorizeWith(auth, await signedIn("vic@example.org"))).toBe(false);
      expect(await authorizeWith(auth, new Request("http://localhost:4321/api/goodfellow/session/"))).toBeNull();
    }));
});

describe("dialectFor", () => {
  it("uses D1 where it's bound, Postgres where there's an address, and says so where there's neither", async () => {
    const d1 = { prepare: () => ({}), batch: async () => [], exec: async () => ({}) };
    expect((await dialectFor({ DB: d1 })).type).toBe("sqlite");
    expect((await dialectFor({ DATABASE_URL: "postgres://user:password@db.example.org/site" })).type).toBe("postgres");
    await expect(dialectFor({})).rejects.toThrow(/bind a D1 database as DB, or set DATABASE_URL/);
  });
});
