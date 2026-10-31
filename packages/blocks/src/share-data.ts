// What the Share buttons and Donate blocks show, with no React, so their web and native versions share it.

import { pageUrl, type SiteSettings } from "@goodfellow-cms/core";

/** The places a page can be shared to. Each is only a link, so the page loads nothing from them. */
export const SHARE_SITES = ["facebook", "x", "bluesky", "linkedin", "whatsapp", "email"] as const;
export type ShareSite = (typeof SHARE_SITES)[number];

export const SHARE_SITE_NAMES: Record<ShareSite, string> = {
  facebook: "Facebook",
  x: "X",
  bluesky: "Bluesky",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  email: "Email",
};

export interface ShareButtonsProps {
  /** Words before the buttons, such as "Share this page". */
  label: string;
  sites: Array<{ site: ShareSite }>;
  look: "buttons" | "links";
  className: string;
}

/** The page's full address, as search engines are given it: the Site address and the page's path (`pageUrl()`). */
export function pageAddress(settings: Pick<SiteSettings, "url" | "trailingSlash">, path: string): string | undefined {
  return settings.url ? pageUrl(settings, settings.url, path) : undefined;
}

/** A link that shares `url`, with `title` where the site takes words too. */
export function shareLink(site: ShareSite, url: string, title: string): string {
  const text = title ? `${title} ${url}` : url;
  switch (site) {
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: url })}`;
    case "x":
      return `https://x.com/intent/post?${new URLSearchParams({ url, ...(title && { text: title }) })}`;
    case "bluesky":
      return `https://bsky.app/intent/compose?${new URLSearchParams({ text })}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?${new URLSearchParams({ url })}`;
    case "whatsapp":
      return `https://wa.me/?${new URLSearchParams({ text })}`;
    case "email":
      // Mail programs read `+` as itself, so spaces are written as %20.
      return `mailto:?subject=${encodeURIComponent(title || url)}&body=${encodeURIComponent(url)}`;
  }
}

/** The sites to show, in the editor's order, each once, leaving out any a stored page names that isn't one. */
export function shownSites(sites: ShareButtonsProps["sites"] | undefined): ShareSite[] {
  const known = new Set<string>(SHARE_SITES);
  return [...new Set((sites ?? []).map((entry) => entry?.site).filter((site): site is ShareSite => known.has(site)))];
}

export interface DonateProps {
  heading: string;
  text: string;
  /** The giving page: a Stripe payment link, a PayPal donate button's, or any other secure page. */
  url: string;
  buttonLabel: string;
  /** Says where people give, such as "You'll give on Stripe's secure page." */
  showNote: boolean;
  align: "left" | "center";
  className: string;
}

/** Giving services people know by name, by their addresses' hosts. */
const SERVICES: Array<[RegExp, string]> = [
  [/(^|\.)stripe\.com$/, "Stripe"],
  [/(^|\.)paypal\.(com|me)$/, "PayPal"],
  [/(^|\.)givebutter\.com$/, "Givebutter"],
  [/(^|\.)donorbox\.org$/, "Donorbox"],
  [/(^|\.)tithe\.ly$/, "Tithe.ly"],
  [/(^|\.)pushpay\.com$/, "Pushpay"],
  [/(^|\.)gofundme\.com$/, "GoFundMe"],
  [/(^|\.)justgiving\.com$/, "JustGiving"],
  [/(^|\.)square\.(link|site)$|(^|\.)squareup\.com$/, "Square"],
  [/(^|\.)venmo\.com$/, "Venmo"],
  [/(^|\.)liberapay\.com$/, "Liberapay"],
  [/(^|\.)ko-fi\.com$/, "Ko-fi"],
  [/(^|\.)buymeacoffee\.com$/, "Buy Me a Coffee"],
  [/(^|\.)opencollective\.com$/, "Open Collective"],
];

/** GitHub's own giving pages, which are on github.com beside everything else. */
const GITHUB_SPONSORS = /^\/sponsors\/[^/]+/;

/**
 * The giving page, if it's one a visitor can trust with their card: a secure
 * (`https://`) address, with the service's name where it's one people know.
 */
export function givingPage(url: string): { url: string; service?: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  const host = parsed.hostname.toLowerCase();
  const service =
    host === "github.com"
      ? GITHUB_SPONSORS.test(parsed.pathname)
        ? "GitHub Sponsors"
        : undefined
      : SERVICES.find(([pattern]) => pattern.test(host))?.[1];
  return { url: parsed.href, ...(service && { service }) };
}

/** What the note under the button says. */
export function givingNote(service: string | undefined): string {
  return service ? `You'll give on ${service}'s secure page.` : "You'll give on the giving service's secure page.";
}
