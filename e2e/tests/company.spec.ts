import { createHmac } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { COMPANY, COMPANY_PASSWORD, COMPANY_PEOPLE, COMPANY_TOTP_SECRET } from "../scripts/site.mjs";
import { editor } from "./helpers.js";

// The company example, built into a Cloudflare Worker with vinext and served in workerd with a local D1 database,
// as Cloudflare would: the full-stack contract `next-server.spec.ts` checks on Node, here on Workers, with the
// example's own sign-in (Better Auth) and accounts.
const SITE = `http://localhost:${COMPANY.port}`;
const GITHUB = `http://127.0.0.1:${COMPANY.github}`;

/** Asks the site's fake content repository, as only the site's server does. */
async function github<T>(path: string): Promise<T> {
  const response = await fetch(`${GITHUB}${path}`, { headers: { authorization: `Bearer ${COMPANY.token}` } });
  return (await response.json()) as T;
}

/** The code an authenticator app shows now for `secret` (RFC 6238: SHA-1, 6 digits, 30 seconds). */
function totp(secret: Buffer): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", secret).update(counter).digest();
  const offset = (hash.at(-1) ?? 0) & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** The secret behind the base32 key an authenticator app is given. */
function fromBase32(key: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of key.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
}

/** Signs in with the site's own form, with a code from the admin's authenticator app, and goes on to `next`. */
async function signIn(page: Page, as: keyof typeof COMPANY_PEOPLE, next = "/admin/") {
  await page.goto(`${SITE}/sign-in/?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email address").fill(COMPANY_PEOPLE[as].email);
  await page.getByLabel("Password").fill(COMPANY_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  if ("twoFactor" in COMPANY_PEOPLE[as]) {
    await page.getByLabel("Code from your authenticator app").fill(totp(Buffer.from(COMPANY_TOTP_SECRET)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(`${SITE}${next}`);
}

test.beforeEach(async () => {
  await fetch(`${GITHUB}/__reset`, { method: "POST" });
});

test("renders each page once from the content repository, then serves it without rendering", async ({ request }) => {
  const asked = async () => ((await (await fetch(`${GITHUB}/__requests`)).json()) as { requests: number }).requests;
  for (const address of ["/", "/about/", "/news/", "/news/welcome/"]) {
    // The first visit renders the page from the content repository; every one after is the kept copy, which asks
    // GitHub nothing.
    expect((await request.get(`${SITE}${address}`)).status(), address).toBe(200);
    const before = await asked();
    const page = await request.get(`${SITE}${address}`);
    expect(page.status(), address).toBe(200);
    expect(page.headers()["x-vinext-cache"], address).toBe("HIT");
    expect(await asked(), address).toBe(before);
  }
  expect((await request.get(`${SITE}/no-such-page/`)).status()).toBe(404);
});

test("keeps the members' page to people who are signed in", async ({ page, request }) => {
  const signedOut = await request.get(`${SITE}/members/`, { maxRedirects: 0 });
  expect(signedOut.status()).toBe(307);
  expect(new URL(signedOut.headers().location ?? "", SITE).href).toBe(`${SITE}/sign-in/?next=%2Fmembers%2F`);
  // A session cookie is checked, not only seen.
  const madeUp = await request.get(`${SITE}/members/`, {
    maxRedirects: 0,
    headers: { cookie: "better-auth.session_token=made-up.c2lnbmF0dXJl" },
  });
  expect(madeUp.status()).toBe(307);

  await page.goto(`${SITE}/members/`);
  await expect(page).toHaveURL(`${SITE}/sign-in/?next=%2Fmembers%2F`);
  await page.getByLabel("Email address").fill(COMPANY_PEOPLE.editor.email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email address and password don't match an account here.");

  await page.getByLabel("Password").fill(COMPANY_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${SITE}/members/`);
  // The page is the same for everyone; the browser fills in who's here.
  await expect(page.getByText(`Signed in as ${COMPANY_PEOPLE.editor.name}.`)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${SITE}/`);
  await page.goto(`${SITE}/members/`);
  await expect(page).toHaveURL(`${SITE}/sign-in/?next=%2Fmembers%2F`);
});

test("shows everyone but subscribers a members-only page's teaser, and subscribers all of it", async ({
  page,
  request,
}) => {
  const intro = "Everything we share with subscribers";
  const membersOnly = "Replace this with what only subscribers read.";
  const paywall = "The rest is for subscribers";
  const teaser = async () => {
    const answer = await request.get(`${SITE}/handbook/`);
    expect(answer.status()).toBe(200);
    return answer.text();
  };
  // Signed out: the teaser, the same for everyone, from the cache.
  await teaser();
  const signedOut = await request.get(`${SITE}/handbook/`);
  expect(signedOut.headers()["x-vinext-cache"]).toBe("HIT");
  const html = await signedOut.text();
  expect(html).toContain(intro);
  expect(html).toContain(paywall);
  expect(html).not.toContain(membersOnly);

  // The members' version answers only requests the proxy sends it, however its address is spelled.
  for (const address of ["/members/pages/handbook/", "/members/%70ages/handbook/", "/%6Dembers/pages/handbook/"]) {
    const direct = await request.get(`${SITE}${address}`, { maxRedirects: 0 });
    expect(direct.status(), address).toBe(404);
    expect(await direct.text(), address).not.toContain(membersOnly);
  }

  // Signed in without a subscription: still the teaser.
  await signIn(page, "editor", "/handbook/");
  await expect(page.getByRole("heading", { name: paywall })).toBeVisible();
  await expect(page.getByText(membersOnly)).toHaveCount(0);
  await page.goto(`${SITE}/sign-out/`);
  await page.getByRole("button", { name: "Sign out" }).click();

  // A subscriber: the whole page, without the paywall, from the cache too, and kept from every shared cache.
  await signIn(page, "subscriber", "/handbook/");
  await expect(page.getByText(membersOnly)).toBeVisible();
  await expect(page.getByRole("heading", { name: paywall })).toHaveCount(0);
  await page.reload();
  const full = await page.request.get(`${SITE}/handbook/`);
  expect(await full.text()).toContain(membersOnly);
  expect(full.headers()["x-vinext-cache"]).toBe("HIT");
  expect(full.headers()["cache-control"]).toContain("private");
  // Even a subscriber can't open the members' version's own address.
  expect((await page.request.get(`${SITE}/members/pages/handbook/`)).status()).toBe(404);

  // Signed out again: the teaser, whatever the cookie that said they subscribe still says.
  await page.goto(`${SITE}/sign-out/`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${SITE}/handbook/`);
  await expect(page.getByRole("heading", { name: paywall })).toBeVisible();
  await expect(page.getByText(membersOnly)).toHaveCount(0);
});

