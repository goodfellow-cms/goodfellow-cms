import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authOptions,
  authorizeWith,
  lockLinks,
  MAX_NAME_LENGTH,
  MEMBER_ROLE,
  SIGN_UP_LIMIT,
  unlockLinks,
  VERIFY_ACCOUNT_LIMIT,
} from "./auth.ts";
import { acceptInvitation, EditorsError, inviteEditor, listEditors, removeEditor, setRole } from "./editors.ts";
import { grant, subscribedUntil } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import { SignUpError, signUp, signUpFrom } from "./sign-up.ts";
import { sitePath } from "./site-path.ts";
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

/** A sign-up from the site's own sign-up page, from `ip`. */
function signingUp(body: unknown, ip = "192.0.2.1") {
  return new Request(`${SITE}/api/sign-up/`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

/** Chooses a password with a link's token, as the password page does. */
function choose(siteAuth: Parameters<typeof acceptInvitation>[0], token: string, password = PASSWORD) {
  const request = new Request(`${SITE}/api/accept-invite/`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  return acceptInvitation(siteAuth, request, { token, password });
}

describe("signing up", () => {
  it("makes a reader's account, whose password is chosen from the emailed link, and which can't edit", async () => {
    const sent = fakeResend();
    const { auth, context, signIn, close } = await site();
    try {
      // Better Auth's own sign-up, which takes a password before the address is confirmed, is off.
      const direct = await auth.handler(
        new Request(`${SITE}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: SITE },
          body: JSON.stringify({ name: "Rita", email: "rita@example.org", password: PASSWORD }),
        }),
      );
      expect(direct.ok).toBe(false);
      expect(await context.internalAdapter.findUserByEmail("rita@example.org")).toBeNull();

      await signUp(
        auth,
        SITE_ENV,
        signingUp({ name: "  Visit https://other.example now  ", email: " Rita@Example.org ", next: "/handbook/" }),
      );
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      const found = await context.internalAdapter.findUserByEmail("rita@example.org");
      expect(found?.user).toMatchObject({
        role: MEMBER_ROLE,
        emailVerified: false,
        name: "Visit https://other.example now",
      });
      expect(sent[0]).toMatchObject({ to: "rita@example.org", subject: "Choose your password for localhost:4321" });
      // Anyone can sign up with anyone's address, so the email says nothing they typed.
      expect(sent[0]?.text).not.toContain("other.example");
      const link = linkIn(sent[0]?.text);
      expect(`${link.origin}${link.pathname}`).toBe(`${SITE}/accept-invite/`);
      expect(link.searchParams.get("next")).toBe("/handbook/");
      // Nobody signs in before a password is chosen from the link, which confirms the address.
      expect((await signIn("rita@example.org")).response.ok).toBe(false);
      await choose(auth, link.searchParams.get("token") ?? "");
      expect((await context.internalAdapter.findUserByEmail("rita@example.org"))?.user.emailVerified).toBe(true);
      const { response, cookie } = await signIn("rita@example.org");
      expect(response.status).toBe(200);
      // A reader's account can't edit the site.
      const asking = new Request(`${SITE}/api/goodfellow/session`, { headers: { cookie: cookie ?? "" } });
      expect(await authorizeWith(auth, asking)).toBe(false);
    } finally {
      close();
    }
  });

  it("never lets whoever signed up with someone else's address in, and sends its owner a new link when they sign up", async () => {
    const sent = fakeResend();
    const { auth, context, signIn, close } = await site();
    try {
      // A stranger signs up with Rita's address: they never learn a password that works.
      await signUp(auth, SITE_ENV, signingUp({ name: "Mallory", email: "rita@example.org" }));
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      expect((await signIn("rita@example.org", "anything the stranger might try")).response.ok).toBe(false);
      // Rita, whose first link ran out, signs up again herself, and gets a new one, which is the one that works.
      await signUp(auth, SITE_ENV, signingUp({ name: "Rita", email: "rita@example.org" }, "198.51.100.7"));
      await vi.waitFor(() => expect(sent).toHaveLength(2));
      const first = linkIn(sent[0]?.text).searchParams.get("token") ?? "";
      const second = linkIn(sent[1]?.text).searchParams.get("token") ?? "";
      await expect(choose(auth, first)).rejects.toThrow(EditorsError);
      await choose(auth, second, "rita's very own password");
      expect((await signIn("rita@example.org", "rita's very own password")).response.status).toBe(200);
      // Once she has a password, signing up with her address sends nothing more.
      await signUp(auth, SITE_ENV, signingUp({ name: "Mallory", email: "rita@example.org" }, "203.0.113.8"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent).toHaveLength(2);
      expect((await context.internalAdapter.findUserByEmail("rita@example.org"))?.user.emailVerified).toBe(true);
    } finally {
      close();
    }
  });

  it("answers the same for an address that already has an account, and sends an editor's nothing", async () => {
    const sent = fakeResend();
    const { auth, person, close } = await site();
    try {
      await person("eddie@example.org", "editor");
      await person("ivy@example.org", "editor", false);
      for (const email of ["eddie@example.org", "ivy@example.org", "nina@example.org"]) {
        await expect(
          signUp(auth, SITE_ENV, signingUp({ name: "Eve", email }, `198.51.100.${email.length}`)),
        ).resolves.toBeUndefined();
      }
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent.map((message) => message.to)).toEqual(["nina@example.org"]);
    } finally {
      close();
    }
  });

  it("sends an account at most its share of links, and lets each address sign up only so often", async () => {
    const sent = fakeResend();
    const { auth, context, close } = await site();
    try {
      // From several addresses, so only the account's own limit holds.
      for (let index = 0; index < VERIFY_ACCOUNT_LIMIT.max + 2; index++) {
        await signUp(auth, SITE_ENV, signingUp({ name: "Rita", email: "rita@example.org" }, `198.51.100.${index}`));
        // One after another, as people asking at different times would.
        await vi.waitFor(() => expect(sent).toHaveLength(Math.min(index + 1, VERIFY_ACCOUNT_LIMIT.max)));
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(sent).toHaveLength(VERIFY_ACCOUNT_LIMIT.max);
      // A sign-up that made no link, as while another of the account's is being sent or used, uses none of its share.
      await signUp(auth, SITE_ENV, signingUp({ name: "Paul", email: "paul@example.org" }, "192.0.2.50"));
      await vi.waitFor(() => expect(sent).toHaveLength(VERIFY_ACCOUNT_LIMIT.max + 1));
      const paul = (await context.internalAdapter.findUserByEmail("paul@example.org"))?.user.id ?? "";
      const holder = await lockLinks(context.adapter, paul);
      await signUp(auth, SITE_ENV, signingUp({ name: "Paul", email: "paul@example.org" }, "192.0.2.51"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent).toHaveLength(VERIFY_ACCOUNT_LIMIT.max + 1);
      await unlockLinks(context.adapter, paul, holder ?? "");
      for (let index = 1; index < VERIFY_ACCOUNT_LIMIT.max; index++) {
        await signUp(auth, SITE_ENV, signingUp({ name: "Paul", email: "paul@example.org" }, `192.0.2.${60 + index}`));
        await vi.waitFor(() => expect(sent).toHaveLength(VERIFY_ACCOUNT_LIMIT.max + 1 + index));
      }
      // From one address, only so many sign-ups at all, whatever their addresses.
      for (let index = 0; index < SIGN_UP_LIMIT.max; index++) {
        await signUp(auth, SITE_ENV, signingUp({ name: "N", email: `n${index}@example.org` }, "203.0.113.1"));
      }
      const over = signUp(auth, SITE_ENV, signingUp({ name: "N", email: "over@example.org" }, "203.0.113.1"));
      await expect(over).rejects.toMatchObject({ status: 429 });
    } finally {
      close();
    }
  });

  it("is refused where the site can't send email, from other sites, and for a name or address that won't do", async () => {
    const { EMAIL_PROVIDER: _, ...withoutEmail } = SITE_ENV;
    const { auth, context, close } = await site(withoutEmail);
    try {
      const refused = signUp(auth, withoutEmail, signingUp({ name: "Rita", email: "rita@example.org" }));
      await expect(refused).rejects.toMatchObject({ status: 503 });
      expect(await context.internalAdapter.findUserByEmail("rita@example.org")).toBeNull();
      const elsewhere = new Request(`${SITE}/api/sign-up/`, {
        method: "POST",
        headers: { "sec-fetch-site": "cross-site" },
        body: "{}",
      });
      await expect(signUp(auth, SITE_ENV, elsewhere)).rejects.toMatchObject({ status: 403 });
    } finally {
      close();
    }
    // The name's length counts as it's sent, so spaces can't make a long one fit.
    expect(() => signUpFrom({ name: `a${" ".repeat(MAX_NAME_LENGTH)}`, email: "a@example.org" })).toThrow(SignUpError);
    expect(() => signUpFrom({ name: "R".repeat(MAX_NAME_LENGTH + 1), email: "a@example.org" })).toThrow(SignUpError);
    expect(() => signUpFrom({ name: "   ", email: "a@example.org" })).toThrow(SignUpError);
    expect(() => signUpFrom({ name: "Rita", email: "not an address" })).toThrow(SignUpError);
    expect(signUpFrom({ name: "R".repeat(MAX_NAME_LENGTH), email: "a@example.org", next: "//other.example/" })).toEqual(
      {
        name: "R".repeat(MAX_NAME_LENGTH),
        email: "a@example.org",
        next: "/",
      },
    );
  });

  it("lets an admin invite an address someone signed up with but never chose a password for", async () => {
    const sent = fakeResend();
    const { auth, context, olive, asking, close } = await site();
    try {
      await signUp(auth, SITE_ENV, signingUp({ name: "Mallory", email: "ivy@example.org" }));
      await vi.waitFor(() => expect(sent).toHaveLength(1));
      await inviteEditor(auth, SITE_ENV, asking(olive), { email: "ivy@example.org", name: "Ivy", role: "editor" });
      await vi.waitFor(() => expect(sent).toHaveLength(2));
      expect((await context.internalAdapter.findUserByEmail("ivy@example.org"))?.user).toMatchObject({
        name: "Ivy",
        role: "editor",
      });
      // The sign-up's link stops working: only the invitation's sets the password.
      const signedUp = linkIn(sent[0]?.text).searchParams.get("token") ?? "";
      await expect(choose(auth, signedUp)).rejects.toThrow(EditorsError);
      // Someone who has chosen a password is refused, as before.
      await choose(auth, linkIn(sent[1]?.text).searchParams.get("token") ?? "");
      const again = inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "ivy@example.org",
        name: "Ivy",
        role: "editor",
      });
      await expect(again).rejects.toMatchObject({ status: 409 });
    } finally {
      close();
    }
  });

  it("only ever sends someone on to a page of this site", () => {
    expect(sitePath("/handbook/?a=1#b")).toBe("/handbook/?a=1#b");
    for (const elsewhere of [
      "https://other.example/",
      "//other.example/",
      "/\\other.example",
      "javascript:alert(1)",
      "",
    ]) {
      expect(sitePath(elsewhere)).toBe("/");
    }
    expect(sitePath(undefined, "/admin/")).toBe("/admin/");
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
      // A period an editor paid for long ago, which stays recorded, but isn't a subscription now.
      const ellaId = await person("ella@example.org", "editor");
      await grant(context.adapter, {
        userId: ellaId,
        kind: "subscription",
        reference: "stripe:sub_old",
        expiresAt: new Date(Date.now() - DAY),
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
      // An account with no role is a reader's on both pages: listed as one with a subscription, and removable.
      const noneId = await person("nora@example.org", MEMBER_ROLE);
      await context.internalAdapter.updateUser(noneId, { role: null });
      await giveSubscription(auth, asking(olive), { email: "nora@example.org", until: null });
      const nora = (await listSubscribers(auth, asking(olive, "GET"))).find((one) => one.id === noneId);
      expect(nora?.role).toBe(MEMBER_ROLE);
      await removeSubscriber(auth, asking(olive, "DELETE"), noneId);
      expect(await context.internalAdapter.findUserById(noneId)).toBeNull();
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

  it("takes a day it lasts to the end of, today or later, or none", () => {
    const now = new Date("2026-11-13T12:00:00Z");
    expect(giftFrom({ email: " Rita@Example.org " }, now)).toEqual({ email: "rita@example.org", until: null });
    // To the end of the day chosen, UTC, which the page shows as that day.
    expect(giftFrom({ email: "rita@example.org", until: "2026-12-01" }, now).until?.toISOString()).toBe(
      "2026-12-01T23:59:59.999Z",
    );
    expect(giftFrom({ email: "rita@example.org", until: "2026-11-13" }, now).until?.toISOString()).toBe(
      "2026-11-13T23:59:59.999Z",
    );
    // Late in the day west of UTC, where it's already tomorrow there, tomorrow where the admin is can be chosen.
    const evening = new Date("2026-11-14T02:00:00Z");
    expect(giftFrom({ email: "rita@example.org", until: "2026-11-14" }, evening).until?.toISOString()).toBe(
      "2026-11-14T23:59:59.999Z",
    );
    for (const body of [
      { email: "not an address" },
      { email: "rita@example.org", until: "2026-02-30" },
      { email: "rita@example.org", until: "2026-11-12" },
      { email: "rita@example.org", until: "tomorrow" },
      { email: "rita@example.org", until: 5 },
    ]) {
      expect(() => giftFrom(body, now)).toThrow(EditorsError);
    }
  });
});
