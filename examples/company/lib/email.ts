// The one place the site sends email: invitations and password resets, through Upyo, which speaks to each email
// service's HTTP API, since Workers can't open SMTP connections. Which service is a setting (`EMAIL_PROVIDER`), so the
// site's owners can change it without its developers (README.md). Messages carry links that let someone into an
// account, so nothing here logs a message or puts one in an error.
import { createMessage, parseAddress, type Receipt, type Transport } from "@upyo/core";
import type { SiteEnv } from "./env.ts";

/** One message, as plain text and as HTML. */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Thrown where the site has no way to send email, so callers can say what to do instead. Nothing was sent, as with
 * `EmailRefused`.
 */
export class EmailNotSetUp extends Error {
  override name = "EmailNotSetUp";
}

/** The services `EMAIL_PROVIDER` can name, each through its HTTP API. */
export const EMAIL_PROVIDERS = ["resend", "mailgun", "sendgrid", "ses", "plunk"] as const;

export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];

/**
 * Thrown where the email service refused the message with a 4xx answer, every time it was tried, so it surely wasn't
 * sent. Its own errors (5xx) throw something else, as does a request that timed out or never reached it, since the
 * message may have gone: Resend, for one, says a 5xx can still have sent it.
 */
export class EmailRefused extends Error {
  override name = "EmailRefused";
}

/** How long a service has to answer, in milliseconds. */
const SEND_TIMEOUT = 10_000;

/**
 * How many times a message is sent before giving up: once more where the service was asked too often, which surely
 * didn't send it, and said to wait no longer than `MAX_RETRY_WAIT`. Done here rather than by the transport, whose
 * receipt keeps only the last try's error, so `refused()` sees every answer; never after an answer that may have sent
 * it, which would send it twice.
 */
const SEND_TRIES = 2;

/** The longest a service's `Retry-After` may ask the site to wait before the message is tried again, in milliseconds. */
const MAX_RETRY_WAIT = 2_000;

/** The service the settings name, or nothing for a name the site doesn't know. */
export function emailProvider(siteEnv: SiteEnv): EmailProvider | undefined {
  const named = siteEnv.EMAIL_PROVIDER?.trim().toLowerCase();
  return EMAIL_PROVIDERS.find((provider) => provider === named);
}

/** What's missing for the site to send email, or can't be used, by setting name: nothing where it can. */
export function missingEmailSettings(siteEnv: SiteEnv): string[] {
  const provider = emailProvider(siteEnv);
  const missing = [
    ...(provider ? [] : ["EMAIL_PROVIDER"]),
    // An address the message can't be sent from, such as one with no domain, would only fail once a message is.
    ...(siteEnv.EMAIL_FROM && parseAddress(siteEnv.EMAIL_FROM) ? [] : ["EMAIL_FROM"]),
    ...(siteEnv.EMAIL_API_KEY ? [] : ["EMAIL_API_KEY"]),
  ];
  // SES signs requests with a key pair, and needs to know which of its regions the site sends from.
  if (provider === "ses") {
    if (!siteEnv.EMAIL_KEY_ID) missing.push("EMAIL_KEY_ID");
    if (!siteEnv.EMAIL_REGION) missing.push("EMAIL_REGION");
  }
  return missing;
}

/** Whether the site can send email: a service it knows, its key, and an address to send from. */
export function canSendEmail(siteEnv: SiteEnv): boolean {
  return missingEmailSettings(siteEnv).length === 0;
}

