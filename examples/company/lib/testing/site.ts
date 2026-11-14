// The site's sign-in on a fresh database, and stand-ins for the services it calls, for tests. Never used by the
// site itself.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { vi } from "vitest";
import { authOptions } from "../auth.ts";
import type { SiteEnv } from "../env.ts";

export const SITE = "http://localhost:4321";
export const SITE_ENV: SiteEnv = {
  BETTER_AUTH_SECRET: "a-secret-for-tests-only-at-least-32-chars",
  GOODFELLOW_SITE_URL: SITE,
  CLIENT_IP_HEADER: "cf-connecting-ip",
  EMAIL_PROVIDER: "resend",
  EMAIL_API_KEY: "re_test_only",
  EMAIL_FROM: "Example Co <hello@example.org>",
  EMAIL_API_URL: "https://email.example",
};
export const PASSWORD = "correct horse battery staple";
export const DAY = 24 * 60 * 60 * 1000;

/** A stand-in for Resend's API, which keeps the messages it's sent. */
export function fakeResend() {
  const sent: { to: string; subject: string; text: string }[] = [];
  vi.stubGlobal("fetch", (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push({ to: [body.to].flat()[0], subject: body.subject, text: body.text });
    return Response.json({ id: String(sent.length) });
  }) as typeof fetch);
  return sent;
}

/** The `cookie` header a browser would send after an answer. */
export function cookiesOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((cookie) => !/;\s*Max-Age=0/i.test(cookie))
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** The site's sign-in on a fresh SQLite database, as D1 has it, with Olive the admin signed in, two-factor on. */
export async function testSite(siteEnv: SiteEnv = SITE_ENV) {
  const db = new DatabaseSync(":memory:");
  const dir = join(import.meta.dirname, "../../migrations/sqlite");
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
  /** A request from the site's own pages, to the subscribers API or `path`, or from `from` with another `Sec-Fetch-Site`. */
  const asking = (cookie: string | undefined, method = "POST", from = "same-origin", path = "/api/subscribers/") =>
    new Request(`${SITE}${path}`, {
      method,
      headers: { ...(cookie && { cookie }), "sec-fetch-site": from },
    });
  const oliveId = await person("olive@example.org", "admin");
  const olive = (await signIn("olive@example.org")).cookie;
  await context.internalAdapter.updateUser(oliveId, { twoFactorEnabled: true });
  return { auth, db, context, person, ask, signIn, asking, olive, oliveId, close: () => db.close() };
}

/** The link in a message's text. */
export function linkIn(text: string | undefined): URL {
  const found = text?.match(/https?:\/\/\S+/);
  if (!found) throw new Error("No link in the message.");
  return new URL(found[0]);
}
