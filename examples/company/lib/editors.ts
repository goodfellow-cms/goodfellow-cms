// The site's editors, for its admins: who has an account, inviting someone, changing what they may do, and removing
// them. Everything here goes through Better Auth's admin plugin, which checks the caller is an admin, and through
// `authorizeWith()`, which also refuses banned admins and admins acting as someone else.
import { generateRandomString } from "better-auth/crypto";
import { authorizeWith, claimRow, RESET_IDENTIFIER, retireResetLinks, type SiteAuth } from "./auth.ts";
import { canSendEmail, type Email, invitationEmail, sendEmail } from "./email.ts";
import type { SiteEnv } from "./env.ts";
import { fromThisSite } from "./sign-out.ts";

/** What someone may do: `admin`, the site's owners, or `editor`. */
export type EditorRole = "admin" | "editor";

/** One person with an account, as the editors page lists them. */
export interface SiteEditor {
  id: string;
  email: string;
  name: string;
  role: EditorRole;
  /** Whether they've chosen a password from their invitation, or were made an admin with one. */
  joined: boolean;
}

/** How long an invitation's link works, in hours: long enough to see the email, short enough not to linger. */
export const INVITATION_HOURS = 48;

/** The start of the id of the row holding someone's invitation link, one for each person. */
const INVITATION_ROW = "invitation:";

/** How many people are read from the database at a time. */
const PAGE_SIZE = 200;

/** A problem the page shows, with the HTTP status the API answers with. */
export class EditorsError extends Error {
  override name = "EditorsError";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Who's asking, if they're an admin who may manage editors: the request must come from the site's own pages, since
 * a form on another site could otherwise invite someone in an admin's name, and from an admin acting as themselves.
 */
export async function adminAsking(siteAuth: SiteAuth, request: Request): Promise<{ email: string; name: string }> {
  if (request.method !== "GET" && !fromThisSite(request)) {
    throw new EditorsError(403, "Manage editors from the site's own pages.");
  }
  const editor = await authorizeWith(siteAuth, request);
  if (editor === null) throw new EditorsError(401, "Sign in first.");
  if (editor === false || editor.role !== "owner") {
    throw new EditorsError(403, "Only the site's admins can manage its editors.");
  }
  return { email: editor.email ?? editor.login, name: editor.name ?? editor.login };
}

function roleOf(value: unknown): EditorRole {
  return value === "admin" ? "admin" : "editor";
}

/** Choosing a password from the invitation's link shows the address is theirs, which marks it verified (lib/auth.ts). */
function editorOf(user: { id: string; email: string; name: string; role?: string | null; emailVerified: boolean }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: roleOf(user.role),
    joined: user.emailVerified,
  } satisfies SiteEditor;
}

/** Everyone with an account, admins first, then by name, read a page at a time, however many there are. */
export async function listEditors(siteAuth: SiteAuth, request: Request): Promise<SiteEditor[]> {
  await adminAsking(siteAuth, request);
  const editors: SiteEditor[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { users } = await siteAuth.api.listUsers({
      headers: request.headers,
      query: { limit: PAGE_SIZE, offset, sortBy: "id", sortDirection: "asc" },
    });
    editors.push(...users.map(editorOf));
    if (users.length < PAGE_SIZE) break;
  }
  return editors.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "admin" ? -1 : 1));
}

/** The person a change is for, found by their id, wherever they'd be listed. */
async function editorById(siteAuth: SiteAuth, userId: string): Promise<SiteEditor> {
  const user =
    typeof userId === "string" && userId ? await (await siteAuth.$context).internalAdapter.findUserById(userId) : null;
  if (!user) throw new EditorsError(404, "There's no such person.");
  return editorOf(user as Parameters<typeof editorOf>[0]);
}

/** What an admin gives to invite someone. */
export interface Invitation {
  email: string;
  name: string;
  role: EditorRole;
}

