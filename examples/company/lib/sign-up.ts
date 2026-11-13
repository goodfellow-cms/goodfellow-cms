// Signing up, which readers do to subscribe: made as invitations are (lib/editors.ts), an account with a password
// nobody knows and an email with a link to choose one, which confirms the address is theirs. Nobody signs in with an
// address until a password has been chosen from a link sent to it, so a stranger who signs up with someone else's
// address gets nothing: the owner chooses their own password, or, if they never do, signs up again for a new link.
import { generateRandomString } from "better-auth/crypto";
import {
  isMemberRole,
  MAX_NAME_LENGTH,
  MEMBER_ROLE,
  releaseEmailSlot,
  SIGN_UP_FROM_IDENTIFIER,
  SIGN_UP_LIMIT,
  type SiteAuth,
  takeEmailSlot,
  VERIFY_ACCOUNT_LIMIT,
  VERIFY_HOURS,
  VERIFY_SENT_IDENTIFIER,
} from "./auth.ts";
import { passwordLink } from "./editors.ts";
import { canSendEmail, EmailNotSetUp, EmailRefused, sendEmail, signUpEmail } from "./email.ts";
import { inBackground, type SiteEnv } from "./env.ts";
import { fromThisSite } from "./sign-out.ts";
import { sitePath } from "./site-path.ts";

/** A problem the sign-up page shows, with the HTTP status the API answers with. */
export class SignUpError extends Error {
  override name = "SignUpError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** What someone signing up gives: their name, their address, and the page to go on to once they've chosen a password. */
export interface SignUp {
  name: string;
  email: string;
  next: string;
}

/**
 * The sign-up as asked, checked, since anyone can send anything: an address, and a name of `MAX_NAME_LENGTH` at most
 * as it's sent, spaces and all, which is stored without the spaces around it.
 */
export function signUpFrom(body: unknown): SignUp {
  const given = (body ?? {}) as Record<string, unknown>;
  const email = typeof given.email === "string" ? given.email.trim().toLowerCase() : "";
  const sent = typeof given.name === "string" ? given.name : "";
  const name = sent.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new SignUpError(400, "Give your email address.");
  }
  if (name === "" || sent.length > MAX_NAME_LENGTH) {
    throw new SignUpError(400, `Give your name, in ${MAX_NAME_LENGTH} characters at most.`);
  }
  return { name, email, next: sitePath(typeof given.next === "string" ? given.next : undefined) };
}

/**
 * Sends the address a link to choose a password: for a new reader's account, which this makes, or one a reader made
 * before and never chose a password for. An address that already has an account with a password, or an editor's,
 * is sent nothing. Each account is sent at most `VERIFY_ACCOUNT_LIMIT`'s emails, however many ask.
 */
async function sendLink(siteAuth: SiteAuth, siteEnv: SiteEnv, signUp: SignUp): Promise<void> {
  const context = await siteAuth.$context;
  const { adapter, internalAdapter } = context;
  type Account = { id: string; emailVerified: boolean; role?: string | null };
  let user = (await internalAdapter.findUserByEmail(signUp.email))?.user as Account | undefined;
  if (user && (user.emailVerified || !isMemberRole(user.role))) return;
  if (!user) {
    try {
      user = (await internalAdapter.createUser(
        { email: signUp.email, name: signUp.name, emailVerified: false, role: MEMBER_ROLE },
        { method: "email-password" },
      )) as Account;
      await internalAdapter.linkAccount({
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: await context.password.hash(generateRandomString(48)),
      });
    } catch {
      // Someone signed up with the same address at the same moment: theirs is the account, and this sends nothing.
      return;
    }
  }
  const slot = await takeEmailSlot(adapter, VERIFY_SENT_IDENTIFIER, user.id, VERIFY_ACCOUNT_LIMIT);
  if (!slot) return;
  let link: string;
  try {
    link = await passwordLink(siteAuth, siteEnv, user.id, { hours: VERIFY_HOURS, next: signUp.next });
  } catch {
    // No link was made, such as while another of the account's is being sent or used: nothing counts against its share.
    await releaseEmailSlot(adapter, slot);
    return;
  }
  try {
    await sendEmail(
      siteEnv,
      signUpEmail({ to: signUp.email, siteUrl: siteEnv.GOODFELLOW_SITE_URL ?? "", link, hours: VERIFY_HOURS }),
    );
  } catch (error) {
    console.error(`A sign-up's email wasn't sent: ${error instanceof Error ? error.name : "error"}.`);
    // An email the service refused, or that the site couldn't send, doesn't count against the account's share.
    if (error instanceof EmailRefused || error instanceof EmailNotSetUp) await releaseEmailSlot(adapter, slot);
  }
}

/**
 * Signs someone up, from the site's own pages: at most `SIGN_UP_LIMIT`'s from one network address, which
 * `CLIENT_IP_HEADER` names (all requests count as one where it's not set), and only where the site can send the email
 * the account's password is chosen from. The answer is the same whatever the address, and the account's work happens
 * after it (`inBackground()`), so how long it takes doesn't say either.
 */
export async function signUp(siteAuth: SiteAuth, siteEnv: SiteEnv, request: Request): Promise<void> {
  if (!fromThisSite(request)) throw new SignUpError(403, "Sign up from the site's own pages.");
  if (!canSendEmail(siteEnv) || !siteEnv.GOODFELLOW_SITE_URL) {
    throw new SignUpError(503, "This site can't send email yet, so nobody can sign up.");
  }
  const asked = signUpFrom(await request.json().catch(() => undefined));
  const from = (siteEnv.CLIENT_IP_HEADER && request.headers.get(siteEnv.CLIENT_IP_HEADER)) || "unknown";
  const { adapter } = await siteAuth.$context;
  if (!(await takeEmailSlot(adapter, SIGN_UP_FROM_IDENTIFIER, from, SIGN_UP_LIMIT))) {
    throw new SignUpError(429, "Too many sign-ups from here. Try again in an hour.");
  }
  inBackground(
    sendLink(siteAuth, siteEnv, asked).catch((error: unknown) =>
      console.error(`A sign-up wasn't finished: ${error instanceof Error ? error.name : "error"}.`),
    ),
  );
}

/** The API's answer for a problem: its words for a known one, and nothing about anything else. */
export function signUpProblem(error: unknown): Response {
  const known = error instanceof SignUpError;
  if (!known) console.error(`Signing up failed: ${error instanceof Error ? error.name : "error"}.`);
  return Response.json(
    { error: known ? error.message : "Something went wrong. Try again in a moment." },
    { status: known ? error.status : 500, headers: { "cache-control": "no-store" } },
  );
}
