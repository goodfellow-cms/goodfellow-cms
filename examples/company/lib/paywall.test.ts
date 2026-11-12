import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authOptions } from "./auth.ts";
import { can, grant, subscribedUntil } from "./entitlements.ts";
import type { SiteEnv } from "./env.ts";
import {
  isBuildingPages,
  isMembersVersion,
  isPageRequest,
  MEMBERS_VERSION_PATH,
  membersVersionUrl,
  openReader,
  PAYWALL_COOKIE,
  PAYWALL_SECONDS,
  readerFor,
  routedPath,
  sealReader,
} from "./paywall.ts";

const SITE = "http://localhost:4321";
const SECRET = "a-secret-for-tests-only-at-least-32-chars";
const SITE_ENV: SiteEnv = { BETTER_AUTH_SECRET: SECRET, GOODFELLOW_SITE_URL: SITE };
const PASSWORD = "correct horse battery staple";
const HOUR = 60 * 60 * 1000;

/** The `cookie` header a browser would send after an answer's `set-cookie` headers, over `before`. */
function cookiesAfter(before: string, setCookies: string[]): string {
  const jar = new Map(
    before
      .split(";")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => [pair.slice(0, pair.indexOf("=")), pair] as const),
  );
  for (const cookie of setCookies) {
    const pair = cookie.split(";")[0] ?? "";
    const name = pair.slice(0, pair.indexOf("="));
    if (/;\s*Max-Age=0/i.test(cookie)) jar.delete(name);
    else jar.set(name, pair);
  }
  return [...jar.values()].join("; ");
}

const opened: DatabaseSync[] = [];
afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  vi.restoreAllMocks();
});

