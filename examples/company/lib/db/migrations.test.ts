import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { describe, expect, it } from "vitest";
import { authOptions, authorizeWith } from "../auth.ts";
import type { SiteEnv } from "../env.ts";
import { dialectFor } from "./dialect.ts";
import { migrationFiles, migrationNames } from "./migrations-sql.ts";

const ROOT = join(import.meta.dirname, "../..");
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: "http://localhost:4321",
};

/** A SQLite database with every migration D1 applies, as `wrangler d1 migrations apply` leaves it. */
async function migratedSqlite(): Promise<DatabaseSync> {
  const db = new DatabaseSync(":memory:");
  const dir = join(ROOT, "migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  return db;
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

  it("leave Better Auth nothing to add, with the admin plugin's columns", async () => {
    const plan = await getMigrations(authOptions(await migratedSqlite(), SITE_ENV));
    expect(plan.toBeCreated).toEqual([]);
    expect(plan.toBeAdded).toEqual([]);
    expect(plan.toBeAddedIndexes).toEqual([]);
    expect(plan.schemaProblems).toEqual([]);
  });

  it("let editors sign in, and tell Goodfellow who they are", async () => {
    const auth = betterAuth(authOptions(await migratedSqlite(), SITE_ENV));
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
  });
});

describe("dialectFor", () => {
  it("uses D1 where it's bound, Postgres where there's an address, and says so where there's neither", async () => {
    const d1 = { prepare: () => ({}), batch: async () => [], exec: async () => ({}) };
    expect((await dialectFor({ DB: d1 })).type).toBe("sqlite");
    expect((await dialectFor({ DATABASE_URL: "postgres://user:password@db.example.org/site" })).type).toBe("postgres");
    await expect(dialectFor({})).rejects.toThrow(/bind a D1 database as DB, or set DATABASE_URL/);
  });
});