/** Names as people read a list of them: `a`, `a and b`, `a, b, and c`. */
function inWords(names: string[]): string {
  if (names.length < 3) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/** The domain an address is at. */
function domainOf(address: string): string {
  return address.replace(/>\s*$/, "").split("@").pop()?.trim() ?? "";
}

/**
 * The service's transport, from the settings. Tracking is turned off where a message can say so (Mailgun and
 * SendGrid), since it would send every link in a message, each of which lets someone into an account, through the
 * service's own servers first; Resend, Plunk, and SES set it at the service, which the README says to check. Each
 * package is loaded only when it's the one named.
 */
async function transportFor(siteEnv: SiteEnv, provider: EmailProvider): Promise<Transport> {
  const apiKey = siteEnv.EMAIL_API_KEY ?? "";
  const common = {
    timeout: SEND_TIMEOUT,
    retries: 0,
    ...(siteEnv.EMAIL_API_URL && { baseUrl: siteEnv.EMAIL_API_URL }),
  };
  switch (provider) {
    case "resend": {
      const { ResendTransport } = await import("@upyo/resend");
      return new ResendTransport({ apiKey, ...common });
    }
    case "mailgun": {
      const { MailgunTransport } = await import("@upyo/mailgun");
      return new MailgunTransport({
        apiKey,
        // EMAIL_FROM is an address by now (missingEmailSettings()), so there's always a domain to fall back on.
        domain: siteEnv.EMAIL_DOMAIN?.trim() || domainOf(siteEnv.EMAIL_FROM ?? ""),
        region: siteEnv.EMAIL_REGION?.trim().toLowerCase() === "eu" ? "eu" : "us",
        tracking: false,
        clickTracking: false,
        openTracking: false,
        ...common,
      });
    }
    case "sendgrid": {
      const { SendGridTransport } = await import("@upyo/sendgrid");
      return new SendGridTransport({ apiKey, clickTracking: false, openTracking: false, ...common });
    }
    case "ses": {
      const { SesTransport } = await import("@upyo/ses");
      return new SesTransport({
        authentication: { type: "credentials", accessKeyId: siteEnv.EMAIL_KEY_ID ?? "", secretAccessKey: apiKey },
        region: siteEnv.EMAIL_REGION ?? "",
        ...common,
      });
    }
    case "plunk": {
      const { PlunkTransport } = await import("@upyo/plunk");
      return new PlunkTransport({ apiKey, ...common });
    }
  }
}

/** What went wrong, in words that say nothing of the message or the service's own answer. */
function failure(receipt: Extract<Receipt, { successful: false }>): string {
  const category = receipt.errors?.[0]?.category;
  return category ? `the service answered with an error (${category})` : "the service didn't say why";
}

/**
 * Whether the service answered every try with a 4xx status, so the message surely wasn't sent. A try that met a 5xx,
 * timed out or never reached the service may have sent it, and so may one whose error has no status.
 */
function refused(receipts: Extract<Receipt, { successful: false }>[]): boolean {
  return receipts.every((receipt) => {
    const errors = receipt.errors ?? [];
    return (
      errors.length > 0 &&
      errors.every((error) => error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500)
    );
  });
}

/**
 * How long to wait before trying again, where the service only said it was asked too often (429), so the message
 * surely wasn't sent, and said how long to wait, no longer than `MAX_RETRY_WAIT`: otherwise nothing, and it isn't tried
 * again, since a service asked again at once almost always answers the same.
 */
function retryWait(receipt: Extract<Receipt, { successful: false }>): number | undefined {
  const errors = receipt.errors ?? [];
  if (errors.length === 0 || !errors.every((error) => error.statusCode === 429)) return undefined;
  const waits = errors.map((error) => error.retryAfterMilliseconds);
  if (waits.some((wait) => wait === undefined || !(wait >= 0) || wait > MAX_RETRY_WAIT)) return undefined;
  return Math.max(...(waits as number[]));
}

/**
 * Sends a message from `EMAIL_FROM` through the service `EMAIL_PROVIDER` names, with `EMAIL_API_KEY`, which should be
 * a key that can only send, from the site's own domain. Throws `EmailNotSetUp` naming the settings that are missing,
 * `EmailRefused` where the message surely wasn't sent (the service refused it, or it couldn't be made), and an error
 * naming only the kind of failure otherwise.
 */
export async function sendEmail(siteEnv: SiteEnv, email: Email): Promise<void> {
  const missing = missingEmailSettings(siteEnv);
  const provider = emailProvider(siteEnv);
  if (missing.length > 0 || !provider) throw new EmailNotSetUp(`Set ${inWords(missing)} to send email.`);
  // Nothing has gone to the service yet, so a message that can't be made, such as for an address it can't read, or a
  // transport that can't be, surely wasn't sent.
  let message: ReturnType<typeof createMessage>;
  let sender: Transport;
  try {
    message = createMessage({
      from: siteEnv.EMAIL_FROM ?? "",
      to: email.to,
      subject: email.subject,
      content: { text: email.text, html: email.html },
    });
  } catch {
    throw new EmailRefused("The email wasn't sent: it couldn't be made, as for an address that can't be read.");
  }
  try {
    sender = await transportFor(siteEnv, provider);
  } catch {
    throw new EmailNotSetUp("Check the email settings: the service couldn't be set up from them.");
  }
  const failed: Extract<Receipt, { successful: false }>[] = [];
  for (let tries = 0; tries < SEND_TRIES; tries++) {
    const receipt = await sender.send(message);
    if (receipt.successful) return;
    failed.push(receipt);
    const wait = tries + 1 < SEND_TRIES ? retryWait(receipt) : undefined;
    if (wait === undefined) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const last = failed[failed.length - 1] as Extract<Receipt, { successful: false }>;
  const reason = `The email wasn't sent: ${failure(last)}.`;
  throw refused(failed) ? new EmailRefused(reason) : new Error(reason);
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