/** The invitation as asked, checked, since anyone signed in as an admin can send anything. */
export function invitationFrom(body: unknown): Invitation {
  const given = (body ?? {}) as Record<string, unknown>;
  const email = typeof given.email === "string" ? given.email.trim().toLowerCase() : "";
  const name = typeof given.name === "string" ? given.name.trim() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new EditorsError(400, "Give the person's email address.");
  }
  if (name === "" || name.length > 100) throw new EditorsError(400, "Give the person's name.");
  if (given.role !== undefined && given.role !== "admin" && given.role !== "editor") {
    throw new EditorsError(400, "Choose admin or editor.");
  }
  return { email, name, role: roleOf(given.role) };
}

/**
 * A new single-use link that lets the person choose a password, as Better Auth's password reset reads it, at the
 * site's own address, never the request's, which a visitor could choose. Their earlier links stop working, so one
 * that went astray can't be used later.
 */
async function invitationLink(siteAuth: SiteAuth, siteEnv: SiteEnv, userId: string): Promise<string> {
  if (!siteEnv.GOODFELLOW_SITE_URL) {
    throw new EditorsError(500, "Set GOODFELLOW_SITE_URL, the site's address, so invitations can link to it.");
  }
  const token = generateRandomString(32);
  const context = await siteAuth.$context;
  const { adapter, internalAdapter } = context;
  // One row for the person's invitation, rewritten for each new link, so of links sent at the same moment exactly
  // the last one works; reset links aside, which the person can't have until they've joined (lib/auth.ts).
  const id = `${INVITATION_ROW}${userId}`;
  const row = {
    identifier: `${RESET_IDENTIFIER}${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + INVITATION_HOURS * 60 * 60 * 1000),
  };
  const rewrite = () =>
    adapter.update({
      model: "verification",
      where: [{ field: "id", value: id }],
      update: { ...row, updatedAt: new Date() },
    });
  if (!(await rewrite()) && !(await claimRow(adapter, { id, ...row }))) await rewrite();
  await retireResetLinks(adapter, userId, id);
  // Taken back if the person has joined meanwhile, since accepting retires links again once it's marked them joined.
  if ((await internalAdapter.findUserById(userId))?.emailVerified) {
    await adapter.deleteMany({ model: "verification", where: [{ field: "id", value: id }] });
    throw new EditorsError(409, "They've already joined.");
  }
  const link = new URL("/accept-invite/", siteEnv.GOODFELLOW_SITE_URL);
  link.searchParams.set("token", token);
  return link.href;
}

/** What inviting someone did: the email was sent, or, where the site can't send email, the link to send yourself. */
export type Invited = { sent: true } | { sent: false; link: string };

/** Sends the person their link, or hands it to the admin where the site can't send email. */
async function deliver(siteEnv: SiteEnv, email: Email, link: string): Promise<Invited> {
  if (!canSendEmail(siteEnv)) return { sent: false, link };
  try {
    await sendEmail(siteEnv, email);
  } catch {
    throw new EditorsError(
      502,
      "The invitation couldn't be sent. Check the site's email settings, then send it again.",
    );
  }
  return { sent: true };
}

/**
 * Makes an account for the person, with a random password nobody knows, and sends them a link to choose their own.
 * Someone who already has an account is refused, rather than given a new link.
 */
export async function inviteEditor(
  siteAuth: SiteAuth,
  siteEnv: SiteEnv,
  request: Request,
  invitation: Invitation,
): Promise<Invited> {
  const admin = await adminAsking(siteAuth, request);
  const context = await siteAuth.$context;
  if (await context.internalAdapter.findUserByEmail(invitation.email)) {
    throw new EditorsError(409, `${invitation.email} already has an account.`);
  }
  const { user } = await siteAuth.api.createUser({
    headers: request.headers,
    body: {
      email: invitation.email,
      name: invitation.name,
      password: generateRandomString(48),
      role: invitation.role,
    },
  });
  const link = await invitationLink(siteAuth, siteEnv, user.id);
  const email = invitationEmail({
    to: invitation.email,
    name: invitation.name,
    invitedBy: admin.name,
    siteUrl: siteEnv.GOODFELLOW_SITE_URL ?? "",
    link,
    hours: INVITATION_HOURS,
  });
  return deliver(siteEnv, email, link);
}

/** Sends someone who hasn't joined yet a new link, for an invitation that ran out or went astray. */
export async function inviteAgain(
  siteAuth: SiteAuth,
  siteEnv: SiteEnv,
  request: Request,
  userId: string,
): Promise<Invited> {
  const admin = await adminAsking(siteAuth, request);
  const editor = await editorById(siteAuth, userId);
  if (editor.joined) throw new EditorsError(409, `${editor.email} has already joined.`);
  const link = await invitationLink(siteAuth, siteEnv, editor.id);
  const email = invitationEmail({
    to: editor.email,
    name: editor.name,
    invitedBy: admin.name,
    siteUrl: siteEnv.GOODFELLOW_SITE_URL ?? "",
    link,
    hours: INVITATION_HOURS,
  });
  return deliver(siteEnv, email, link);
}

/** Refuses a change that would leave the asking admin, or the site, without an admin. */
async function keepAnAdmin(siteAuth: SiteAuth, request: Request, userId: string): Promise<void> {
  const admin = await adminAsking(siteAuth, request);
  const target = await editorById(siteAuth, userId);
  if (target.email === admin.email) {
    throw new EditorsError(409, "You can't change or remove yourself. Ask another admin.");
  }
}

/** Makes someone an admin or an editor. */
export async function setRole(siteAuth: SiteAuth, request: Request, userId: string, role: unknown): Promise<void> {
  if (role !== "admin" && role !== "editor") throw new EditorsError(400, "Choose admin or editor.");
  await keepAnAdmin(siteAuth, request, userId);
  await siteAuth.api.setRole({ headers: request.headers, body: { userId, role } });
}

/** Removes someone's account, which also ends their sessions. */
export async function removeEditor(siteAuth: SiteAuth, request: Request, userId: string): Promise<void> {
  await keepAnAdmin(siteAuth, request, userId);
  await siteAuth.api.removeUser({ headers: request.headers, body: { userId } });
}

/** The API's answer for a problem: its words for a known one, and nothing about anything else. */
export function problemResponse(error: unknown): Response {
  const known = error instanceof EditorsError;
  return Response.json(
    { error: known ? error.message : "Something went wrong. Try again in a moment." },
    { status: known ? error.status : 500, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Accepts an invitation: sets the password the person chose with the invitation's link, which then stops working, as
 * do their other links (`onPasswordReset` in lib/auth.ts), and marks their address as theirs, since the link reached it. Answers the same for any link that doesn't work.
 */
export async function acceptInvitation(siteAuth: SiteAuth, request: Request, body: unknown): Promise<void> {
  if (!fromThisSite(request)) throw new EditorsError(403, "Accept the invitation from the site's own pages.");
  const given = (body ?? {}) as Record<string, unknown>;
  const token = typeof given.token === "string" ? given.token : "";
  const password = typeof given.password === "string" ? given.password : "";
  const expired = new EditorsError(
    400,
    "This link has already been used or has run out. Ask an admin to send it again.",
  );
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) throw expired;
  const context = await siteAuth.$context;
  const verification = await context.internalAdapter.findVerificationValue(`${RESET_IDENTIFIER}${token}`);
  if (!verification || verification.expiresAt < new Date()) throw expired;
  try {
    await siteAuth.api.resetPassword({ body: { token, newPassword: password } });
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 400 && password.length < context.password.config.minPasswordLength) {
      throw new EditorsError(
        400,
        `Choose a password of at least ${context.password.config.minPasswordLength} characters.`,
      );
    }
    if (status === 400) throw expired;
    throw error;
  }
  await context.internalAdapter.updateUser(verification.value, { emailVerified: true });
  // Again, now they're marked joined: a link made while the password was being set goes too (`invitationLink()`).
  await retireResetLinks(context.adapter, verification.value);
}
