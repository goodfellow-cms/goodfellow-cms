import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authOptions, authorizeWith, RESET_ACCOUNT_LIMIT } from "./auth.ts";
import {
  acceptInvitation,
  EditorsError,
  invitationFrom,
  inviteAgain,
  inviteEditor,
  listEditors,
  removeEditor,
  setRole,
} from "./editors.ts";
import { escapeHtml, invitationEmail, sendEmail } from "./email.ts";
import type { SiteEnv } from "./env.ts";

const SITE = "http://localhost:4321";
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: SITE,
  CLIENT_IP_HEADER: "cf-connecting-ip",
};
const EMAIL_ENV: SiteEnv = {
  ...SITE_ENV,
  RESEND_API_KEY: "re_test_only",
  EMAIL_FROM: "Example Co <hello@example.org>",
  RESEND_API_URL: "https://resend.example",
};
const PASSWORD = "correct horse battery staple";

/** What a stand-in for Resend was sent. */
interface Sent {
  url: string;
  authorization: string | null;
  body: { from: string; to: string[]; subject: string; text: string; html: string };
}

/** A stand-in for Resend's API, which keeps what it's sent and answers `status`. */
function fakeResend(status = 200) {
  const sent: Sent[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return new Response("{}", { status });
  }) as typeof fetch;
  return { sent, fetcher };
}

/** The link in a message's text. */
function linkIn(sent: Sent): URL {
  const found = sent.body.text.match(/https?:\/\/\S+/);
  if (!found) throw new Error("No link in the message.");
  return new URL(found[0]);
}