/** The site's sign-in on a fresh SQLite database, with Sam, who subscribes, and Nell, who doesn't. */
async function site() {
  const db = new DatabaseSync(":memory:");
  opened.push(db);
  const dir = join(import.meta.dirname, "../migrations/sqlite");
  for (const name of (await readdir(dir)).sort()) db.exec(await readFile(join(dir, name), "utf8"));
  const siteAuth = betterAuth(authOptions(db, SITE_ENV));
  const context = await siteAuth.$context;
  const person = async (email: string) => {
    const user = await context.internalAdapter.createUser(
      { email, name: email.split("@")[0] ?? email, emailVerified: true, role: "editor" },
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
  const signIn = async (email: string) => {
    const response = await siteAuth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
    return cookiesAfter("", response.headers.getSetCookie());
  };
  const settings = vi.fn(async () => ({ siteAuth, secret: SECRET }));
  const getSession = vi.spyOn(siteAuth.api, "getSession");
  const ask = (cookie: string, now = Date.now(), url = `${SITE}/handbook/`) =>
    readerFor(new Request(url, { headers: cookie ? { cookie } : {} }), settings, now);
  const samId = await person("sam@example.org");
  await grant(context.adapter, { userId: samId, kind: "subscription", reference: "price_monthly" });
  const nellId = await person("nell@example.org");
  return { siteAuth, context, person, signIn, settings, getSession, ask, samId, nellId };
}

describe("readerFor", () => {
  it("answers visitors who aren't signed in for everyone, without the database or the secret", async () => {
    const { ask, settings } = await site();
    expect(await ask("")).toEqual({ reader: "everyone", cookies: [] });
    expect(settings).not.toHaveBeenCalled();
  });

  it("clears the cookie of someone who has signed out", async () => {
    const { ask, signIn } = await site();
    const signedIn = await signIn("sam@example.org");
    const { cookies } = await ask(signedIn);
    const kept = cookiesAfter("", cookies);
    const answer = await ask(kept);
    expect(answer.reader).toBe("everyone");
    expect(answer.cookies).toEqual([`${PAYWALL_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`]);
  });

  it("answers subscribers for members, then from the cookie alone until it runs out", async () => {
    const { ask, signIn, getSession } = await site();
    const now = Date.now();
    let cookie = await signIn("sam@example.org");
    const first = await ask(cookie, now);
    expect(first.reader).toBe("members");
    expect(first.cookies.at(-1)).toMatch(
      new RegExp(`^${PAYWALL_COOKIE}=m\\.[^;]+; Path=/; Max-Age=${PAYWALL_SECONDS}; HttpOnly; SameSite=Lax$`),
    );
    cookie = cookiesAfter(cookie, first.cookies);
    getSession.mockClear();
    expect(await ask(cookie, now + 60_000)).toEqual({ reader: "members", cookies: [] });
    expect(getSession).not.toHaveBeenCalled();
    // Once it has run out, the database is asked again.
    expect((await ask(cookie, now + PAYWALL_SECONDS * 1000 + 1)).reader).toBe("members");
    expect(getSession).toHaveBeenCalledOnce();
  });

  it("answers people who don't subscribe for everyone, and keeps that answer too", async () => {
    const { ask, signIn, getSession } = await site();
    let cookie = await signIn("nell@example.org");
    const first = await ask(cookie);
    expect(first.reader).toBe("everyone");
    cookie = cookiesAfter(cookie, first.cookies);
    getSession.mockClear();
    expect(await ask(cookie)).toEqual({ reader: "everyone", cookies: [] });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("keeps the answer no longer than the subscription lasts, and not past its end", async () => {
    const { ask, context, signIn, nellId } = await site();
    const now = Date.now();
    await grant(context.adapter, {
      userId: nellId,
      kind: "subscription",
      reference: "price_monthly",
      expiresAt: new Date(now + 90_000),
    });
    let cookie = await signIn("nell@example.org");
    const first = await ask(cookie, now);
    expect(first.reader).toBe("members");
    expect(first.cookies.at(-1)).toContain("; Max-Age=90;");
    cookie = cookiesAfter(cookie, first.cookies);
    expect((await ask(cookie, now + 91_000)).reader).toBe("everyone");
  });

  it("doesn't count a subscription that has ended, or a purchase", async () => {
    const { ask, context, signIn, nellId } = await site();
    await grant(context.adapter, {
      userId: nellId,
      kind: "subscription",
      reference: "price_monthly",
      expiresAt: new Date(Date.now() - HOUR),
    });
    await grant(context.adapter, { userId: nellId, kind: "purchase", reference: "report-2026" });
    expect((await ask(await signIn("nell@example.org"))).reader).toBe("everyone");
  });

  it("never takes a subscriber's cookie for anyone signed in on another session", async () => {
    const { ask, signIn } = await site();
    const sam = await signIn("sam@example.org");
    const samsPaywall = cookiesAfter(
      "",
      (await ask(sam)).cookies.filter((c) => c.startsWith(`${PAYWALL_COOKIE}=`)),
    );
    const nell = await signIn("nell@example.org");
    // Nell's session, with Sam's paywall cookie copied beside it.
    expect((await ask(`${nell}; ${samsPaywall}`)).reader).toBe("everyone");
  });

  it("never takes a cookie that has been changed", async () => {
    const { ask, signIn } = await site();
    let cookie = await signIn("nell@example.org");
    cookie = cookiesAfter(cookie, (await ask(cookie)).cookies);
    const changed = cookie.replace(`${PAYWALL_COOKIE}=e.`, `${PAYWALL_COOKIE}=m.`);
    expect(changed).not.toBe(cookie);
    expect((await ask(changed)).reader).toBe("everyone");
  });

  it("answers someone banned for everyone, whatever they subscribe to", async () => {
    const { ask, context, signIn, samId } = await site();
    const cookie = await signIn("sam@example.org");
    await context.internalAdapter.updateUser(samId, { banned: true });
    expect((await ask(cookie)).reader).toBe("everyone");
  });

  it("marks the cookie Secure on the site's https address", async () => {
    const { ask, signIn } = await site();
    const { cookies } = await ask(await signIn("sam@example.org"), Date.now(), "https://www.example.org/handbook/");
    expect(cookies.at(-1)).toMatch(/; Secure$/);
  });
});

describe("the cookie's value", () => {
  it("opens only with the secret it was sealed with, for the same session, before it ends", async () => {
    const now = Date.now();
    const value = await sealReader(SECRET, "members", now + 1000, "token-1");
    expect(await openReader(SECRET, value, "token-1", now)).toBe("members");
    expect(await openReader(`${SECRET}-other`, value, "token-1", now)).toBeUndefined();
    expect(await openReader(SECRET, value, "token-2", now)).toBeUndefined();
    expect(await openReader(SECRET, value, "token-1", now + 1000)).toBeUndefined();
    const [who, until, session, mac] = value.split(".");
    expect(await openReader(SECRET, [who, Number(until) + HOUR, session, mac].join("."), "token-1", now)).toBe(
      undefined,
    );
    expect(await openReader(SECRET, "m.1.2", "token-1", now)).toBeUndefined();
    expect(await openReader(SECRET, `${value}.more`, "token-1", now)).toBeUndefined();
  });
});

describe("addresses", () => {
  it("finds every spelling of a members' version's address", () => {
    for (const path of [
      "/members/pages",
      "/members/pages/",
      "/members/pages/handbook/",
      "/Members/Pages/handbook/",
      "/members/%70ages/handbook/",
      "/%6Dembers/pages/",
      "/members/%2570ages/handbook/",
      "/members%2Fpages/handbook/",
      "//members//pages/handbook/",
      "/members\\pages/handbook/",
    ]) {
      const routed = routedPath(path);
      expect(routed !== undefined && isMembersVersion(routed), path).toBe(true);
    }
    for (const path of ["/members/", "/members/pageant/", "/handbook/", "/pages/members/"]) {
      expect(isMembersVersion(routedPath(path) ?? ""), path).toBe(false);
    }
    expect(routedPath("/members/%E0%A4%A/")).toBeUndefined();
  });

  it("tells pages from files and the site's own routes", () => {
    for (const path of ["/", "/handbook/", "/news/launch/", "/membership/"]) {
      expect(isPageRequest("GET", path), path).toBe(true);
    }
    expect(isPageRequest("HEAD", "/handbook/")).toBe(true);
    expect(isPageRequest("POST", "/handbook/")).toBe(false);
    for (const path of [
      "/api/auth/get-session/",
      "/admin/",
      "/admin",
      "/sign-in/",
      "/members/",
      "/media/photo.jpg",
      "/robots.txt",
      "/goodfellow-site.json",
      "/pagefind/pagefind.js",
      "/_next/data/x.json",
    ]) {
      expect(isPageRequest("GET", path), path).toBe(false);
    }
  });

  it("lets only the site's build through to the members' versions, by its own environment", () => {
    expect(isBuildingPages("phase-production-build")).toBe(true);
    for (const phase of [undefined, "", "phase-production-server", "phase-development-server"]) {
      expect(isBuildingPages(phase), String(phase)).toBe(false);
    }
  });

  it("sends members to the members' version of the page they asked for, with its query", () => {
    expect(membersVersionUrl(new URL(`${SITE}/handbook/?q=1`)).href).toBe(
      `${SITE}${MEMBERS_VERSION_PATH}/handbook/?q=1`,
    );
    expect(membersVersionUrl(new URL(`${SITE}/`)).pathname).toBe(`${MEMBERS_VERSION_PATH}/`);
  });
});

describe("entitlements", () => {
  it("says what someone may have, and until when they subscribe", async () => {
    const { context, samId, nellId } = await site();
    const now = new Date();
    expect(await can(context.adapter, samId, "price_monthly")).toBe(true);
    expect(await can(context.adapter, samId, "report-2026")).toBe(false);
    expect(await subscribedUntil(context.adapter, samId)).toBeNull();
    expect(await subscribedUntil(context.adapter, nellId)).toBeUndefined();
    const later = new Date(now.getTime() + HOUR);
    await grant(context.adapter, { userId: nellId, kind: "subscription", reference: "a", expiresAt: later });
    await grant(context.adapter, {
      userId: nellId,
      kind: "subscription",
      reference: "b",
      expiresAt: new Date(now.getTime() + 2 * HOUR),
    });
    expect((await subscribedUntil(context.adapter, nellId, now))?.getTime()).toBe(now.getTime() + 2 * HOUR);
    expect(await can(context.adapter, nellId, "a", new Date(later.getTime() + 1))).toBe(false);
  });

  it("goes when the person's account does", async () => {
    const { context, samId } = await site();
    await context.internalAdapter.deleteUser(samId);
    expect(await can(context.adapter, samId, "price_monthly")).toBe(false);
  });
});
