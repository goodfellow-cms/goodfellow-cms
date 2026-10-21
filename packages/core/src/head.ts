import type { Page } from "./content/load.js";
import type { SiteSettings } from "./content/schemas.js";
import { trimChars } from "./trim.js";

/** Everything that goes in a page's `<head>`, worked out from the site settings and the page itself. */
export interface PageHead {
  title: string;
  description: string;
  language: string;
  /** Full URL of the page, if the site's address is set. */
  canonicalUrl?: string;
  favicon?: string;
  socialImage?: string;
  /**
   * Pages that shouldn't appear in search results: the 404 page, and pages
   * whose settings hide them (`noIndex`), which are left out of the sitemap too.
   */
  noIndex: boolean;
}

function readString(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Joins a site address and a page path: `("https://example.org/", "/about")` → `https://example.org/about`. */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${trimChars(siteUrl, "/", { start: false })}${path === "/" ? "/" : path}`;
}

export function getPageHead(settings: SiteSettings, page: Page): PageHead {
  const props = page.content.data.root.props;
  const ownTitle = readString(props, "title");
  // A page a block added says what it shows, such as a calendar's month.
  const pageTitle = page.view?.title ? [ownTitle || settings.title, page.view.title].join(": ") : ownTitle;
  const isHome = page.path === "/";

  return {
    title: pageTitle && !isHome ? settings.titleTemplate.replaceAll("%s", pageTitle) : pageTitle || settings.title,
    description: readString(props, "description") || settings.description,
    language: settings.language,
    canonicalUrl: settings.url ? absoluteUrl(settings.url, page.path) : undefined,
    favicon: settings.favicon,
    socialImage: readString(props, "image") || settings.socialImage,
    noIndex: page.path === "/404" || props?.noIndex === true,
  };
}
