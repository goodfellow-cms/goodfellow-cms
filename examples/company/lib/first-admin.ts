// The site's first admin, made from its own `/setup/` page with the setup code Goodfellow's setup page showed once,
// for a site created in the browser, where nobody can run `npm run new-admin`. Only the code's SHA-256 is kept, in
// wrangler.jsonc's `GOODFELLOW_SETUP_CODE_HASH`, so the code can't be read from the repository even where it's public.
// It makes one admin, once: while the site has no admin, and never again after, whatever happens to them.
import { SETUP_CODE_VARIABLE, setupCodeHash } from "@goodfellow-cms/core";
import { AdminTaken, createAdmin, type NewAdmin, newAdminProblem } from "./admins.ts";
import { claimRow, type SiteAuth, takeEmailSlot } from "./auth.ts";
import type { SiteEnv } from "./env.ts";
import { fromThisSite } from "./sign-out.ts";

/** A problem the setup page shows, with the HTTP status the API answers with. */
export class SetupError extends Error {
  override name = "SetupError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The id of the row that says the setup code has been used, which only one request can write (`claimRow()`), so two
 * at once can't both make an admin. It's never taken back once an admin has been made.
 */
export const SETUP_DONE = "first-admin";

/** Where the slots of setup attempts from one network address are kept (`SETUP_LIMIT`). */
export const SETUP_FROM_IDENTIFIER = "setup-from:";

/**
 * How many times one network address may try a setup code, and in how many seconds: a code has 120 random bits, so
 * this only keeps someone from filling the logs, and lets its owner mistype it a few times.
 */
export const SETUP_LIMIT = { window: 60 * 60, max: 10 };

/** The site's setup code's hash, where wrangler.jsonc has one as `setupCodeHash()` writes it. */
export function setupHashOf(siteEnv: SiteEnv): string | undefined {
  const hash = siteEnv.GOODFELLOW_SETUP_CODE_HASH;
  return hash && /^[0-9a-f]{64}$/.test(hash) ? hash : undefined;
}

/** Whether two hashes are the same, taking as long whichever character differs. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let differ = 0;
  for (let at = 0; at < a.length; at++) differ |= a.charCodeAt(at) ^ b.charCodeAt(at);
  return differ === 0;
}

/** What someone setting the site up gives, checked, since anyone can send anything. */
export function setupFrom(body: unknown): NewAdmin & { code: string } {
  const given = (body ?? {}) as Record<string, unknown>;
  const text = (key: string) => (typeof given[key] === "string" ? (given[key] as string) : "");
  const code = text("code");
  if (code.trim() === "" || code.length > 100) throw new SetupError(400, "Give the setup code the setup page showed.");
  const person = { email: text("email").trim(), name: text("name"), password: text("password") };
  // The same rules as `npm run new-admin`'s, in the words of someone making themselves the admin.
  const problem = newAdminProblem(person, "self");
  if (problem) throw new SetupError(400, problem);
  return { ...person, code };
}

/**
 * Makes the person who has the setup code the site's first admin, from the site's own pages: only where wrangler.jsonc
 * has the code's hash, the code is right, and the site has no admin yet, at most `SETUP_LIMIT`'s attempts from one
 * network address, which `CLIENT_IP_HEADER` names.
 */
export async function setUpFirstAdmin(siteAuth: SiteAuth, siteEnv: SiteEnv, request: Request): Promise<void> {
  if (!fromThisSite(request)) throw new SetupError(403, "Set the site up from its own pages.");
  const hash = setupHashOf(siteEnv);
  if (!hash) {
    throw new SetupError(
      404,
      `This site wasn't made with a setup code (${SETUP_CODE_VARIABLE}): make its first admin with npm run new-admin, as its README says.`,
    );
  }
  const asked = setupFrom(await request.json().catch(() => undefined));
  const context = await siteAuth.$context;
  const { adapter } = context;
  const from = (siteEnv.CLIENT_IP_HEADER && request.headers.get(siteEnv.CLIENT_IP_HEADER)) || "unknown";
  if (!(await takeEmailSlot(adapter, SETUP_FROM_IDENTIFIER, from, SETUP_LIMIT))) {
    throw new SetupError(429, "Too many tries from here. Try again in an hour.");
  }
  if (!sameHash(await setupCodeHash(asked.code), hash)) {
    throw new SetupError(403, "That isn't this site's setup code. Check it, and copy it again if you can.");
  }
  const done = new SetupError(409, "This site has its first admin already. Sign in instead.");
  const admins = await adapter.count({ model: "user", where: [{ field: "role", value: "admin" }] });
  if (admins > 0) throw done;
  const holder = crypto.randomUUID();
  const claimed = await claimRow(adapter, {
    id: SETUP_DONE,
    identifier: SETUP_DONE,
    value: holder,
    // Kept for good: the code makes one admin, ever.
    expiresAt: new Date("9999-12-31T00:00:00Z"),
  });
  if (!claimed) throw done;
  try {
    await createAdmin(context, asked);
  } catch (error) {
    // Nobody was made an admin, so the code works again.
    await adapter.deleteMany({
      model: "verification",
      where: [
        { field: "id", value: SETUP_DONE },
        { field: "value", value: holder },
      ],
    });
    if (error instanceof AdminTaken) throw new SetupError(409, "That address has an account already. Use another.");
    throw error;
  }
}

/** The API's answer for a problem: its words for a known one, and nothing about anything else. */
export function setupProblem(error: unknown): Response {
  const known = error instanceof SetupError;
  if (!known) console.error(`Setting the site up failed: ${error instanceof Error ? error.name : "error"}.`);
  return Response.json(
    { error: known ? error.message : "Something went wrong. Try again in a moment." },
    { status: known ? error.status : 500, headers: { "cache-control": "no-store" } },
  );
}
