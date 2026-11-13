import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authOptions, authorizeWith, confirmedPath, MEMBER_ROLE, VERIFY_ACCOUNT_LIMIT } from "./auth.ts";
import { EditorsError, listEditors, removeEditor, setRole } from "./editors.ts";
import { grant, subscribedUntil } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import { giftFrom, giveSubscription, listSubscribers, removeSubscriber, takeAwaySubscription } from "./subscribers.ts";

const SITE = "http://localhost:4321";
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: SITE,
  CLIENT_IP_HEADER: "cf-connecting-ip",
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: "re_test_only",
  EMAIL_FROM: "Example Co <hello@example.org>",
  EMAIL_API_URL: "https://email.example",
};
const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60 * 1000;

/** A stand-in for Resend's API, which keeps the messages it's sent. */
function fakeResend() {
  const sent: { to: string; subject: string; text: string }[] = [];
  vi.stubGlobal("fetch", (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ to: [body.to].flat()[0], subject: body.subject, text: body.text });
    return Response.json({ id: String(sent.length) });
  }) as typeof fetch);
  return sent;
}

/** The `cookie` header a browser would send after an answer. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => !/;\s*Max-Age=0/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** The site's sign-in on a fresh SQLite database, as D1 has it, with Olive the admin signed in, two-factor on. */
async function site(siteEnv: SiteEnv = SITE_ENV) {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  const auth = betterAuth(authOptions(db, siteEnv));
  const context = await auth.$context;
  const person = async (email: string, role: string, verified = true) => {
    const user = await context.internalAdapter.createUser(
      { email, name: email.split("@")[0] ?? email, emailVerified: verified, role },
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
  /** Asks Better Auth's routes as a browser on the site would, from `ip`. */
  const ask = (path: string, body: unknown, ip = "192.0.2.1", cookie?: string) =>
    auth.handler(
      new Request(`${SITE}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          "cf-connecting-ip": ip,
          ...(cookie && { cookie }),
        },
        body: JSON.stringify(body),
      }),
    );
  const signIn = async (email: string, password = PASSWORD) => {
    const response = await ask("/sign-in/email", { email, password });
    return { response, cookie: response.ok ? cookiesOf(response) : undefined };
  };
  /** A request from the subscribers page, or from `from` with another `Sec-Fetch-Site`. */
  const asking = (cookie: string | undefined, method = "POST", from = "same-origin") =>
    new Request(`${SITE}/api/subscribers/`, {
      method,
      headers: { ...(cookie && { cookie }), "sec-fetch-site": from },
    });
  const oliveId = await person("olive@example.org", "admin");
  const olive = (await signIn("olive@example.org")).cookie;
  await context.internalAdapter.updateUser(oliveId, { twoFactorEnabled: true });
  return { auth, db, context, person, ask, signIn, asking, olive, oliveId, close: () => db.close() };
}

afterEach(() => vi.unstubAllGlobals());

/** The link in a message's text. */
function linkIn(text: string | undefined): URL {
  const found = text?.match(/https?:\/\/\S+/);
  if (!found) throw new Error("No link in the message.");
  return new URL(found[0]);
}

describe("signing up", () => {
  it("makes a reader's account, which signs in once the emailed link confirms its address, and can't edit", async () => {
    const sent = fakeResend();
    const { auth, context, ask, signIn, close } = await site();
    try {
      // Signing up can't choose its own role: asking to is refused, and makes no account.
      const choosing = await ask("/sign-up/email", {
        name: "Rita Reader",
        email: "rita@example.org",
        password: PASSWORD,
        role: "admin",
      });
      expect(choosing.status).toBe(400);
      expect(await context.internalAdapter.findUserByEmail("rita@example.org")).toBeNull();
      const answer = await ask("/sign-up/email", {
        name: "Visit https://other.example now",
        email: "rita@example.org",
        password: PASSWORD,
        callbackURL: "/handbook/",
      });
      expect(answer.status).toBe(200);
      expect(cookiesOf(answer)).toBe("");
      const found = await context.internalAdapter.findUserByEmail("rita@example.org");
      expect(found?.user).toMatchObject({ role: MEMBER_ROLE, emailVerified: false });
      // Not until the address is confirmed.
      expect((await signIn("rita@example.org")).response.status).toBe(403);
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toMatchObject({
        to: "rita@example.org",
        subject: "Confirm your email address for localhost:4321",
      });
      // Anyone can sign up with anyone's address, so the email says nothing they typed.
      expect(sent[0]?.text).not.toContain("other.example");
      const link = linkIn(sent[0]?.text);
      expect(`${link.origin}${link.pathname}`).toBe(`${SITE}/api/auth/verify-email/`);
      expect(link.searchParams.get("callbackURL")).toBe("/handbook/");
      // Following it confirms the address, signs in, and goes on to the page they came from.
      const followed = await auth.handler(new Request(link, { headers: { "cf-connecting-ip": "192.0.2.1" } }));
      expect(followed.status).toBe(302);
      expect(followed.headers.get("location")).toBe("/handbook/");
      const cookie = cookiesOf(followed);
      expect(cookie).not.toBe("");
      expect((await context.internalAdapter.findUserByEmail("rita@example.org"))?.user.emailVerified).toBe(true);
      // A reader's account can't edit the site.
      const asking = new Request(`${SITE}/api/goodfellow/session`, { headers: { cookie } });
      expect(await authorizeWith(auth, asking)).toBe(false);
      expect((await signIn("rita@example.org")).response.status).toBe(200);
    } finally {
      close();
    }
  });

  it("answers the same for an address that already has an account, and sends it nothing", async () => {
    const sent = fakeResend();
    const { ask, person, close } = await site();
    try {
      await person("eddie@example.org", "editor");
      const taken = await ask("/sign-up/email", { name: "Eve", email: "eddie@example.org", password: PASSWORD });
      const fresh = await ask("/sign-up/email", { name: "Nina", email: "nina@example.org", password: PASSWORD });
      expect(taken.status).toBe(fresh.status);
      expect(Object.keys(await taken.json()).sort()).toEqual(Object.keys(await fresh.json()).sort());
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent.map((message) => message.to)).toEqual(["nina@example.org"]);
    } finally {
      close();
    }
  });

  it("is refused where the site can't send the email that confirms an address, and for a name that's too long", async () => {
    const { EMAIL_PROVIDER: _, ...withoutEmail } = SITE_ENV;
    const { ask, context, close } = await site(withoutEmail);
    try {
      const answer = await ask("/sign-up/email", { name: "Rita", email: "rita@example.org", password: PASSWORD });
      expect(answer.status).toBe(503);
      expect(await context.internalAdapter.findUserByEmail("rita@example.org")).toBeNull();
    } finally {
      close();
    }
    const { ask: askAgain, close: closeAgain } = await site();
    fakeResend();
    try {
      const long = await askAgain("/sign-up/email", {
        name: "R".repeat(101),
        email: "r@example.org",
        password: PASSWORD,
      });
      expect(long.status).toBe(400);
    } finally {
      closeAgain();
    }
  });

  it("sends an account at most its share of confirmation emails, and none to an invited editor", async () => {
    const sent = fakeResend();
    const { ask, person, close } = await site();
    try {
      await ask("/sign-up/email", { name: "Rita", email: "rita@example.org", password: PASSWORD });
      // From several addresses, so only the account's own limit holds.
      for (let index = 0; index < VERIFY_ACCOUNT_LIMIT.max + 2; index++) {
        await ask("/send-verification-email", { email: "rita@example.org" }, `198.51.100.${index}`);
      }
      // An editor an admin invited, who hasn't chosen a password yet, chooses one from the invitation instead.
      await person("ivy@example.org", "editor", false);
      const invited = await ask("/send-verification-email", { email: "ivy@example.org" }, "203.0.113.9");
      expect(invited.status).toBe(200);
      await vi.waitFor(() => expect(sent).toHaveLength(VERIFY_ACCOUNT_LIMIT.max));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent.map((message) => message.to)).toEqual(Array(VERIFY_ACCOUNT_LIMIT.max).fill("rita@example.org"));
    } finally {
      close();
    }
  });

  it("only ever sends someone on to a page of this site once they've confirmed", () => {
    expect(confirmedPath("/handbook/?a=1#b")).toBe("/handbook/?a=1#b");
    for (const elsewhere of [
      "https://other.example/",
      "//other.example/",
      "/\\other.example",
      "javascript:alert(1)",
      "",
    ]) {
      expect(confirmedPath(elsewhere)).toBe("/");
    }
    expect(confirmedPath(undefined)).toBe("/");
  });
});

describe("the editors page", () => {
  it("lists only editors and admins, and can't change or remove a reader's account", async () => {
    const { auth, person, olive, close } = await site();
    try {
      const readerId = await person("rita@example.org", MEMBER_ROLE);
      await person("eddie@example.org", "editor");
      const request = new Request(`${SITE}/api/editors/`, { headers: { cookie: olive ?? "" } });
      expect((await listEditors(auth, request)).map((editor) => editor.email)).toEqual([
        "olive@example.org",
        "eddie@example.org",
      ]);
      const changing = new Request(`${SITE}/api/editors/`, {
        method: "PATCH",
        headers: { cookie: olive ?? "", "sec-fetch-site": "same-origin" },
      });
      await expect(setRole(auth, changing, readerId, "editor")).rejects.toMatchObject({ status: 404 });
      await expect(removeEditor(auth, changing, readerId)).rejects.toMatchObject({ status: 404 });
    } finally {
      close();
    }
  });
});

describe("the subscribers page", () => {
  it("lists readers, and gives and takes away a subscription by hand, leaving one that was paid for", async () => {
    const { auth, context, person, asking, olive, close } = await site();
    try {
      const ritaId = await person("rita@example.org", MEMBER_ROLE);
      const paulId = await person("paul@example.org", MEMBER_ROLE);
      const eddieId = await person("eddie@example.org", "editor");
      await grant(context.adapter, {
        userId: paulId,
        kind: "subscription",
        reference: "prod_monthly",
        expiresAt: null,
      });
      const until = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
      await giveSubscription(auth, asking(olive), giftFrom({ email: "Rita@Example.org", until }));
      await giveSubscription(auth, asking(olive), giftFrom({ email: "eddie@example.org" }));
      expect((await subscribedUntil(context.adapter, ritaId))?.toISOString().slice(0, 10)).toBe(until);
      expect(await subscribedUntil(context.adapter, eddieId)).toBeNull();
      const listed = await listSubscribers(auth, asking(olive, "GET"));
      expect(listed.map((subscriber) => [subscriber.email, subscriber.subscriptions.map((one) => one.byHand)])).toEqual(
        [
          ["eddie@example.org", [true]],
          ["paul@example.org", [false]],
          ["rita@example.org", [true]],
        ],
      );
      // Giving again replaces what was given, never adding a second.
      await giveSubscription(auth, asking(olive), giftFrom({ email: "rita@example.org" }));
      expect(await subscribedUntil(context.adapter, ritaId)).toBeNull();
      expect((await listSubscribers(auth, asking(olive, "GET")))[2]?.subscriptions).toHaveLength(1);
      await takeAwaySubscription(auth, asking(olive, "DELETE"), ritaId);
      await takeAwaySubscription(auth, asking(olive, "DELETE"), paulId);
      expect(await subscribedUntil(context.adapter, ritaId)).toBeUndefined();
      expect(await subscribedUntil(context.adapter, paulId)).toBeNull();
      // An editor with no subscription isn't a reader, so drops off the list.
      await takeAwaySubscription(auth, asking(olive, "DELETE"), eddieId);
      expect((await listSubscribers(auth, asking(olive, "GET"))).map((subscriber) => subscriber.email)).toEqual([
        "paul@example.org",
        "rita@example.org",
      ]);
    } finally {
      close();
    }
  });

  it("removes only readers' accounts, and is for the site's admins, from its own pages", async () => {
    const { auth, context, person, asking, signIn, olive, close } = await site();
    try {
      const ritaId = await person("rita@example.org", MEMBER_ROLE);
      const eddieId = await person("eddie@example.org", "editor");
      await expect(removeSubscriber(auth, asking(olive, "DELETE"), eddieId)).rejects.toMatchObject({ status: 409 });
      const eddie = (await signIn("eddie@example.org")).cookie;
      const rita = (await signIn("rita@example.org")).cookie;
      for (const cookie of [eddie, rita, undefined]) {
        await expect(listSubscribers(auth, asking(cookie, "GET"))).rejects.toBeInstanceOf(EditorsError);
        await expect(
          giveSubscription(auth, asking(cookie), { email: "rita@example.org", until: null }),
        ).rejects.toBeInstanceOf(EditorsError);
      }
      await expect(
        giveSubscription(auth, asking(olive, "POST", "cross-site"), { email: "rita@example.org", until: null }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        giveSubscription(auth, asking(olive), { email: "nobody@example.org", until: null }),
      ).rejects.toMatchObject({ status: 404 });
      await removeSubscriber(auth, asking(olive, "DELETE"), ritaId);
      expect(await context.internalAdapter.findUserById(ritaId)).toBeNull();
    } finally {
      close();
    }
  });

  it("takes a day after today it lasts until, or none", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(giftFrom({ email: " Rita@Example.org " }, now)).toEqual({ email: "rita@example.org", until: null });
    expect(giftFrom({ email: "rita@example.org", until: "2026-12-01" }, now).until?.toISOString()).toBe(
      "2026-12-01T00:00:00.000Z",
    );
    for (const body of [
      { email: "not an address" },
      { email: "rita@example.org", until: "2026-02-30" },
      { email: "rita@example.org", until: "2026-11-13" },
      { email: "rita@example.org", until: "tomorrow" },
      { email: "rita@example.org", until: 5 },
    ]) {
      expect(() => giftFrom(body, now)).toThrow(EditorsError);
    }
  });
});
