/**
 * Forms without a server: where a form posts its answers, the hidden fields
 * each form service reads, and Google Forms' embedded forms.
 */
import type { SiteSettings } from "./content/schemas.js";
import { absoluteUrl, pageAddressPath } from "./head.js";
import { embedSource } from "./video.js";

export type FormService = NonNullable<SiteSettings["forms"]>["service"];

export type FormSettings = NonNullable<SiteSettings["forms"]>;

/** Why a form can't send its answers yet, in plain words. */
export type FormProblem = "no-key" | "bad-key" | "no-address" | "bad-address";

/** A field the visitor doesn't see, such as Web3Forms' access key. */
export interface HiddenField {
  name: string;
  value: string;
}

/** Where a form posts, and what it sends besides the visitor's answers. */
export interface FormTarget {
  service: FormService;
  action: string;
  hidden: HiddenField[];
  /**
   * The honeypot: a field hidden from people, which bots fill in. Services
   * throw away answers that have it filled in.
   */
  honeypot: { name: string; type: "checkbox" | "text" };
  /** Whether to show Web3Forms' hCaptcha, which needs Web3Forms' script on the page. */
  captcha: boolean;
  /** Whether the form tells the service where to send visitors. Formspree's paid plans set it in Formspree instead. */
  redirects: boolean;
}

/** What a form says about itself. */
export interface FormDetails {
  /** The subject of the emails its answers arrive in. */
  subject?: string;
  /** Who the emails are from, such as the site's title. */
  from?: string;
  /** The full address of the page visitors see after sending, if the form has one. */
  redirect?: string;
}

/** Web3Forms' script, which shows its hCaptcha and stops forms being sent without it. */
export const WEB3FORMS_SCRIPT = "https://web3forms.com/client/script.js";

const WEB3FORMS_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMSPREE_ID = /^[A-Za-z0-9]{6,}$/;

/** Formspree's address for a form, from its address or its ID. */
export function formspreeAddress(input: string): string | undefined {
  const text = input.trim();
  if (FORMSPREE_ID.test(text)) return `https://formspree.io/f/${text}`;
  try {
    const url = new URL(text);
    const id = /^\/f\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1];
    return url.protocol === "https:" && url.hostname === "formspree.io" && id
      ? `https://formspree.io/f/${id}`
      : undefined;
  } catch {
    return undefined;
  }
}

/** Another service's address, which must be secure, as browsers warn about sending answers otherwise. */
function serviceAddress(input: string): string | undefined {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Where a site's forms post, and the hidden fields the chosen service reads,
 * or why they can't send answers yet. Web3Forms is the default.
 */
export function formTarget(
  settings: FormSettings | undefined,
  details: FormDetails = {},
): FormTarget | { problem: FormProblem } {
  const service = settings?.service ?? "web3forms";
  const fields = (entries: Array<[string, string | undefined]>): HiddenField[] =>
    entries.flatMap(([name, value]) => (value ? [{ name, value }] : []));

  if (service === "web3forms") {
    const key = settings?.accessKey?.trim();
    if (!key) return { problem: "no-key" };
    if (!WEB3FORMS_KEY.test(key)) return { problem: "bad-key" };
    return {
      service,
      action: "https://api.web3forms.com/submit",
      hidden: fields([
        ["access_key", key],
        ["subject", details.subject],
        ["from_name", details.from],
        ["redirect", details.redirect],
      ]),
      honeypot: { name: "botcheck", type: "checkbox" },
      captcha: settings?.captcha === true,
      redirects: true,
    };
  }

  const input = settings?.address?.trim();
  if (!input) return { problem: "no-address" };
  const action = service === "formspree" ? formspreeAddress(input) : serviceAddress(input);
  if (!action) return { problem: "bad-address" };
  // Formspree's names, which other services such as FormSubmit and Formcarry read too. Formspree's own
  // redirect is set in its form's settings, on its paid plans only.
  const redirects = service !== "formspree";
  return {
    service,
    action,
    hidden: fields([
      ["_subject", details.subject],
      ["_next", redirects ? details.redirect : undefined],
    ]),
    honeypot: { name: "_gotcha", type: "text" },
    captcha: false,
    redirects,
  };
}

/**
 * The full address of a page of the site, for a service to send visitors back
 * to, if the site's address is set, ending as the site's pages' addresses do
 * (`trailingSlash`, see `pageUrl()`).
 */
export function formRedirect(siteUrl: string | undefined, path: string, trailingSlash = true): string | undefined {
  const page = path.trim();
  if (!page) return undefined;
  if (/^https:\/\//i.test(page)) return page;
  if (!siteUrl || !page.startsWith("/")) return undefined;
  return absoluteUrl(siteUrl, pageAddressPath(page, trailingSlash));
}

/** Why a Google form can't be shown, in plain words. */
export type GoogleFormProblem = "short-link" | "not-a-form";

/**
 * A Google form's embedded address, from its embed code, its address for
 * people filling it in, or the editor's own address. `forms.gle` links can't
 * be followed from the browser, so the embed code is needed instead.
 */
export function googleFormUrl(input: string): { url: string; height?: number } | { problem: GoogleFormProblem } {
  const text = input.trim();
  const height = Number(/<iframe\b[^>]*?\sheight\s*=\s*["']?(\d+)/i.exec(text)?.[1]) || undefined;
  let url: URL;
  try {
    url = new URL(embedSource(text));
  } catch {
    return { problem: "not-a-form" };
  }
  const host = url.hostname.toLowerCase();
  if (host === "forms.gle") return { problem: "short-link" };
  if (url.protocol !== "https:" || host !== "docs.google.com") return { problem: "not-a-form" };
  // /forms/d/e/<id>/viewform is the published form; /forms/d/<id>/edit is the editor's, which also shows it.
  const match = /^\/forms(\/u\/\d+)?\/d\/(e\/)?([A-Za-z0-9_-]{10,})(?:\/|$)/.exec(url.pathname);
  if (!match) return { problem: "not-a-form" };
  const id = match[3];
  const address = `https://docs.google.com/forms/d/${match[2] ?? ""}${id}/viewform?embedded=true`;
  return { url: address, ...(height && { height }) };
}
