import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_PATHS,
  authOptions,
  authorizeWith,
  authRoute,
  isAdminPluginPath,
  LINK_LOCK,
  lockLinks,
  RESET_ACCOUNT_LIMIT,
  TWO_FACTOR_LIMIT,
  unlockLinks,
} from "./auth.ts";
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
import { canSendEmail, EMAIL_PROVIDERS, EmailRefused, escapeHtml, invitationEmail, sendEmail } from "./email.ts";
import type { SiteEnv } from "./env.ts";

const SITE = "http://localhost:4321";
const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: SITE,
  CLIENT_IP_HEADER: "cf-connecting-ip",
};
const EMAIL_ENV: SiteEnv = {
  ...SITE_ENV,
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: "re_test_only",
  EMAIL_FROM: "Example Co <hello@example.org>",
  EMAIL_API_URL: "https://email.example",
};
const PASSWORD = "correct horse battery staple";

/** What a stand-in for Resend was sent. */
interface Sent {
  url: string;
  authorization: string | null;
  body: { from: string; to: string[]; subject: string; text: string; html: string };
}

/** A stand-in for Resend's API, which keeps what it's sent (with its recipients as a list) and answers `status`. */
function fakeResend(status = 200) {
  const sent: Sent[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: { ...body, to: [body.to].flat() },
    });
    return Response.json(status === 200 ? { id: String(sent.length) } : { message: "no" }, { status });
  }) as typeof fetch;
  return { sent, fetcher };
}

/** A stand-in for any service's API, which keeps each request as it came and answers as `answer` makes it. */
function fakeService(answer: () => Response = () => Response.json({ id: "1", message: "Queued.", success: true })) {
  const requests: Request[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(new Request(input, init));
    return answer();
  }) as typeof fetch;
  return { requests, fetcher };
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
  // As if she'd turned on two-factor sign-in after signing in, which admins need to manage editors.
  await context.internalAdapter.updateUser(oliveId, { twoFactorEnabled: true });
  return { auth, db, context, person, signIn, asking, olive, oliveId, close: () => db.close() };
}

/**
 * A barrier on the lock an account's links are sent and used under (`lockLinks()`): no request writes it until
 * `count` are about to, so they all compete for it. Gives what each saw: whether it took the lock.
 */
