import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Kysely } from "kysely";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { authOptions, authorizeWith, SIGN_IN_LIMIT, signedInWith } from "../auth.ts";
import type { SiteEnv } from "../env.ts";
import { signOutRequest } from "../sign-out.ts";
import { dialectFor } from "./dialect.ts";
import { migratePostgres } from "./migrate.ts";
import { migrationFiles, migrationNames } from "./migrations-sql.ts";
import { addAdmin, d1AdminSql } from "./new-admin.ts";

const ROOT = join(import.meta.dirname, "../..");
const SITE = "http://localhost:4321";
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: SITE,
  CLIENT_IP_HEADER: "cf-connecting-ip",
};
const PASSWORD = "correct horse battery staple";

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

/** The `cookie` header a browser would send after an answer: each cookie's last value, without those it cleared. */
function cookiesOf(response: Response): string {
  const cookies = new Map<string, string>();
  for (const cookie of response.headers.getSetCookie()) {
    const [pair = ""] = cookie.split(";");
    const name = pair.slice(0, pair.indexOf("="));
    if (/;\s*Max-Age=0/i.test(cookie)) cookies.delete(name);
    else cookies.set(name, pair);
  }
  return [...cookies.values()].join("; ");
}

/** The site's sign-in on `database`, with ways to add people and to sign them in. */
async function site(database: Migrated["database"]) {
  const auth = betterAuth(authOptions(database, SITE_ENV));
  const context = await auth.$context;
  /** Adds someone as an admin invites them, giving their id. */
  const person = async (email: string, role: string) => {
    const user = await context.internalAdapter.createUser(
      { email, name: email.split("@")[0], emailVerified: true, role },
      { method: "admin" },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: await context.password.hash(PASSWORD),
    });
    return user.id;
  };
  /** A request from someone who has just signed in. */
  const signedIn = async (email: string) => {
    const response = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
    return new Request(`${SITE}/api/goodfellow/session/`, { headers: { cookie: cookiesOf(response) } });
  };
  return { auth, person, signedIn };
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
      const { auth, person, signedIn } = await site(database);
      await person("olive@example.org", "admin");
      await person("eddie@example.org", "editor");
      await person("vic@example.org", "visitor");
      expect(await authorizeWith(auth, await signedIn("olive@example.org"))).toMatchObject({ role: "owner" });
      expect(await authorizeWith(auth, await signedIn("eddie@example.org"))).toEqual({
        login: "eddie@example.org",
        name: "eddie",
        email: "eddie@example.org",
        role: "editor",
      });
      // Signed in, but not someone who edits the site.
      expect(await authorizeWith(auth, await signedIn("vic@example.org"))).toBe(false);
      expect(await authorizeWith(auth, new Request(`${SITE}/api/goodfellow/session/`))).toBeNull();
    }));

  it("limits how often one address can try to sign in, in every copy of the site", () =>
    withDatabase(open, async (database) => {
      const { person } = await site(database);
      await person("olive@example.org", "admin");
      // A copy of the site of its own, as each Worker is, sharing only the database.
      const attempt = async (address: string) =>
        (
          await betterAuth(authOptions(database, SITE_ENV)).handler(
            new Request(`${SITE}/api/auth/sign-in/email/`, {
              method: "POST",
              headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": address },
              body: JSON.stringify({ email: "olive@example.org", password: "a guess" }),
            }),
          )
        ).status;
      for (let tried = 0; tried < SIGN_IN_LIMIT.max; tried++) expect(await attempt("192.0.2.1")).toBe(401);
      expect(await attempt("192.0.2.1")).toBe(429);
      expect(await attempt("192.0.2.2")).toBe(401);
    }));

  it("lets nobody edit while an admin acts as someone else", () =>
    withDatabase(open, async (database) => {
      const { auth, person, signedIn } = await site(database);
      await person("olive@example.org", "admin");
      const eddie = await person("eddie@example.org", "editor");
      const olive = await signedIn("olive@example.org");
      const acting = await auth.api.impersonateUser({
        body: { userId: eddie },
        headers: olive.headers,
        asResponse: true,
      });
      const request = new Request(`${SITE}/api/goodfellow/session/`, { headers: { cookie: cookiesOf(acting) } });
      expect(await auth.api.getSession({ headers: request.headers })).toMatchObject({ user: { id: eddie } });
      expect(await authorizeWith(auth, request)).toBe(false);
    }));

  it("lets only people whose session is checked see members' pages", () =>
    withDatabase(open, async (database) => {
      const { auth, person, signedIn } = await site(database);
      await person("eddie@example.org", "editor");
      expect((await signedInWith(auth, await signedIn("eddie@example.org"))).signedIn).toBe(true);
      const madeUp = new Request(`${SITE}/members/`, {
        headers: { cookie: "better-auth.session_token=made-up.c2lnbmF0dXJl" },
      });
      expect((await signedInWith(auth, madeUp)).signedIn).toBe(false);
      expect((await signedInWith(auth, new Request(`${SITE}/members/`))).signedIn).toBe(false);
    }));

  it("keeps members' pages from a session that has ended or someone banned, even with its cookie's cached copy", () =>
    withDatabase(open, async (database) => {
      const { auth, person, signedIn } = await site(database);
      const context = await auth.$context;
      const eddie = await person("eddie@example.org", "editor");
      // Sessions end everywhere as a used reset link ends them, while the browser keeps its cookies.
      const before = await signedIn("eddie@example.org");
      expect(before.headers.get("cookie")).toContain("session_data");
      await context.internalAdapter.deleteUserSessions(eddie);
      expect((await signedInWith(auth, before)).signedIn).toBe(false);
      const banned = await signedIn("eddie@example.org");
      await context.internalAdapter.updateUser(eddie, { banned: true });
      expect((await signedInWith(auth, banned)).signedIn).toBe(false);
    }));

  it("signs out only for the site's own pages", () =>
    withDatabase(open, async (database) => {
      const { auth, person, signedIn } = await site(database);
      await person("eddie@example.org", "editor");
      const cookie = (await signedIn("eddie@example.org")).headers.get("cookie") ?? "";
      const request = (method: string, from: string) =>
        new Request(`${SITE}/sign-out/`, { method, headers: { cookie, "sec-fetch-site": from } });
      const elsewhere = await signOutRequest(auth, request("GET", "cross-site"));
      expect(elsewhere.status).toBe(200);
      expect(await elsewhere.text()).toContain('<form method="post" action="/sign-out/">');
      expect((await signOutRequest(auth, request("POST", "cross-site"))).status).toBe(403);
      const session = () =>
        auth.api.getSession({ headers: new Headers({ cookie }), query: { disableCookieCache: true } });
      expect(await session()).not.toBeNull();
      const signedOut = await signOutRequest(auth, request("POST", "same-origin"));
      expect(signedOut.status).toBe(303);
      expect(signedOut.headers.get("location")).toBe("/");
      expect(await session()).toBeNull();
    }));

  it("makes an admin, who can then sign in as an owner", () =>
    withDatabase(open, async (database) => {
      const { auth, signedIn } = await site(database);
      await addAdmin(database, { email: "Olive@example.org", name: " Olive Owner ", password: PASSWORD });
      expect(await authorizeWith(auth, await signedIn("olive@example.org"))).toMatchObject({
        name: "Olive Owner",
        role: "owner",
      });
      await expect(
        addAdmin(database, { email: "olive@example.org", name: "Again", password: PASSWORD }),
      ).rejects.toThrow(/already has an account/);
      await expect(addAdmin(database, { email: "x@example.org", name: "X", password: "short" })).rejects.toThrow(
        /at least 12 characters/,
      );
    }));
});

describe("the site's sign-in", () => {
  it("won't start without a secret of its own", async () => {
    const { database, close } = await migratedSqlite();
    try {
      for (const secret of [undefined, "", "too short"]) {
        expect(() => authOptions(database, { ...SITE_ENV, BETTER_AUTH_SECRET: secret })).toThrow(/BETTER_AUTH_SECRET/);
      }
    } finally {
      await close();
    }
  });

  it("makes an admin in D1 with the SQL wrangler runs", async () => {
    const sql = await d1AdminSql({ email: "olive@example.org", name: "Olive Owner", password: PASSWORD });
    // The password itself is never in it, only Better Auth's hash.
    expect(sql).not.toContain(PASSWORD);
    const { database, close } = await migratedSqlite();
    try {
      (database as DatabaseSync).exec(sql);
      const { auth, signedIn } = await site(database);
      expect(await authorizeWith(auth, await signedIn("olive@example.org"))).toMatchObject({ role: "owner" });
    } finally {
      await close();
    }
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
