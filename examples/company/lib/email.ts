// The one place the site sends email: invitations and password resets, through Resend's HTTP API, since Workers can't
// open SMTP connections. Another service goes here and nowhere else. Messages carry links that let someone into an
// account, so nothing here logs a message or puts one in an error.
import type { SiteEnv } from "./env.ts";

/** One message, as plain text and as HTML. */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Thrown where the site has no way to send email, so callers can say what to do instead. */
export class EmailNotSetUp extends Error {
  override name = "EmailNotSetUp";
}

/**
 * Thrown where the email service answered that it didn't send the message, so it surely wasn't sent; a request that
 * timed out or never reached it throws something else, since the message may have gone.
 */
export class EmailRefused extends Error {
  override name = "EmailRefused";
}

/** How long Resend has to answer, in milliseconds. */
const SEND_TIMEOUT = 10_000;

/** Whether the site can send email: a Resend key, and an address to send from. */
export function canSendEmail(siteEnv: SiteEnv): boolean {
  return Boolean(siteEnv.RESEND_API_KEY && siteEnv.EMAIL_FROM);
}

/**
 * Sends a message from `EMAIL_FROM` with `RESEND_API_KEY`, which should be a key that can only send, from the site's
 * own domain. Throws `EmailNotSetUp` without them, and `EmailRefused`, naming only Resend's answer's status, where it
 * refuses.
 */
export async function sendEmail(siteEnv: SiteEnv, email: Email, fetcher: typeof fetch = fetch): Promise<void> {
  if (!canSendEmail(siteEnv)) {
    throw new EmailNotSetUp("Set RESEND_API_KEY and EMAIL_FROM to send email.");
  }
  const response = await fetcher(`${siteEnv.RESEND_API_URL ?? "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${siteEnv.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: siteEnv.EMAIL_FROM,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT),
  });
  if (!response.ok) throw new EmailRefused(`Resend didn't send the email: it answered ${response.status}.`);
}

/** Text as HTML shows it, with nothing in it read as markup. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The site's name in messages: its address's host, which nobody but its developers can change. */
function siteName(siteUrl: string): string {
  return new URL(siteUrl).host;
}

/** A message with one link to follow, as text and as HTML. */
function linkEmail(to: string, subject: string, lines: string[], label: string, link: string, after: string): Email {
  return {
    to,
    subject,
    text: `${lines.join("\n\n")}\n\n${link}\n\n${after}\n`,
    html: `<!doctype html><html><body>${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}<p><a href="${escapeHtml(link)}">${escapeHtml(label)}</a></p><p>${escapeHtml(after)}</p></body></html>`,
  };
}

/** The invitation an admin sends someone they've added, with the link that lets them choose a password. */
export function invitationEmail(options: {
  to: string;
  name: string;
  invitedBy: string;
  siteUrl: string;
  link: string;
  hours: number;
}): Email {
  const site = siteName(options.siteUrl);
  return linkEmail(
    options.to,
    `You're invited to edit ${site}`,
    [`Hello ${options.name},`, `${options.invitedBy} has invited you to edit ${site}. Choose a password to accept:`],
    "Choose a password",
    options.link,
    `The link works once, for ${options.hours} hours. If you weren't expecting this, you can ignore it.`,
  );
}

/** The message someone who forgot their password asks for. */
export function passwordResetEmail(options: {
  to: string;
  name: string;
  siteUrl: string;
  link: string;
  minutes: number;
}): Email {
  const site = siteName(options.siteUrl);
  return linkEmail(
    options.to,
    `Choose a new password for ${site}`,
    [`Hello ${options.name},`, `Someone asked to choose a new password for your account at ${site}. If it was you:`],
    "Choose a new password",
    options.link,
    `The link works once, for ${options.minutes} minutes. If it wasn't you, ignore this message: your password stays as it is.`,
  );
}
