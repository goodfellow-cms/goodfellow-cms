// Where the Newsletter signup block sends visitors' email addresses, with no React, so its web and native
// versions share it.
import { type FormProblem, type FormSettings, formTarget } from "@goodfellow-cms/core";

/** The newsletter services the block knows, and the site's own form service. */
export const NEWSLETTER_SERVICES = ["mailchimp", "buttondown", "kit", "forms"] as const;
export type NewsletterService = (typeof NEWSLETTER_SERVICES)[number];

export const NEWSLETTER_SERVICE_NAMES: Record<NewsletterService, string> = {
  mailchimp: "Mailchimp",
  buttondown: "Buttondown",
  kit: "Kit (ConvertKit)",
  forms: "The site's form service, from Site Settings",
};

export interface NewsletterProps {
  heading: string;
  text: string;
  service: NewsletterService;
  /** The service's form: its embed code, its address, or (Buttondown, Kit) a username or form number. */
  form: string;
  /** Whether to ask for a first name too. */
  askName: boolean;
  nameLabel: string;
  emailLabel: string;
  buttonLabel: string;
  /** Words under the form, such as how often the newsletter comes. */
  note: string;
  /** The page visitors see after signing up through the site's form service, such as `/thank-you`. */
  thankYou: string;
  /** What apps say once someone signs up through the site's form service, and when they couldn't. Stored blocks may predate them. */
  sentText?: string;
  failedText?: string;
  /** Whether the email box and button are side by side or one under the other. */
  layout: "row" | "stacked";
  align: "left" | "center";
  className: string;
}

/** A field the visitor doesn't see. */
export interface NewsletterHidden {
  name: string;
  value: string;
}

/** Where the form posts, and the names the service reads its fields by. */
export interface NewsletterTarget {
  service: NewsletterService;
  action: string;
  email: string;
  /** The first name's field, where the service takes one. */
  name?: string;
  hidden: NewsletterHidden[];
  /** A field hidden from people, which bots fill in, so the service throws their signups away. */
  honeypot?: { name: string; type: "text" | "checkbox" };
  /** Whether the site's form service shows Web3Forms' hCaptcha. */
  captcha: boolean;
}

/** Why the form can't sign anyone up yet. */
export type NewsletterProblem = "no-form" | "bad-form" | FormProblem;

/** The `action` of an embed code's form, or the text itself. */
function formAction(input: string): string {
  const action = /<form\b[^>]*?\saction\s*=\s*["']([^"']+)["']/i.exec(input)?.[1];
  return (action ?? input).trim().replace(/&amp;/g, "&");
}

