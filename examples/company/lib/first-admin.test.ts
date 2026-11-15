import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setupCodeHash } from "@goodfellow-cms/core";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it } from "vitest";
import { type AdminMaker, createAdmin, newAdminProblem } from "./admins.ts";
import { authOptions } from "./auth.ts";
import type { SiteEnv } from "./env.ts";
import { SETUP_DONE, SETUP_LIMIT, SetupError, setUpFirstAdmin, setupProblem } from "./first-admin.ts";
import { PASSWORD, SITE, SITE_ENV } from "./testing/site.ts";

const CODE = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX";
const open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

/** The site's sign-in on a fresh database with no accounts, with wrangler.jsonc's setup code hash where `withCode`. */
async function freshSite(withCode = true) {
  const db = new DatabaseSync(":memory:");
  open.push(db);
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  const siteEnv: SiteEnv = { ...SITE_ENV, ...(withCode && { GOODFELLOW_SETUP_CODE_HASH: await setupCodeHash(CODE) }) };
  const auth = betterAuth(authOptions(db, siteEnv));
  const setUp = (body: Record<string, unknown>, { from = "same-origin", ip = "192.0.2.1" } = {}) =>
    setUpFirstAdmin(
      auth,
      siteEnv,
      new Request(`${SITE}/api/setup/`, {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": from, "cf-connecting-ip": ip },
        body: JSON.stringify(body),
      }),
    );
  const admins = () =>
    db
      .prepare(`select email from "user" where role = 'admin'`)
      .all()
      .map((row) => row.email);
  /** Signs in as a browser on the site would. */
  const signIn = (email: string, password = PASSWORD) =>
    auth.handler(
      new Request(`${SITE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": "192.0.2.9" },
        body: JSON.stringify({ email, password }),
      }),
    );
  return { auth, db, setUp, admins, signIn };
}

const OLIVE = { code: CODE, email: "Olive@Example.org", name: " Olive Owner ", password: PASSWORD };

/** The status of the `SetupError` a promise fails with. */
async function statusOf(work: Promise<unknown>): Promise<number | undefined> {
  try {
    await work;
    return undefined;
  } catch (error) {
    if (error instanceof SetupError) return error.status;
    throw error;
  }
}

describe("setUpFirstAdmin", () => {
  it("makes whoever has the setup code the site's first admin, once, who can then sign in", async () => {
    const site = await freshSite();
    // Typed as people do: in lowercase, with spaces in place of the dashes.
    await site.setUp({ ...OLIVE, code: CODE.toLowerCase().replaceAll("-", " ") });
    expect(site.admins()).toEqual(["olive@example.org"]);
    expect((await site.signIn("olive@example.org")).status).toBe(200);
    // The code does nothing more, whoever asks, with any address.
    expect(await statusOf(site.setUp({ ...OLIVE, email: "mallory@example.org" }))).toBe(409);
    expect(site.admins()).toEqual(["olive@example.org"]);
  });

  it("refuses a wrong code, and says nothing about whether the site has an admin", async () => {
    const site = await freshSite();
    expect(await statusOf(site.setUp({ ...OLIVE, code: "ABCD-EFGH-IJKL-MNOP-QRST-UVWY" }))).toBe(403);
    expect(site.admins()).toEqual([]);
    await site.setUp(OLIVE);
    expect(await statusOf(site.setUp({ ...OLIVE, code: "WRONG" }))).toBe(403);
  });

  it("does nothing on a site without a setup code, or for requests from anywhere but its own pages", async () => {
    const without = await freshSite(false);
    expect(await statusOf(without.setUp(OLIVE))).toBe(404);
    const site = await freshSite();
    expect(await statusOf(site.setUp(OLIVE, { from: "cross-site" }))).toBe(403);
    expect(site.admins()).toEqual([]);
  });

  it("makes no admin where the site has one already, such as one npm run new-admin made", async () => {
    const site = await freshSite();
    const context = await site.auth.$context;
    await context.internalAdapter.createUser(
      { email: "ada@example.org", name: "Ada", emailVerified: true, role: "admin" },
      { method: "admin" },
    );
    expect(await statusOf(site.setUp(OLIVE))).toBe(409);
    expect(site.admins()).toEqual(["ada@example.org"]);
  });

  it("makes one admin when two ask at the same moment", async () => {
    const site = await freshSite();
    const results = await Promise.allSettled([
      site.setUp(OLIVE),
      site.setUp({ ...OLIVE, email: "otto@example.org", name: "Otto" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(site.admins()).toHaveLength(1);
  });

  it("makes no admin while another request holds the setup code's row, as it does while making one", async () => {
    const site = await freshSite();
    const context = await site.auth.$context;
    // What a request that's past the checks, and making its admin, has written.
    await context.adapter.create({
      model: "verification",
      data: {
        id: SETUP_DONE,
        identifier: SETUP_DONE,
        value: "another request",
        expiresAt: new Date("9999-12-31T00:00:00Z"),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      forceAllowId: true,
    });
    expect(await statusOf(site.setUp(OLIVE))).toBe(409);
    expect(site.admins()).toEqual([]);
  });

  it("lets the code be used again when making the admin failed, such as for an address someone has", async () => {
    const site = await freshSite();
    const context = await site.auth.$context;
    await context.internalAdapter.createUser(
      { email: "rita@example.org", name: "Rita", emailVerified: true, role: "member" },
      { method: "admin" },
    );
    expect(await statusOf(site.setUp({ ...OLIVE, email: "rita@example.org" }))).toBe(409);
    expect(site.db.prepare(`select id from verification where id = ?`).all(SETUP_DONE)).toEqual([]);
    await site.setUp(OLIVE);
    expect(site.admins()).toEqual(["olive@example.org"]);
  });

  it("checks what's sent, before the code", async () => {
    const site = await freshSite();
    expect(await statusOf(site.setUp({ ...OLIVE, code: "" }))).toBe(400);
    expect(await statusOf(site.setUp({ ...OLIVE, email: "olive" }))).toBe(400);
    expect(await statusOf(site.setUp({ ...OLIVE, name: "  " }))).toBe(400);
    expect(await statusOf(site.setUp({ ...OLIVE, name: "o".repeat(101) }))).toBe(400);
    expect(await statusOf(site.setUp({ ...OLIVE, password: "short" }))).toBe(400);
    expect(await statusOf(site.setUp({ ...OLIVE, email: 7 }))).toBe(400);
    expect(site.admins()).toEqual([]);
  });

  it("takes the addresses and passwords Better Auth's sign-in takes, and no others", async () => {
    const site = await freshSite();
    for (const email of ["owner@localhost", "o'neil@example.org", "a.b@example.co", ".a@example.org", "a..b@ex.org"]) {
      // Better Auth answers 400 for an address it can't read, and 401 for one with no account.
      const signIn = (await site.signIn(email)).status;
      expect(newAdminProblem({ email, name: "Olive", password: PASSWORD }) === undefined, email).toBe(signIn === 401);
    }
    // In the words of someone making themselves the admin.
    await expect(site.setUp({ ...OLIVE, email: "owner@localhost" })).rejects.toThrow("Give your email address.");
    // Its sign-in refuses passwords past 128 characters.
    expect((await site.signIn("olive@example.org", "p".repeat(129))).status).toBe(400);
    expect(newAdminProblem({ ...OLIVE, password: "p".repeat(129) })).toBe("Use a password of at most 128 characters.");
    await expect(site.setUp({ ...OLIVE, password: "p".repeat(129) })).rejects.toThrow("and at most 128.");
    await site.setUp({ ...OLIVE, password: "p".repeat(128) });
    expect((await site.signIn("olive@example.org", "p".repeat(128))).status).toBe(200);
  });

  it("leaves no admin without a password, whichever write fails", async () => {
    const made: string[] = [];
    const maker = (fails: "hash" | "link" | "link and delete" | "promote"): AdminMaker => ({
      internalAdapter: {
        findUserByEmail: async () => null,
        createUser: async (user) => {
          made.push(`user as ${user.role}`);
          return { id: "u1" };
        },
        updateUser: async (_id, data) => {
          if (fails === "promote") throw new Error("D1 went away");
          made.push(`now ${data.role}`);
        },
        linkAccount: async () => {
          if (fails !== "hash" && fails !== "promote") throw new Error("D1 went away");
          made.push("account");
        },
        deleteUser: async () => {
          if (fails === "link and delete") throw new Error("D1 still away");
          made.push("deleted");
        },
      },
      password: {
        hash: async () => {
          if (fails === "hash") throw new Error("no hashing today");
          return "hashed";
        },
      },
    });
    await expect(createAdmin(maker("hash"), OLIVE)).rejects.toThrow("no hashing today");
    expect(made).toEqual([]);
    await expect(createAdmin(maker("link"), OLIVE)).rejects.toThrow("D1 went away");
    expect(made).toEqual(["user as member", "deleted"]);
    // Where removing it fails too, what's left is a reader's account, never an admin's, so setup can still be done.
    made.length = 0;
    await expect(createAdmin(maker("link and delete"), OLIVE)).rejects.toThrow("D1 went away");
    expect(made).toEqual(["user as member"]);
    // Where making them an admin fails, the account goes too, so the same address can try again.
    made.length = 0;
    await expect(createAdmin(maker("promote"), OLIVE)).rejects.toThrow("D1 went away");
    expect(made).toEqual(["user as member", "account", "deleted"]);
  });

  it("takes at most SETUP_LIMIT's tries from one address an hour", async () => {
    const site = await freshSite();
    for (let tries = 0; tries < SETUP_LIMIT.max; tries++) {
      expect(await statusOf(site.setUp({ ...OLIVE, code: "WRONG" }))).toBe(403);
    }
    expect(await statusOf(site.setUp(OLIVE))).toBe(429);
    // Another address still can.
    await site.setUp(OLIVE, { ip: "198.51.100.7" });
    expect(site.admins()).toEqual(["olive@example.org"]);
  });

  it("answers problems in words, and nothing about anything else", async () => {
    const known = setupProblem(new SetupError(403, "That isn't this site's setup code."));
    expect(known.status).toBe(403);
    expect(await known.json()).toEqual({ error: "That isn't this site's setup code." });
    const other = setupProblem(new Error("database password is hunter2"));
    expect(other.status).toBe(500);
    expect(JSON.stringify(await other.json())).not.toContain("hunter2");
  });
});