test("limits how often one address can try to sign in, counting in the Worker's database", async ({ request }) => {
  // An address of its own, which Cloudflare gives the Worker as cf-connecting-ip, so the other tests' sign-ins
  // aren't counted with these.
  const attempt = async () =>
    (
      await request.post(`${SITE}/api/auth/sign-in/email/`, {
        headers: { origin: SITE, "cf-connecting-ip": "198.51.100.7" },
        data: { email: COMPANY_PEOPLE.editor.email, password: "a guess" },
      })
    ).status();
  const answers: number[] = [];
  for (let tried = 0; tried < 11; tried++) answers.push(await attempt());
  expect(answers.slice(0, 10)).toEqual(Array(10).fill(401));
  expect(answers[10]).toBe(429);
});

test("signs out only when the site's own pages ask", async ({ request }) => {
  const elsewhere = await request.post(`${SITE}/sign-out/`, { headers: { "sec-fetch-site": "cross-site" } });
  expect(elsewhere.status()).toBe(403);
  const typedIn = await request.get(`${SITE}/sign-out/`, { headers: { "sec-fetch-site": "none" } });
  expect(await typedIn.text()).toContain("Sign out?");
});

test("publishes to the content repository through the Worker, naming the editor as the author", async ({ page }) => {
  // The page as visitors see it before, which Workers Cache keeps.
  expect(await (await page.request.get(`${SITE}/about/`)).text()).not.toContain("About our company");
  await signIn(page, "editor");
  await expect(page.locator(".gfa-account")).toContainText(COMPANY_PEOPLE.editor.name);
  await page.getByRole("link", { name: "About us", exact: true }).click();
  const heading = editor(page).locator(".gf-canvas").first().getByRole("heading", { name: "About us" });
  await heading.click();
  await editor(page).locator('input[name="text"]:visible').fill("About our company");
  await page.locator(".gfa-editor-header").getByText("Publish", { exact: true }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();

  const [commit] = await github<Array<{ commit: { author: { name: string } } }>>(
    `/repos/${COMPANY.repo}/commits?path=content/pages/about.json`,
  );
  expect(commit?.commit.author.name).toBe(COMPANY_PEOPLE.editor.name);
  const about = await github<{ content: string }>(`/repos/${COMPANY.repo}/contents/content/pages/about.json`);
  expect(Buffer.from(about.content, "base64").toString("utf8")).toContain("About our company");
  // The token the Worker publishes with never reaches the browser.
  expect(await page.content()).not.toContain(COMPANY.token);
  // Visitors see it without the site being built again: the publish asked for its pages to render again.
  expect(await (await page.request.get(`${SITE}/about/`)).text()).toContain("About our company");
});

test("leaves Site Settings to the site's admins, whatever an editor's browser sends", async ({ page }) => {
  await signIn(page, "editor");
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await expect(page.locator(".gfa-nav").getByRole("link", { name: "Settings" })).toHaveCount(0);
  const status = await page.evaluate(async () => {
    const { revision } = await (
      await fetch("/api/goodfellow/revision/", { headers: { "x-goodfellow-request": "1" } })
    ).json();
    const response = await fetch("/api/goodfellow/write/", {
      method: "POST",
      headers: { "x-goodfellow-request": "1", "content-type": "application/json" },
      body: JSON.stringify({
        changes: [{ path: "content/site.json", content: "{}" }],
        message: "Retitle",
        expectedRevision: revision,
      }),
    });
    return response.status;
  });
  expect(status).toBe(403);

  await page.goto(`${SITE}/sign-out/`);
  await signIn(page, "admin");
  await page.locator(".gfa-nav").getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Site name").fill("Northwind");
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Published.", { exact: true })).toBeVisible();
  const [commit] = await github<Array<{ commit: { author: { name: string } } }>>(
    `/repos/${COMPANY.repo}/commits?path=content/site.json`,
  );
  expect(commit?.commit.author.name).toBe(COMPANY_PEOPLE.admin.name);
});

test("tells the admin panel where to sign in, and refuses requests from other sites", async ({ request }) => {
  const session = await request.get(`${SITE}/api/goodfellow/session/`, {
    headers: { "x-goodfellow-request": "1", "sec-fetch-site": "same-origin" },
  });
  expect(await session.json()).toMatchObject({ signedIn: false, signIn: "/sign-in/?next=/admin/" });
  const crossSite = await request.get(`${SITE}/api/goodfellow/revision/`, {
    headers: { "x-goodfellow-request": "1", "sec-fetch-site": "cross-site" },
  });
  expect(crossSite.status()).toBe(403);
});

/** The link to `path` in the newest message the fake Resend was sent for `to` with one, waiting for it to arrive. */
async function emailedLink(to: string, path: string): Promise<string> {
  let found: string | undefined;
  await expect(async () => {
    const sent = (await (await fetch(`http://127.0.0.1:${COMPANY.resend}/__sent`)).json()) as Array<{
      to: string[];
      text: string;
    }>;
    found = sent
      .filter((email) => email.to.includes(to))
      .map((email) => email.text.match(/https?:\/\/\S+/)?.[0])
      .filter((link) => link !== undefined && new URL(link).pathname === path)
      .at(-1);
    expect(found).toBeDefined();
  }).toPass();
  return found ?? "";
}

test("lets admins invite editors, who choose a password, and lets anyone choose a new one", async ({ page }) => {
  // The database lasts the whole run, so each run invites someone new.
  const email = `ivy-${Date.now()}@example.org`;
  await signIn(page, "admin", "/admin/editors/");
  await expect(page.getByRole("cell", { name: COMPANY_PEOPLE.editor.email })).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill("Ivy Invited");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("They can").selectOption("admin");
  await page.getByRole("button", { name: "Send the invitation" }).click();
  await expect(page.getByRole("status")).toHaveText(new RegExp(`We've emailed ${email}`));
  await expect(page.getByRole("cell", { name: "Ivy Invited (invited)" })).toBeVisible();

  const invitation = await emailedLink(email, "/accept-invite/");
  expect(invitation).toMatch(new RegExp(`^${SITE}/accept-invite/\\?token=`));
  await page.goto(`${SITE}/sign-out/`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(invitation);
  await page.getByLabel("New password").fill("ivy's first password");
  await page.getByLabel("The same password again").fill("ivy's first password");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByText("Your password is set.")).toBeVisible();
  // The link works once.
  await page.goto(invitation);
  await page.getByLabel("New password").fill("another long password");
  await page.getByLabel("The same password again").fill("another long password");
  await page.getByRole("button", { name: "Set my password" }).click();
  await expect(page.getByRole("alert")).toContainText("already been used or has run out");

  // Forgot it already.
  await page.goto(`${SITE}/sign-in/`);
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send me a link" }).click();
  await expect(page.getByText("If that address has an account here")).toBeVisible();
  const reset = await emailedLink(email, "/reset-password/");
  expect(reset).toMatch(new RegExp(`^${SITE}/reset-password/\\?token=`));
  await page.goto(reset);
  await page.getByLabel("New password").fill("ivy's second password");
  await page.getByLabel("The same password again").fill("ivy's second password");
  await page.getByRole("button", { name: "Change my password" }).click();
  await expect(page.getByText("Your password is changed")).toBeVisible();

  await page.goto(`${SITE}/sign-in/?next=%2Fadmin%2Feditors%2F`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("ivy's second password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // An admin with only a password can't manage editors until she turns on two-factor sign-in.
  await expect(page.getByRole("alert")).toHaveText(/Turn on two-factor sign-in on your account page first/);
  await page.getByRole("link", { name: "Your account" }).click();
  await page.getByLabel("Your password").fill("ivy's second password");
  await page.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
  await expect(page.getByRole("img", { name: "The code for your authenticator app" })).toBeVisible();
  const key = fromBase32((await page.locator("li code").first().textContent()) ?? "");
  await page.getByLabel("The code your app shows now").fill("000000");
  await page.getByRole("button", { name: "Turn it on" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  await page.getByLabel("The code your app shows now").fill(totp(key));
  await page.getByRole("button", { name: "Turn it on" }).click();
  await expect(page.getByRole("status")).toHaveText(/Two-factor sign-in is on/);
  await page.goto(`${SITE}/admin/editors/`);
  await expect(page.getByRole("cell", { name: email })).toBeVisible();

  // Signing in now asks for a code after the password.
  await page.goto(`${SITE}/sign-out/`);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(`${SITE}/sign-in/?next=%2Fmembers%2F`);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("ivy's second password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Code from your authenticator app").fill(totp(key));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Signed in as Ivy Invited.")).toBeVisible();
});

test("keeps Better Auth's admin routes from the browser", async ({ page }) => {
  await signIn(page, "admin");
  const statuses = await page.evaluate(async () =>
    Promise.all(
      ["/api/auth/admin/list-users", "/api/auth//admin/list-users"].map(
        async (path) => (await fetch(path, { credentials: "include" })).status,
      ),
    ),
  );
  expect(statuses).toEqual([404, 404]);
});

test("keeps the editors page to the site's admins", async ({ page }) => {
  await signIn(page, "editor");
  const answers = await page.evaluate(async () => {
    const list = await fetch("/api/editors/");
    const invite = await fetch("/api/editors/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "mallory@example.org", name: "Mallory", role: "admin" }),
    });
    return [list.status, invite.status];
  });
  expect(answers).toEqual([403, 403]);
});