function secureUrl(text: string): URL | undefined {
  try {
    const url = new URL(text);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function mailchimp(input: string): NewsletterTarget | undefined {
  const url = secureUrl(formAction(input));
  if (!url || !/^[a-z0-9-]+\.(us\d+\.)?list-manage\.com$/i.test(url.hostname)) return undefined;
  if (!/^\/subscribe\/post(-json)?\/?$/.test(url.pathname)) return undefined;
  const u = url.searchParams.get("u");
  const id = url.searchParams.get("id");
  if (!u || !id || !/^[0-9a-f]+$/i.test(u) || !/^[0-9a-f]+$/i.test(id)) return undefined;
  const query = new URLSearchParams({ u, id });
  const formId = url.searchParams.get("f_id");
  if (formId && /^[0-9a-f]+$/i.test(formId)) query.set("f_id", formId);
  return {
    service: "mailchimp",
    action: `https://${url.hostname.toLowerCase()}/subscribe/post?${query}`,
    email: "EMAIL",
    name: "FNAME",
    hidden: [],
    // Mailchimp's own honeypot, which its embed codes have.
    honeypot: { name: `b_${u}_${id}`, type: "text" },
    captcha: false,
  };
}

const BUTTONDOWN_NAME = /^[A-Za-z0-9_-]+$/;

function buttondown(input: string): NewsletterTarget | undefined {
  const text = formAction(input);
  let name: string | undefined;
  if (BUTTONDOWN_NAME.test(text)) name = text;
  else {
    const url = secureUrl(text);
    if (!url || !/^(www\.)?buttondown\.(com|email)$/i.test(url.hostname)) return undefined;
    name =
      /^\/api\/emails\/embed-subscribe\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] ??
      /^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  }
  if (!name) return undefined;
  return {
    service: "buttondown",
    action: `https://buttondown.com/api/emails/embed-subscribe/${name}`,
    email: "email",
    hidden: [{ name: "embed", value: "1" }],
    captcha: false,
  };
}

function kit(input: string): NewsletterTarget | undefined {
  const text = formAction(input);
  let id: string | undefined;
  if (/^\d+$/.test(text)) id = text;
  else {
    const url = secureUrl(text);
    if (!url || !/^(app\.kit\.com|app\.convertkit\.com|[a-z0-9-]+\.kit\.com)$/i.test(url.hostname)) return undefined;
    id = /^\/forms\/(\d+)(\/subscriptions)?\/?$/.exec(url.pathname)?.[1];
  }
  if (!id) return undefined;
  return {
    service: "kit",
    action: `https://app.kit.com/forms/${id}/subscriptions`,
    email: "email_address",
    name: "fields[first_name]",
    hidden: [],
    captcha: false,
  };
}

/**
 * Where the block posts, or why it can't. The newsletter services are read
 * from their embed codes or addresses, and only ever post to the service's
 * own address; the site's form service is the one in Site Settings.
 */
export function newsletterTarget(
  props: Pick<NewsletterProps, "service" | "form" | "heading">,
  forms: FormSettings | undefined,
  details: { from?: string; redirect?: string } = {},
): NewsletterTarget | { problem: NewsletterProblem } {
  const service = NEWSLETTER_SERVICES.includes(props.service) ? props.service : "mailchimp";
  if (service === "forms") {
    const target = formTarget(forms, { subject: props.heading?.trim() || "Newsletter signup", ...details });
    if ("problem" in target) return target;
    return {
      service,
      action: target.action,
      email: "email",
      name: "Name",
      hidden: target.hidden,
      honeypot: target.honeypot,
      captcha: target.captcha,
    };
  }
  const input = (props.form ?? "").trim();
  if (!input) return { problem: "no-form" };
  const target = service === "mailchimp" ? mailchimp(input) : service === "buttondown" ? buttondown(input) : kit(input);
  return target ?? { problem: "bad-form" };
}

/** What the editor says about a form that can't sign anyone up yet. */
export function newsletterProblem(service: NewsletterService, problem: NewsletterProblem): string {
  const where: Record<Exclude<NewsletterService, "forms">, string> = {
    mailchimp: "In Mailchimp, open Audience, then Signup forms, then Embedded forms, and copy the code there.",
    buttondown: "Paste your Buttondown username, or the embed code from Buttondown's Sharing settings.",
    kit: "In Kit, open the form, choose Publish, then HTML, and copy the code there.",
  };
  switch (problem) {
    case "no-form":
    case "bad-form": {
      const lead =
        problem === "no-form"
          ? "Paste the signup form so visitors can sign up."
          : `This isn't a ${NEWSLETTER_SERVICE_NAMES[service]} signup form.`;
      return service === "forms" ? lead : `${lead} ${where[service]}`;
    }
    case "no-key":
      return "Signups can't be sent yet: add Web3Forms' access key in Site Settings, under Forms.";
    case "bad-key":
      return "The Web3Forms access key in Site Settings isn't one. Copy it from the email Web3Forms sent.";
    case "no-address":
      return "Signups can't be sent yet: add the form's address in Site Settings, under Forms.";
    case "bad-address":
      return "The form address in Site Settings can't be used. Copy it from the form service: it starts with https://.";
  }
}