/** The `cookie` header a browser would send after an answer. */
function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => !/;\s*Max-Age=0/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** The site's sign-in on a fresh SQLite database, as D1 has it, with Olive the admin signed in. */
async function site(siteEnv: SiteEnv = SITE_ENV) {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  const auth = betterAuth(authOptions(db, siteEnv));
  const context = await auth.$context;
  const person = async (email: string, role: string, name = email.split("@")[0] ?? email) => {
    const user = await context.internalAdapter.createUser(
      { email, name, emailVerified: true, role },
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
  const signIn = async (email: string, password = PASSWORD) => {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    return response.ok ? cookiesOf(response) : undefined;
  };
  /** A request from the editors page, or from `from` with another `Sec-Fetch-Site`. */
  const asking = (cookie: string | undefined, method = "POST", from = "same-origin") =>
    new Request(`${SITE}/api/editors/`, { method, headers: { ...(cookie && { cookie }), "sec-fetch-site": from } });
  const oliveId = await person("olive@example.org", "admin", "Olive Owner");
  const olive = await signIn("olive@example.org");
  return { auth, context, person, signIn, asking, olive, oliveId, close: () => db.close() };
}

afterEach(() => vi.unstubAllGlobals());

describe("invitationFrom", () => {
  it("takes an address, a name, and a role, and refuses anything else", () => {
    expect(invitationFrom({ email: " Eddie@Example.org ", name: " Eddie ", role: "admin" })).toEqual({
      email: "eddie@example.org",
      name: "Eddie",
      role: "admin",
    });
    expect(invitationFrom({ email: "eddie@example.org", name: "Eddie" }).role).toBe("editor");
    for (const body of [
      undefined,
      { email: "not an address", name: "Eddie" },
      { email: "eddie@example.org", name: "" },
      { email: "eddie@example.org", name: "Eddie", role: "owner" },
    ]) {
      expect(() => invitationFrom(body)).toThrow(EditorsError);
    }
  });
});

describe("emails", () => {
  it("escape what people typed in their HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
    const email = invitationEmail({
      to: "eddie@example.org",
      name: "<script>alert(1)</script>",
      invitedBy: 'Olive "O" Owner',
      siteUrl: SITE,
      link: `${SITE}/accept-invite/?token=abc&x=<y>`,
      hours: 48,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain('href="http://localhost:4321/accept-invite/?token=abc&amp;x=&lt;y&gt;"');
    expect(email.subject).toBe("You're invited to edit localhost:4321");
  });

  it("go through Resend with the site's key, and say only its status when it refuses", async () => {
    const resend = fakeResend();
    const email = { to: "eddie@example.org", subject: "Hello", text: "Hi", html: "<p>Hi</p>" };
    await sendEmail(EMAIL_ENV, email, resend.fetcher);
    expect(resend.sent[0]).toMatchObject({
      url: "https://resend.example/emails",
      authorization: "Bearer re_test_only",
      body: { from: "Example Co <hello@example.org>", to: ["eddie@example.org"], subject: "Hello" },
    });
    await expect(sendEmail(EMAIL_ENV, email, fakeResend(403).fetcher)).rejects.toThrow(/answered 403\.$/);
    await expect(sendEmail(SITE_ENV, email, resend.fetcher)).rejects.toThrow(/RESEND_API_KEY and EMAIL_FROM/);
  });
});

describe("the editors API", () => {
  it("lets admins invite someone, who chooses a password with the link, once", async () => {
    const { auth, asking, olive, signIn, close } = await site(EMAIL_ENV);
    try {
      const resend = fakeResend();
      const invitation = { email: "eddie@example.org", name: "Eddie", role: "editor" as const };
      expect(await inviteEditor(auth, EMAIL_ENV, asking(olive), invitation, resend.fetcher)).toEqual({ sent: true });
      const [sent] = resend.sent;
      if (!sent) throw new Error("Nothing was sent.");
      expect(sent.body.to).toEqual(["eddie@example.org"]);
      expect(sent.body.text).toContain("Olive Owner has invited you to edit localhost:4321");
      const link = linkIn(sent);
      expect(link.origin + link.pathname).toBe(`${SITE}/accept-invite/`);
      expect(await listEditors(auth, asking(olive, "GET"))).toMatchObject([
        { email: "olive@example.org", role: "admin", joined: true },
        { email: "eddie@example.org", name: "Eddie", role: "editor", joined: false },
      ]);
      // The random password nobody knows doesn't sign anyone in.
      expect(await signIn("eddie@example.org")).toBeUndefined();

      const token = link.searchParams.get("token");
      const accept = (password: string, from = "same-origin") =>
        acceptInvitation(auth, asking(undefined, "POST", from), { token, password });
      await expect(accept(PASSWORD, "cross-site")).rejects.toMatchObject({ status: 403 });
      await expect(accept("short")).rejects.toThrow(/at least 12 characters/);
      await accept(PASSWORD);
      const eddie = await signIn("eddie@example.org");
      expect(await authorizeWith(auth, new Request(SITE, { headers: { cookie: eddie ?? "" } }))).toMatchObject({
        role: "editor",
      });
      expect((await listEditors(auth, asking(olive, "GET")))[1]).toMatchObject({ joined: true });
      await expect(accept("another long password")).rejects.toThrow(/already been used or has run out/);
      await expect(inviteEditor(auth, EMAIL_ENV, asking(olive), invitation, resend.fetcher)).rejects.toMatchObject({
        status: 409,
      });
    } finally {
      close();
    }
  });

  it("hands over the link where the site can't send email, and sends a new one on asking", async () => {
    const { auth, asking, olive, close } = await site();
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      expect(invited.link).toMatch(/^http:\/\/localhost:4321\/accept-invite\/\?token=/);
      const eddie = (await listEditors(auth, asking(olive, "GET"))).find((editor) => !editor.joined);
      if (!eddie) throw new Error("Eddie isn't listed.");
      expect(eddie.role).toBe("admin");
      const again = await inviteAgain(auth, SITE_ENV, asking(olive), eddie.id);
      if (again.sent) throw new Error("It said it sent an email.");
      expect(again.link).not.toBe(invited.link);
      const accept = (link: string, password = PASSWORD) =>
        acceptInvitation(auth, asking(undefined), { token: new URL(link).searchParams.get("token"), password });
      // The first link, which might have gone astray, stops working once there's a new one.
      await expect(accept(invited.link)).rejects.toThrow(/already been used or has run out/);
      await accept(again.link);
    } finally {
      close();
    }
  });

  it("says why an invitation couldn't be sent, without Resend's answer", async () => {
    const { auth, asking, olive, close } = await site(EMAIL_ENV);
    try {
      const invitation = { email: "eddie@example.org", name: "Eddie", role: "editor" as const };
      await expect(inviteEditor(auth, EMAIL_ENV, asking(olive), invitation, fakeResend(500).fetcher)).rejects.toThrow(
        "The invitation couldn't be sent. Check the site's email settings, then send it again.",
      );
    } finally {
      close();
    }
  });

  it("answers only admins, from the site's own pages", async () => {
    const { auth, asking, olive, person, signIn, close } = await site();
    try {
      await person("eddie@example.org", "editor");
      const eddie = await signIn("eddie@example.org");
      const invitation = { email: "x@example.org", name: "X", role: "admin" as const };
      await expect(listEditors(auth, asking(undefined, "GET"))).rejects.toMatchObject({ status: 401 });
      await expect(listEditors(auth, asking(eddie, "GET"))).rejects.toMatchObject({ status: 403 });
      await expect(inviteEditor(auth, SITE_ENV, asking(eddie), invitation)).rejects.toMatchObject({ status: 403 });
      // A form on another site, with an admin's cookies.
      await expect(inviteEditor(auth, SITE_ENV, asking(olive, "POST", "cross-site"), invitation)).rejects.toMatchObject(
        { status: 403 },
      );
    } finally {
      close();
    }
  });

  it("makes the person's other links stop working once they choose a password", async () => {
    const { auth, asking, olive, close } = await site();
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      // A reset link for the same account, as Better Auth makes one.
      const context = await auth.$context;
      const eddie = await context.internalAdapter.findUserByEmail("eddie@example.org");
      await context.internalAdapter.createVerificationValue({
        value: eddie?.user.id ?? "",
        identifier: "reset-password:a-reset-link-that-went-astray",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      // Someone else's verifications stay.
      await context.internalAdapter.createVerificationValue({
        value: "someone else",
        identifier: "reset-password:someone-elses-link",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await acceptInvitation(auth, asking(undefined), {
        token: new URL(invited.link).searchParams.get("token"),
        password: PASSWORD,
      });
      await expect(
        auth.api.resetPassword({
          body: { token: "a-reset-link-that-went-astray", newPassword: "a brand new password" },
        }),
      ).rejects.toThrow();
      expect(await context.internalAdapter.findVerificationValue("reset-password:someone-elses-link")).toBeTruthy();
    } finally {
      close();
    }
  });

  it("leaves at most one link working when links are sent again at once, or while one is being used", async () => {
    const { auth, asking, olive, close } = await site();
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      const eddieId = (await (await auth.$context).internalAdapter.findUserByEmail("eddie@example.org"))?.user.id ?? "";
      const token = (link: string) => new URL(link).searchParams.get("token");
      const works = async (link: string) => {
        const context = await auth.$context;
        return Boolean(await context.internalAdapter.findVerificationValue(`reset-password:${token(link)}`));
      };
      const again = await Promise.all([1, 2, 3].map(() => inviteAgain(auth, SITE_ENV, asking(olive), eddieId)));
      const links = [invited.link, ...again.map((sent) => (sent.sent ? "" : sent.link))];
      expect((await Promise.all(links.map(works))).filter(Boolean).length).toBeLessThanOrEqual(1);

      // Sent again while the person chooses a password with the link they have.
      const fresh = await inviteAgain(auth, SITE_ENV, asking(olive), eddieId);
      if (fresh.sent) throw new Error("It said it sent an email.");
      const [accepted, during] = await Promise.allSettled([
        acceptInvitation(auth, asking(undefined), { token: token(fresh.link), password: PASSWORD }),
        inviteAgain(auth, SITE_ENV, asking(olive), eddieId),
      ]);
      const made = during.status === "fulfilled" && !during.value.sent ? [during.value.link] : [];
      const working = await Promise.all([...links, fresh.link, ...made].map(works));
      // Once they've chosen a password no link works; where the new link came first, only it does.
      expect(working.filter(Boolean).length).toBe(accepted.status === "fulfilled" ? 0 : made.length);
    } finally {
      close();
    }
  });

  it("lists, and changes, everyone however many there are", async () => {
    const { auth, asking, olive, context, close } = await site();
    try {
      const ids: string[] = [];
      for (let index = 0; index < 520; index++) {
        const user = await context.internalAdapter.createUser(
          { email: `person-${index}@example.org`, name: `Person ${index}`, emailVerified: false, role: "editor" },
          { method: "admin" },
        );
        ids.push(user.id);
      }
      const listed = await listEditors(auth, asking(olive, "GET"));
      expect(listed).toHaveLength(521);
      expect(new Set(listed.map((editor) => editor.id)).size).toBe(521);
      // People the first page, read by id, leaves out.
      const sorted = [...ids].sort();
      const last = sorted.at(-1) ?? "";
      await setRole(auth, asking(olive, "PATCH"), last, "admin");
      expect(await inviteAgain(auth, SITE_ENV, asking(olive), sorted.at(-2) ?? "")).toMatchObject({ sent: false });
      await removeEditor(auth, asking(olive, "DELETE"), last);
      await expect(setRole(auth, asking(olive, "PATCH"), last, "editor")).rejects.toMatchObject({ status: 404 });
    } finally {
      close();
    }
  });

  it("keeps Better Auth's admin routes from browsers, so an admin can't demote themselves there", async () => {
    const { auth, olive, oliveId, close } = await site();
    try {
      for (const path of ["admin/set-role", "admin/set-role/", "admin/remove-user", "admin/list-users"]) {
        const response = await auth.handler(
          new Request(`${SITE}/api/auth/${path}`, {
            method: path.endsWith("list-users") ? "GET" : "POST",
            headers: { cookie: olive ?? "", origin: SITE, "content-type": "application/json" },
            ...(!path.endsWith("list-users") && { body: JSON.stringify({ userId: oliveId, role: "editor" }) }),
          }),
        );
        expect(response.status, path).toBe(404);
      }
      const context = await auth.$context;
      expect(await context.internalAdapter.findUserById(oliveId)).toMatchObject({ role: "admin" });
    } finally {
      close();
    }
  });

  it("changes and removes others, never the admin asking", async () => {
    const { auth, asking, olive, oliveId, person, signIn, close } = await site();
    try {
      const eddieId = await person("eddie@example.org", "editor");
      await setRole(auth, asking(olive, "PATCH"), eddieId, "admin");
      expect(await authorizeWith(auth, asking(await signIn("eddie@example.org"), "GET"))).toMatchObject({
        role: "owner",
      });
      await expect(setRole(auth, asking(olive, "PATCH"), eddieId, "owner")).rejects.toMatchObject({ status: 400 });
      await expect(setRole(auth, asking(olive, "PATCH"), oliveId, "editor")).rejects.toMatchObject({ status: 409 });
      await expect(removeEditor(auth, asking(olive, "DELETE"), oliveId)).rejects.toMatchObject({ status: 409 });
      await expect(removeEditor(auth, asking(olive, "DELETE"), "nobody")).rejects.toMatchObject({ status: 404 });
      await removeEditor(auth, asking(olive, "DELETE"), eddieId);
      expect(await signIn("eddie@example.org")).toBeUndefined();
    } finally {
      close();
    }
  });
});

describe("forgetting a password", () => {
  it("emails a link at the site's address that works once, and answers the same for an address with no account", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const { auth, person, signIn, close } = await site(EMAIL_ENV);
    try {
      await person("eddie@example.org", "editor");
      const ask = (email: string) =>
        auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "https://elsewhere.example",
              "cf-connecting-ip": "192.0.2.1",
            },
            body: JSON.stringify({ email, redirectTo: "https://elsewhere.example/steal" }),
          }),
        );
      // Better Auth checks the origin of what's sent with cookies only, so this is a visitor's request as any other.
      const known = await ask("eddie@example.org");
      const unknown = await ask("nobody@example.org");
      expect(known.status).toBe(unknown.status);
      expect(await known.text()).toBe(await unknown.text());
      await vi.waitFor(() => expect(resend.sent).toHaveLength(1));
      const [sent] = resend.sent;
      if (!sent) throw new Error("Nothing was sent.");
      const link = linkIn(sent);
      // The link goes to the site, never where the request said.
      expect(link.origin + link.pathname).toBe(`${SITE}/reset-password/`);
      const token = link.searchParams.get("token") ?? "";
      await auth.api.resetPassword({ body: { token, newPassword: "a brand new password" } });
      expect(await signIn("eddie@example.org", "a brand new password")).toBeDefined();
      await expect(auth.api.resetPassword({ body: { token, newPassword: "yet another password" } })).rejects.toThrow();
    } finally {
      close();
    }
  });

  it("sends one account only so many links, whoever asks, with the same answer as ever", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const { auth, person, close } = await site(EMAIL_ENV);
    try {
      await person("eddie@example.org", "editor");
      const ask = (email: string, ip: string) =>
        auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": ip },
            body: JSON.stringify({ email }),
          }),
        );
      const answers = [];
      for (let index = 0; index < RESET_ACCOUNT_LIMIT.max + 2; index++) {
        // A different network address each time, which the address's own limit doesn't catch.
        const answer = await ask("eddie@example.org", `192.0.2.${index + 1}`);
        answers.push([answer.status, await answer.text()]);
      }
      const unknown = await ask("nobody@example.org", "192.0.2.100");
      expect(new Set(answers.map((answer) => JSON.stringify(answer)))).toEqual(
        new Set([JSON.stringify([unknown.status, await unknown.text()])]),
      );
      await vi.waitFor(() => expect(resend.sent).toHaveLength(RESET_ACCOUNT_LIMIT.max));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(resend.sent).toHaveLength(RESET_ACCOUNT_LIMIT.max);
    } finally {
      close();
    }
  });

  it("keeps counting an account's emails after a link is used, and when people ask at the same moment", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const { auth, person, close } = await site(EMAIL_ENV);
    try {
      await person("eddie@example.org", "editor");
      await person("ada@example.org", "editor");
      let ip = 0;
      const ask = (email: string) =>
        auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": `198.51.100.${++ip}` },
            body: JSON.stringify({ email }),
          }),
        );
      const sentTo = (to: string) => resend.sent.filter((sent) => sent.body.to.includes(to));
      for (let index = 0; index < RESET_ACCOUNT_LIMIT.max; index++) await ask("eddie@example.org");
      await vi.waitFor(() => expect(sentTo("eddie@example.org")).toHaveLength(RESET_ACCOUNT_LIMIT.max));
      const [first] = sentTo("eddie@example.org");
      if (!first) throw new Error("Nothing was sent.");
      // Using a link retires the account's links, but not the count of what it was sent.
      await auth.api.resetPassword({
        body: { token: linkIn(first).searchParams.get("token") ?? "", newPassword: "a brand new password" },
      });
      await ask("eddie@example.org");

      // Many at once, each from a different network address.
      const answers = await Promise.all(Array.from({ length: 8 }, () => ask("ada@example.org")));
      expect(new Set(answers.map((answer) => answer.status))).toEqual(new Set([200]));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(sentTo("eddie@example.org")).toHaveLength(RESET_ACCOUNT_LIMIT.max);
      expect(sentTo("ada@example.org").length).toBeGreaterThan(0);
      expect(sentTo("ada@example.org").length).toBeLessThanOrEqual(RESET_ACCOUNT_LIMIT.max);
    } finally {
      close();
    }
  });

  it("says, for every address alike, when the site can't send the email", async () => {
    const { auth, person, close } = await site();
    try {
      await person("eddie@example.org", "editor");
      const ask = async (email: string) => {
        const answer = await auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
            body: JSON.stringify({ email }),
          }),
        );
        return [answer.status, await answer.text()];
      };
      const known = await ask("eddie@example.org");
      expect(known[0]).toBe(503);
      expect(await ask("nobody@example.org")).toEqual(known);
    } finally {
      close();
    }
  });
});