function holdAtLinkLock(adapter: { create: (data: never) => Promise<unknown> }, count: number) {
  const create = adapter.create.bind(adapter) as (data: { data: { id?: unknown } }) => Promise<unknown>;
  let arrived = 0;
  let release: () => void = () => undefined;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  (adapter as { create: unknown }).create = async (data: { data: { id?: unknown } }) => {
    if (String(data.data.id).startsWith("link-lock:") && arrived < count) {
      if (++arrived === count) release();
      await together;
    }
    return create(data);
  };
  return {
    arrived: () => arrived,
    restore: () => {
      (adapter as { create: unknown }).create = create;
    },
  };
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

  it("go through the service the settings name, with its key, and say only what kind of failure it was", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const email = { to: "eddie@example.org", subject: "Hello", text: "Hi", html: "<p>Hi</p>" };
    await sendEmail(EMAIL_ENV, email);
    expect(resend.sent[0]).toMatchObject({
      url: "https://email.example/emails",
      authorization: "Bearer re_test_only",
      body: { from: "Example Co <hello@example.org>", to: ["eddie@example.org"], subject: "Hello" },
    });
    vi.stubGlobal("fetch", fakeResend(403).fetcher);
    const refused = await sendEmail(EMAIL_ENV, email).then(
      () => undefined,
      (error: Error) => error.message,
    );
    expect(refused).toMatch(/^The email wasn't sent: the service answered with an error \([a-z-]+\)\.$/);
    expect(refused).not.toContain("eddie");
    // A 4xx every time it's tried means it surely wasn't sent; a 5xx on any try means it may have been.
    await expect(sendEmail(EMAIL_ENV, email)).rejects.toBeInstanceOf(EmailRefused);
    vi.stubGlobal("fetch", fakeResend(500).fetcher);
    const failed = await sendEmail(EMAIL_ENV, email).catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(Error);
    expect(failed).not.toBeInstanceOf(EmailRefused);
    // Asked too often surely didn't send it, so it's tried once more where the service says to wait a moment, and
    // what that try met decides; asked to wait longer, or not told how long, it isn't tried again.
    const answers: [number, string?][] = [[429, "0"], [503]];
    const busy = fakeService(() => {
      const [status, retryAfter] = answers.shift() ?? [200];
      return Response.json({ message: "no" }, { status, headers: retryAfter ? { "retry-after": retryAfter } : {} });
    });
    vi.stubGlobal("fetch", busy.fetcher);
    const mixed = await sendEmail(EMAIL_ENV, email).catch((error: unknown) => error);
    expect(busy.requests).toHaveLength(2);
    expect(mixed).toBeInstanceOf(Error);
    expect(mixed).not.toBeInstanceOf(EmailRefused);
    answers.push([429, "1"], [200]);
    await sendEmail(EMAIL_ENV, email);
    expect(busy.requests).toHaveLength(4);
    answers.push([429], [200]);
    await expect(sendEmail(EMAIL_ENV, email)).rejects.toBeInstanceOf(EmailRefused);
    expect(busy.requests).toHaveLength(5);
    answers.length = 0;
    answers.push([429, "60"], [200]);
    await expect(sendEmail(EMAIL_ENV, email)).rejects.toBeInstanceOf(EmailRefused);
    expect(busy.requests).toHaveLength(6);
    // A message that can't be made goes to nobody, so it counts as refused.
    answers.length = 0;
    await expect(sendEmail(EMAIL_ENV, { ...email, to: "not an address" })).rejects.toBeInstanceOf(EmailRefused);
    expect(busy.requests).toHaveLength(6);
    // Nor can one go from an address that can't be read, which the settings check says.
    const unreadableFrom = { ...EMAIL_ENV, EMAIL_FROM: "Example Co" };
    expect(canSendEmail(unreadableFrom)).toBe(false);
    await expect(sendEmail(unreadableFrom, email)).rejects.toThrow("Set EMAIL_FROM to send email.");
    expect(busy.requests).toHaveLength(6);
    await expect(sendEmail(SITE_ENV, email)).rejects.toThrow(
      "Set EMAIL_PROVIDER, EMAIL_FROM, and EMAIL_API_KEY to send email.",
    );
    await expect(sendEmail({ ...EMAIL_ENV, EMAIL_PROVIDER: "carrier-pigeon" }, email)).rejects.toThrow(
      "Set EMAIL_PROVIDER to send email.",
    );
    await expect(sendEmail({ ...EMAIL_ENV, EMAIL_PROVIDER: "ses" }, email)).rejects.toThrow(
      "Set EMAIL_KEY_ID and EMAIL_REGION to send email.",
    );
  });

  it("switch services with the settings alone, with no service's tracking in the links", async () => {
    const email = { to: "eddie@example.org", subject: "Hello", text: "https://example.org/x", html: "<p>Hi</p>" };
    const sendThrough = async (settings: Partial<SiteEnv>, answer?: () => Response) => {
      const service = fakeService(answer);
      vi.stubGlobal("fetch", service.fetcher);
      const { EMAIL_API_URL: _url, ...withoutUrl } = EMAIL_ENV;
      await sendEmail({ ...withoutUrl, ...settings }, email);
      const [request] = service.requests;
      if (!request) throw new Error("Nothing was sent.");
      return { request, body: await request.text() };
    };

    const mailgun = await sendThrough({ EMAIL_PROVIDER: "mailgun", EMAIL_API_KEY: "mg-key", EMAIL_REGION: "eu" });
    // Its domain is EMAIL_FROM's unless EMAIL_DOMAIN says otherwise.
    expect(mailgun.request.url).toBe("https://api.eu.mailgun.net/v3/example.org/messages");
    expect(mailgun.request.headers.get("authorization")).toBe(`Basic ${btoa("api:mg-key")}`);
    for (const option of ["o:tracking", "o:tracking-clicks", "o:tracking-opens"]) {
      expect(mailgun.body).toMatch(new RegExp(`name="${option}"\\s+(no|false)`));
    }
    const ownDomain = await sendThrough({ EMAIL_PROVIDER: "mailgun", EMAIL_DOMAIN: "mg.example.org" });
    expect(ownDomain.request.url).toBe("https://api.mailgun.net/v3/mg.example.org/messages");
    // An empty or blank EMAIL_DOMAIN, as Deploy sets where the variable is missing, falls back to EMAIL_FROM's.
    for (const blank of ["", "  "]) {
      const fallback = await sendThrough({ EMAIL_PROVIDER: "mailgun", EMAIL_DOMAIN: blank });
      expect(fallback.request.url).toBe("https://api.mailgun.net/v3/example.org/messages");
    }

    // SendGrid answers a message it accepts with 202 and nothing else.
    const sendgrid = await sendThrough(
      { EMAIL_PROVIDER: "SendGrid", EMAIL_API_KEY: "SG.key" },
      () => new Response(null, { status: 202 }),
    );
    expect(sendgrid.request.url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect(sendgrid.request.headers.get("authorization")).toBe("Bearer SG.key");
    const tracking = JSON.parse(sendgrid.body).tracking_settings;
    expect(tracking.click_tracking.enable).toBe(false);
    expect(tracking.open_tracking.enable).toBe(false);

    const plunk = await sendThrough({ EMAIL_PROVIDER: "plunk", EMAIL_API_KEY: "plunk-key" });
    expect(plunk.request.url).toMatch(/^https:\/\/[^/]*useplunk\.com\//);
    expect(plunk.request.headers.get("authorization")).toBe("Bearer plunk-key");

    const ses = await sendThrough({
      EMAIL_PROVIDER: "ses",
      EMAIL_API_KEY: "ses-secret",
      EMAIL_KEY_ID: "AKIDEXAMPLE",
      EMAIL_REGION: "eu-west-1",
    });
    expect(ses.request.url).toMatch(/^https:\/\/email\.eu-west-1\.amazonaws\.com\//);
    // Signed with the key pair, which never travels as it is.
    expect(ses.request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(`${[...ses.request.headers.values()].join(" ")} ${ses.body}`).not.toContain("ses-secret");
  });
});

describe("the editors API", () => {
  it("lets admins invite someone, who chooses a password with the link, once", async () => {
    const { auth, asking, olive, signIn, close } = await site(EMAIL_ENV);
    try {
      const resend = fakeResend();
      vi.stubGlobal("fetch", resend.fetcher);
      const invitation = { email: "eddie@example.org", name: "Eddie", role: "editor" as const };
      expect(await inviteEditor(auth, EMAIL_ENV, asking(olive), invitation)).toEqual({ sent: true });
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
      await expect(inviteEditor(auth, EMAIL_ENV, asking(olive), invitation)).rejects.toMatchObject({
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

  it("says why an invitation couldn't be sent, without the service's answer", async () => {
    const { auth, asking, olive, close } = await site(EMAIL_ENV);
    try {
      vi.stubGlobal("fetch", fakeResend(500).fetcher);
      const invitation = { email: "eddie@example.org", name: "Eddie", role: "editor" as const };
      await expect(inviteEditor(auth, EMAIL_ENV, asking(olive), invitation)).rejects.toThrow(
        "The invitation couldn't be sent. Check the site's email settings, then send it again.",
      );
    } finally {
      close();
    }
  });

  it("answers only admins with two-factor sign-in, from the site's own pages", async () => {
    const { auth, asking, olive, person, signIn, close } = await site();
    try {
      await person("eddie@example.org", "editor");
      const eddie = await signIn("eddie@example.org");
      await person("ann@example.org", "admin");
      await expect(listEditors(auth, asking(await signIn("ann@example.org"), "GET"))).rejects.toThrow(
        /Turn on two-factor sign-in/,
      );
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

  it("sends one link at a time, never one while another is being used, so exactly one works", async () => {
    const { auth, asking, olive, context, signIn, close } = await site();
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      const eddieId = (await context.internalAdapter.findUserByEmail("eddie@example.org"))?.user.id ?? "";
      const token = (link: string) => new URL(link).searchParams.get("token");
      const works = async (link: string) =>
        Boolean(await context.internalAdapter.findVerificationValue(`reset-password:${token(link)}`));

      // Three sent again at the same moment: one goes ahead, the others are asked to try again.
      const barrier = holdAtLinkLock(context.adapter, 3);
      const again = await Promise.allSettled([1, 2, 3].map(() => inviteAgain(auth, SITE_ENV, asking(olive), eddieId)));
      barrier.restore();
      expect(barrier.arrived()).toBe(3);
      const sent = again.flatMap((result) =>
        result.status === "fulfilled" && !result.value.sent ? [result.value.link] : [],
      );
      expect(sent).toHaveLength(1);
      for (const result of again.filter((result) => result.status === "rejected")) {
        expect((result as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
      }
      const [link] = sent;
      if (!link) throw new Error("Nothing was sent.");
      expect(await works(invited.link)).toBe(false);
      expect(await works(link)).toBe(true);

      // Sent again while the person sets a password with the link they have: it waits for them.
      const hash = context.password.hash;
      let reached: () => void = () => undefined;
      const atUse = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      context.password.hash = async (password: string) => {
        reached();
        await held;
        return hash(password);
      };
      const accepting = acceptInvitation(auth, asking(undefined), { token: token(link), password: PASSWORD });
      await atUse;
      await expect(inviteAgain(auth, SITE_ENV, asking(olive), eddieId)).rejects.toMatchObject({ status: 409 });
      release();
      await accepting;
      context.password.hash = hash;
      expect(await signIn("eddie@example.org")).toBeDefined();
      expect(await works(link)).toBe(false);
      // Joined, so no link can be sent any more.
      await expect(inviteAgain(auth, SITE_ENV, asking(olive), eddieId)).rejects.toMatchObject({ status: 409 });
    } finally {
      close();
    }
  });

  it("never lets a link used past its lock's time take a link sent since, or another request's lock", async () => {
    const { auth, asking, olive, context, signIn, close } = await site();
    type Adapter = typeof context.adapter;
    const { transaction, consumeOne } = context.adapter;
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      const eddieId = (await context.internalAdapter.findUserByEmail("eddie@example.org"))?.user.id ?? "";
      const token = (link: string) => new URL(link).searchParams.get("token");
      const lockId = `${LINK_LOCK}${eddieId}`;
      const lock = () =>
        context.adapter.findOne<{ value: string }>({
          model: "verification",
          where: [{ field: "id", value: lockId }],
        });
      // As D1 has it, with nothing holding Better Auth's find and its consume together.
      context.adapter.transaction = (async (run: (adapter: Adapter) => Promise<unknown>) =>
        run(context.adapter)) as Adapter["transaction"];
      // The invitation is used, and stops just before Better Auth consumes its row, past its lock's time.
      let reached: () => void = () => undefined;
      const atConsume = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      context.adapter.consumeOne = (async (data: Parameters<Adapter["consumeOne"]>[0]) => {
        context.adapter.consumeOne = consumeOne;
        await context.adapter.update({
          model: "verification",
          where: [{ field: "id", value: lockId }],
          update: { expiresAt: new Date(Date.now() - 1000) },
        });
        reached();
        await held;
        return consumeOne(data);
      }) as Adapter["consumeOne"];
      const accepting = acceptInvitation(auth, asking(undefined), {
        token: token(invited.link),
        password: "the password from the old link",
      });
      await atConsume;
      // Meanwhile a new link is sent, and someone else takes the account's lock.
      const again = await inviteAgain(auth, SITE_ENV, asking(olive), eddieId);
      if (again.sent) throw new Error("It said it sent an email.");
      const holder = await lockLinks(context.adapter, eddieId);
      expect(holder).toBeTruthy();
      release();
      await expect(accepting).rejects.toMatchObject({ status: 400 });
      // The old link set nothing, the new one still works, and the lock is still the other request's.
      expect(await signIn("eddie@example.org", "the password from the old link")).toBeUndefined();
      expect(await lock()).toMatchObject({ value: holder });
      await unlockLinks(context.adapter, eddieId, holder ?? "");
      await acceptInvitation(auth, asking(undefined), { token: token(again.link), password: PASSWORD });
      expect(await signIn("eddie@example.org")).toBeDefined();
    } finally {
      context.adapter.transaction = transaction;
      context.adapter.consumeOne = consumeOne;
      close();
    }
  });

  it("never lets a link used again, once it's been used, let go of the lock its first use holds", async () => {
    const { auth, asking, olive, context, signIn, close } = await site();
    type Adapter = typeof context.adapter;
    const { transaction, consumeOne } = context.adapter;
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      const eddieId = (await context.internalAdapter.findUserByEmail("eddie@example.org"))?.user.id ?? "";
      const token = new URL(invited.link).searchParams.get("token") ?? "";
      context.adapter.transaction = (async (run: (adapter: Adapter) => Promise<unknown>) =>
        run(context.adapter)) as Adapter["transaction"];
      // The invitation is used, and stops once Better Auth has consumed its row, before the person is marked joined.
      let reached: () => void = () => undefined;
      const consumed = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      context.adapter.consumeOne = (async (data: Parameters<Adapter["consumeOne"]>[0]) => {
        context.adapter.consumeOne = consumeOne;
        const row = await consumeOne(data);
        reached();
        await held;
        return row;
      }) as Adapter["consumeOne"];
      const accepting = acceptInvitation(auth, asking(undefined), { token, password: PASSWORD });
      await consumed;
      // The same link again, in the body and in the query: refused, and the first use keeps the lock.
      await expect(
        auth.api.resetPassword({ body: { token, newPassword: "the password from the replay" } }),
      ).rejects.toThrow();
      await expect(
        auth.api.resetPassword({ body: { newPassword: "the password from the replay" }, query: { token } }),
      ).rejects.toThrow();
      expect(
        await context.adapter.findOne({
          model: "verification",
          where: [{ field: "id", value: `${LINK_LOCK}${eddieId}` }],
        }),
      ).toBeTruthy();
      await expect(inviteAgain(auth, SITE_ENV, asking(olive), eddieId)).rejects.toMatchObject({ status: 409 });
      release();
      await accepting;
      expect(await signIn("eddie@example.org")).toBeDefined();
      expect(await signIn("eddie@example.org", "the password from the replay")).toBeUndefined();
      // Joined, so no new link can be sent, and the first use let its lock go.
      await expect(inviteAgain(auth, SITE_ENV, asking(olive), eddieId)).rejects.toMatchObject({ status: 409 });
      expect(await lockLinks(context.adapter, eddieId)).toBeTruthy();
    } finally {
      context.adapter.transaction = transaction;
      context.adapter.consumeOne = consumeOne;
      close();
    }
  });

  it("keeps a link sent while another is looked up, rather than retiring it for the one it replaced", async () => {
    const { auth, asking, olive, context, signIn, close } = await site();
    const create = context.adapter.create;
    try {
      const invited = await inviteEditor(auth, SITE_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      if (invited.sent) throw new Error("It said it sent an email.");
      const eddieId = (await context.internalAdapter.findUserByEmail("eddie@example.org"))?.user.id ?? "";
      const token = (link: string) => new URL(link).searchParams.get("token");
      // The old link is looked up, and stops just before it takes the account's lock.
      let reached: () => void = () => undefined;
      const atLock = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let paused = false;
      context.adapter.create = (async (data: { data: { id?: unknown } }) => {
        if (!paused && String(data.data.id).startsWith(LINK_LOCK)) {
          paused = true;
          reached();
          await held;
        }
        return create(data as never);
      }) as typeof create;
      const accepting = acceptInvitation(auth, asking(undefined), {
        token: token(invited.link),
        password: "the password from the old link",
      });
      await atLock;
      // Meanwhile a new link replaces it.
      const again = await inviteAgain(auth, SITE_ENV, asking(olive), eddieId);
      if (again.sent) throw new Error("It said it sent an email.");
      release();
      await expect(accepting).rejects.toMatchObject({ status: 400 });
      context.adapter.create = create;
      // The new link still works, and the lock was let go.
      await acceptInvitation(auth, asking(undefined), { token: token(again.link), password: PASSWORD });
      expect(await signIn("eddie@example.org")).toBeDefined();
      expect(await signIn("eddie@example.org", "the password from the old link")).toBeUndefined();
    } finally {
      context.adapter.create = create;
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

  it("closes, in the site's own router, every route the admin plugin lists, however it's spelled", () => {
    expect(ADMIN_PATHS.length).toBeGreaterThan(5);
    for (const path of ADMIN_PATHS) {
      for (const spelled of [
        `/api/auth${path}`,
        `/api/auth${path}/`,
        `/API/Auth/${path.toUpperCase()}`,
        `/api/auth/${path}`,
      ]) {
        expect(isAdminPluginPath(spelled), spelled).toBe(true);
      }
    }
    for (const path of ["/api/auth/get-session/", "/api/auth/two-factor/enable", "/api/auth/administrator"]) {
      expect(isAdminPluginPath(path), path).toBe(false);
    }
  });

  it("changes and removes others, never the admin asking", async () => {
    const { auth, asking, olive, oliveId, person, signIn, close } = await site();
    try {
      const eddieId = await person("eddie@example.org", "editor");
      await setRole(auth, asking(olive, "PATCH"), eddieId, "admin");
      // An admin now, who edits pages until he turns on two-factor sign-in.
      const eddie = await signIn("eddie@example.org");
      expect(await authorizeWith(auth, asking(eddie, "GET"))).toMatchObject({ role: "editor" });
      const listed = await listEditors(auth, asking(olive, "GET"));
      expect(listed.find((editor) => editor.id === eddieId)).toMatchObject({ role: "admin", twoFactor: false });
      // And Olive, who has it on, as on, so the list doesn't say off for everyone.
      expect(listed.find((editor) => editor.id === oliveId)).toMatchObject({ role: "admin", twoFactor: true });
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

  it("gives back an email's slot where the service refused it, and keeps it where it may have gone", async () => {
    // Refused (a 4xx) surely wasn't sent; the service's own error (a 5xx) or a timeout may have been.
    for (const failure of ["refused", "server error", "timed out"] as const) {
      let calls = 0;
      vi.stubGlobal("fetch", (async () => {
        calls++;
        if (calls > RESET_ACCOUNT_LIMIT.max) return new Response("{}", { status: 200 });
        if (failure === "refused") return new Response("{}", { status: 422 });
        if (failure === "server error") return new Response("{}", { status: 503 });
        throw new DOMException("The operation timed out.", "TimeoutError");
      }) as typeof fetch);
      const { auth, context, person, close } = await site(EMAIL_ENV);
      try {
        await person("eddie@example.org", "editor");
        const slots = async () =>
          (
            await context.adapter.findMany({
              model: "verification",
              where: [{ field: "identifier", operator: "starts_with", value: "reset-sent:" }],
            })
          ).length;
        const ask = (ip: string) =>
          auth.handler(
            new Request(`${SITE}/api/auth/request-password-reset/`, {
              method: "POST",
              headers: { "content-type": "application/json", "cf-connecting-ip": ip },
              body: JSON.stringify({ email: "eddie@example.org" }),
            }),
          );
        for (let index = 0; index < RESET_ACCOUNT_LIMIT.max; index++) {
          await ask(`192.0.2.${index + 1}`);
          await vi.waitFor(() => expect(calls).toBe(index + 1));
          await vi.waitFor(async () => expect(await slots()).toBe(failure === "refused" ? 0 : index + 1));
        }
        // Once the service works again: a refused email's slot is free, one that may have gone still counts.
        await ask("192.0.2.50");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(calls).toBe(failure === "refused" ? RESET_ACCOUNT_LIMIT.max + 1 : RESET_ACCOUNT_LIMIT.max);
      } finally {
        close();
        vi.unstubAllGlobals();
      }
    }
  });

  it("gives back the slot of the email that was refused, never another's", async () => {
    // The first email is held until the second has been sent, then refused.
    let releaseFirst: () => void = () => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    let firstDone: () => void = () => undefined;
    const firstFinished = new Promise<void>((resolve) => {
      firstDone = resolve;
    });
    vi.stubGlobal("fetch", (async () => {
      calls++;
      if (calls > 1) return new Response("{}", { status: 200 });
      await firstHeld;
      setTimeout(firstDone, 20);
      return new Response("{}", { status: 422 });
    }) as typeof fetch);
    const { auth, context, person, close } = await site(EMAIL_ENV);
    try {
      const eddieId = await person("eddie@example.org", "editor");
      const ask = (ip: string) =>
        auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": ip },
            body: JSON.stringify({ email: "eddie@example.org" }),
          }),
        );
      await ask("192.0.2.1");
      await ask("192.0.2.2");
      await vi.waitFor(() => expect(calls).toBe(2));
      releaseFirst();
      await firstFinished;
      await vi.waitFor(async () => {
        const slots = await context.adapter.findMany<{ id: string }>({
          model: "verification",
          where: [{ field: "identifier", value: `reset-sent:${eddieId}` }],
        });
        // The second email's slot, the one it went out under, still counts.
        expect(slots.map((slot) => slot.id)).toEqual([`reset-sent:2:${eddieId}`]);
      });
    } finally {
      close();
      vi.unstubAllGlobals();
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
      // As many as the account had free, whatever order the requests ran in.
      expect(sentTo("ada@example.org")).toHaveLength(RESET_ACCOUNT_LIMIT.max);
    } finally {
      close();
    }
  });

  it("sends someone who hasn't joined no reset link, so their invitation is the only link they have", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const { auth, asking, olive, close } = await site(EMAIL_ENV);
    try {
      const invited = await inviteEditor(auth, EMAIL_ENV, asking(olive), {
        email: "eddie@example.org",
        name: "Eddie",
        role: "admin",
      });
      expect(invited).toEqual({ sent: true });
      const ask = (email: string) =>
        auth.handler(
          new Request(`${SITE}/api/auth/request-password-reset/`, {
            method: "POST",
            headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" },
            body: JSON.stringify({ email }),
          }),
        );
      const answer = await ask("eddie@example.org");
      const unknown = await ask("nobody@example.org");
      expect([answer.status, await answer.text()]).toEqual([unknown.status, await unknown.text()]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(resend.sent.filter((sent) => sent.body.text.includes("/reset-password/"))).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("lets exactly as many go ahead as there are free slots, when every request reaches the same slot together", async () => {
    const resend = fakeResend();
    vi.stubGlobal("fetch", resend.fetcher);
    const { auth, context, person, close } = await site(EMAIL_ENV);
    try {
      const adaId = await person("ada@example.org", "editor");
      const requests = 8;
      // A barrier: no request writes the first slot until every one is about to, so they all compete for it, then
      // for each slot after it.
      const original = context.adapter.create.bind(context.adapter);
      let arrived = 0;
      let release: () => void = () => undefined;
      const together = new Promise<void>((resolve) => {
        release = resolve;
      });
      context.adapter.create = (async (data: Parameters<typeof original>[0]) => {
        if (String((data.data as { id?: unknown }).id).startsWith("reset-sent:1:")) {
          if (++arrived === requests) release();
          await together;
        }
        return original(data);
      }) as typeof context.adapter.create;
      const answers = await Promise.all(
        Array.from({ length: requests }, (_, index) =>
          auth.handler(
            new Request(`${SITE}/api/auth/request-password-reset/`, {
              method: "POST",
              headers: { "content-type": "application/json", "cf-connecting-ip": `192.0.2.${index + 10}` },
              body: JSON.stringify({ email: "ada@example.org" }),
            }),
          ),
        ),
      );
      expect(arrived).toBe(requests);
      expect(new Set(answers.map((answer) => answer.status))).toEqual(new Set([200]));
      const slots = await context.adapter.count({
        model: "verification",
        where: [{ field: "identifier", value: `reset-sent:${adaId}` }],
      });
      expect(slots).toBe(RESET_ACCOUNT_LIMIT.max);
      await vi.waitFor(() => expect(resend.sent).toHaveLength(RESET_ACCOUNT_LIMIT.max));
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The rest were limited: no more emails, and no more reset links.
      expect(resend.sent).toHaveLength(RESET_ACCOUNT_LIMIT.max);
      const links = await context.adapter.count({
        model: "verification",
        where: [
          { field: "value", value: adaId },
          { field: "identifier", operator: "starts_with", value: "reset-password:" },
        ],
      });
      expect(links).toBe(RESET_ACCOUNT_LIMIT.max);
    } finally {
      close();
    }
  });

  it("lets one of an account's links set its password at a time, however its token is sent", async () => {
    const { auth, context, person, signIn, close } = await site();
    try {
      const adaId = await person("ada@example.org", "editor");
      const link = async (expiresIn = 60 * 60 * 1000) => {
        const token = `a-link-${Math.random().toString(36).slice(2)}`;
        await context.internalAdapter.createVerificationValue({
          value: adaId,
          identifier: `reset-password:${token}`,
          expiresAt: new Date(Date.now() + expiresIn),
        });
        return token;
      };
      // In the request's body, as the site's form sends it, or in its address, which Better Auth also reads.
      const use = async (token: string, newPassword: string, where: "body" | "query") => {
        const answer = await auth.handler(
          new Request(`${SITE}/api/auth/reset-password/${where === "query" ? `?token=${token}` : ""}`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: SITE },
            body: JSON.stringify(where === "body" ? { token, newPassword } : { newPassword }),
          }),
        );
        return answer.status;
      };

      const barrier = holdAtLinkLock(context.adapter, 2);
      const statuses = await Promise.all([
        use(await link(), "the owner's new password", "body"),
        use(await link(), "a stranger's password", "query"),
      ]);
      barrier.restore();
      expect(barrier.arrived()).toBe(2);
      // One went ahead and the other was asked to try again, by which time its link had gone.
      expect([...statuses].sort()).toEqual([200, 409]);
      const winner = statuses[0] === 200 ? "the owner's new password" : "a stranger's password";
      const loser = statuses[0] === 200 ? "a stranger's password" : "the owner's new password";
      expect(await signIn("ada@example.org", winner)).toBeDefined();
      expect(await signIn("ada@example.org", loser)).toBeUndefined();

      // One after the other: the first sets the password, and the second no longer works.
      const [first, second] = [await link(), await link()];
      expect(await use(first, "a third password, much longer", "query")).toBe(200);
      expect(await use(second, "a fourth password, much longer", "body")).not.toBe(200);
      expect(await signIn("ada@example.org", "a third password, much longer")).toBeDefined();

      // A link that has run out takes nothing with it.
      const expired = await link(-1000);
      const working = await link();
      expect(await use(expired, "an expired link's password", "body")).not.toBe(200);
      expect(await use(working, "a fifth password, much longer", "body")).toBe(200);
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

/** The secret in an `otpauth://` address, from its base32 key. */
function secretOf(uri: string): Buffer {
  const key = new URL(uri).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of key.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
}

/** The code an authenticator app shows now for an `otpauth://` address (RFC 6238: SHA-1, 6 digits, 30 seconds). */
function totp(uri: string): string {
  const secret = secretOf(uri);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", secret).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("two-factor sign-in", () => {
  it("makes an admin an owner once it's on, and asks every sign-in after for a code", async () => {
    const { auth, context, person, signIn, asking, close } = await site();
    try {
      const annId = await person("ann@example.org", "admin");
      const ann = await signIn("ann@example.org");
      // Signed in somewhere else with the password alone, perhaps by someone who learned it.
      const elsewhere = await signIn("ann@example.org");
      const headers = asking(ann, "GET").headers;
      expect(await authorizeWith(auth, asking(ann, "GET"))).toMatchObject({ role: "editor" });
      await expect(auth.api.enableTwoFactor({ headers, body: { password: "not her password" } })).rejects.toThrow();
      const enabled = await auth.api.enableTwoFactor({ headers, body: { password: PASSWORD, method: "totp" } });
      if (enabled.method !== "totp") throw new Error("It didn't set up an authenticator app.");
      const { totpURI, backupCodes } = enabled;
      // Her app names the account by the site's address.
      expect(new URL(totpURI).searchParams.get("issuer")).toBe("localhost:4321");
      // Not on until she shows her app has it.
      expect(await authorizeWith(auth, asking(ann, "GET"))).toMatchObject({ role: "editor" });
      const turnedOn = await auth.api.verifyTOTP({ headers, body: { code: totp(totpURI) }, asResponse: true });
      // Turning it on starts a new session, and ends the one from before, and every other: a session that signed in
      // with the password alone never becomes an owner's.
      expect(await authorizeWith(auth, asking(ann, "GET"))).toBeNull();
      expect(await authorizeWith(auth, asking(elsewhere, "GET"))).toBeNull();
      expect(await authorizeWith(auth, asking(cookiesOf(turnedOn), "GET"))).toMatchObject({ role: "owner" });
      // Nor can either set up an app again over the one that works (Better Auth refuses both): the ended session, or
      // the new one, as from another tab that still shows it off, until she turns it off.
      for (const cookie of [elsewhere, cookiesOf(turnedOn)]) {
        await expect(
          auth.api.enableTwoFactor({
            headers: asking(cookie, "GET").headers,
            body: { password: PASSWORD, method: "totp" },
          }),
        ).rejects.toThrow();
      }
      const stored = await context.adapter.findOne<{ secret: string; backupCodes: string }>({
        model: "twoFactor",
        where: [{ field: "userId", value: annId }],
      });
      // Kept encrypted, so a copy of the database doesn't give the codes away.
      expect(secretOf(totpURI).toString()).toHaveLength(32);
      expect(stored?.secret).not.toContain(secretOf(totpURI).toString());
      for (const code of backupCodes) expect(stored?.backupCodes).not.toContain(code);

      // A password alone no longer signs her in: it answers with the code step, and no session.
      const step = await auth.api.signInEmail({
        body: { email: "ann@example.org", password: PASSWORD },
        asResponse: true,
      });
      expect(await step.clone().json()).toMatchObject({ twoFactorRedirect: true });
      const pending = cookiesOf(step);
      expect(await auth.api.getSession({ headers: new Headers({ cookie: pending }) })).toBeNull();
      await expect(
        auth.api.verifyTOTP({ headers: new Headers({ cookie: pending }), body: { code: "000000" } }),
      ).rejects.toThrow();
      const verified = await auth.api.verifyTOTP({
        headers: new Headers({ cookie: pending }),
        body: { code: totp(totpURI) },
        asResponse: true,
      });
      const signedIn = new Request(SITE, { headers: { cookie: cookiesOf(verified) } });
      expect(await authorizeWith(auth, signedIn)).toMatchObject({ role: "owner" });

      // A backup code works once.
      const again = cookiesOf(
        await auth.api.signInEmail({ body: { email: "ann@example.org", password: PASSWORD }, asResponse: true }),
      );
      const backup = (cookie: string) =>
        auth.api.verifyBackupCode({ headers: new Headers({ cookie }), body: { code: backupCodes[0] ?? "" } });
      await backup(again);
      const third = cookiesOf(
        await auth.api.signInEmail({ body: { email: "ann@example.org", password: PASSWORD }, asResponse: true }),
      );
      await expect(backup(third)).rejects.toThrow();
    } finally {
      close();
    }
  });

  it("comes back after BETTER_AUTH_SECRET changes with the README's statements, and each admin turning it on again", async () => {
    const { auth, db, person, signIn, close } = await site();
    try {
      await person("ann@example.org", "admin");
      const ann = new Headers({ cookie: (await signIn("ann@example.org")) ?? "" });
      const enabled = await auth.api.enableTwoFactor({ headers: ann, body: { password: PASSWORD, method: "totp" } });
      if (enabled.method !== "totp") throw new Error("It didn't set up an authenticator app.");
      await auth.api.verifyTOTP({ headers: ann, body: { code: totp(enabled.totpURI) } });

      const rotated = betterAuth(
        authOptions(db, { ...SITE_ENV, BETTER_AUTH_SECRET: "another-secret-for-tests-at-least-32" }),
      );
      const signInEmail = () =>
        rotated.api.signInEmail({ body: { email: "ann@example.org", password: PASSWORD }, asResponse: true });
      // Her codes can't be read with the new secret, so she can't get past the code step.
      const step = await signInEmail();
      expect(await step.clone().json()).toMatchObject({ twoFactorRedirect: true });
      await expect(
        rotated.api.verifyTOTP({
          headers: new Headers({ cookie: cookiesOf(step) }),
          body: { code: totp(enabled.totpURI) },
        }),
      ).rejects.toThrow();

      // The statements the README gives turn it off for every account, so her password signs her in, as an editor
      // until she turns it on again.
      const readme = await readFile(join(import.meta.dirname, "../README.md"), "utf8");
      const command = readme.match(/wrangler d1 execute [^\n]*--command "([^"]+)"/)?.[1];
      if (!command?.includes("twoFactor")) throw new Error("The README has no statements for this.");
      db.exec(command);
      const back = await signInEmail();
      expect(await back.clone().json()).not.toMatchObject({ twoFactorRedirect: true });
      const signedIn = new Request(SITE, { headers: { cookie: cookiesOf(back) } });
      expect(await authorizeWith(rotated, signedIn)).toMatchObject({ role: "editor" });
      const again = await rotated.api.enableTwoFactor({
        headers: signedIn.headers,
        body: { password: PASSWORD, method: "totp" },
      });
      expect(again.method).toBe("totp");
    } finally {
      close();
    }
  });

  it("lets a person get a code wrong and try again, and limits how often one address can try", async () => {
    const { auth, close } = await site();
    try {
      const attempt = async (address: string) =>
        (
          await auth.handler(
            new Request(`${SITE}/api/auth/two-factor/verify-totp/`, {
              method: "POST",
              headers: { "content-type": "application/json", origin: SITE, "cf-connecting-ip": address },
              body: JSON.stringify({ code: "000000" }),
            }),
          )
        ).status;
      // Without the cookie the password step sets, every try fails, but each still counts.
      for (let tried = 0; tried < TWO_FACTOR_LIMIT.max; tried++) expect(await attempt("192.0.2.1")).toBe(401);
      expect(await attempt("192.0.2.1")).toBe(429);
      expect(await attempt("192.0.2.2")).toBe(401);
    } finally {
      close();
    }
  });

  it("keeps the admin plugin's own routes from the browser, however they're spelled", async () => {
    const { auth, olive, close } = await site();
    try {
      for (const path of [
        "/api/auth/admin/list-users",
        "/api/auth/admin/set-role/",
        "/api/auth//admin/remove-user",
        "/api/auth/%61dmin/create-user",
        "/api/auth/Admin/impersonate-user",
      ]) {
        const answer = await authRoute(
          auth,
          new Request(`${SITE}${path}`, {
            method: "POST",
            headers: { cookie: olive ?? "", origin: SITE, "content-type": "application/json" },
            body: "{}",
          }),
        );
        expect(answer.status, path).toBe(404);
      }
      expect((await authRoute(auth, new Request(`${SITE}/api/auth/get-session/`))).status).toBe(200);
    } finally {
      close();
    }
  });
});

describe("link tracking", () => {
  // Each link in an email lets someone into an account, so tracking, which sends links through the service first,
  // stays off: in each message where the service allows it, and otherwise by the README's steps for that service.
  const NAMES: Record<(typeof EMAIL_PROVIDERS)[number], string> = {
    resend: "Resend",
    mailgun: "Mailgun",
    sendgrid: "SendGrid",
    ses: "SES",
    plunk: "Plunk",
  };

  it("is turned off in the code, or the README says where to turn it off, for every service", async () => {
    const code = await readFile(join(import.meta.dirname, "email.ts"), "utf8");
    const readme = await readFile(join(import.meta.dirname, "../README.md"), "utf8");
    const guidance = readme.split("\n").find((line) => line.includes("Link tracking must stay off")) ?? "";
    expect(guidance).not.toBe("");
    for (const provider of EMAIL_PROVIDERS) {
      const start = code.indexOf(`case "${provider}": {`);
      expect(start, provider).toBeGreaterThan(-1);
      const next = code.indexOf("case ", start + 1);
      const block = code.slice(start, next === -1 ? undefined : next);
      const inCode = /[cC]lickTracking: false/.test(block);
      expect(
        inCode || guidance.includes(`in ${NAMES[provider]},`),
        `${provider}: tracking off in code or in the README`,
      ).toBe(true);
    }
  });
});
