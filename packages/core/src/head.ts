import { contentForPage, isLanguageHome, mainLanguage, pageAlternates } from "./content/languages.js";
import type { Page, SiteContent } from "./content/load.js";
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
  /**
   * The page in each of the site's languages it has a translation in, itself
   * included, with `x-default` for the main language's, for `hreflang` links:
   * only with the site's address, and only where it has translations
   * (`pageHead()`).
   */
  alternates?: Array<{ language: string; href: string }>;
}

function readString(props: Record<string, unknown> | undefined, key: string): string {
  const value = props?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Whether a page is left out of search engines whatever its settings say: "Page not found". */
export function neverIndexed(path: string): boolean {
  return path === "/404";
}

/** Joins a site address and a page path: `("https://example.org/", "/about")` → `https://example.org/about`. */
export function absoluteUrl(siteUrl: string, path: string): string {
  return `${trimChars(siteUrl, "/", { start: false })}${path === "/" ? "/" : path}`;
}

/**
 * Where search engines look for the site's `robots.txt`, if it isn't where
 * builds write it: the root of the Site address's domain, for a site in a
 * subfolder such as `https://name.github.io/site/`. Search engines read only
 * the domain's own, so they don't find the sitemap the site's own names.
 */
export function rootRobotsUrl(siteUrl: string | undefined): string | undefined {
  const match = siteUrl && /^(https?:\/\/[^/?#]+)(\/[^?#]*)?/i.exec(siteUrl.trim());
  if (!match) return undefined;
  const path = trimChars(match[2] ?? "", "/");
  return path ? `${match[1]}/robots.txt` : undefined;
}

export function getPageHead(settings: SiteSettings, page: Page): PageHead {
  const props = page.content.data.root.props;
  const ownTitle = readString(props, "title");
  // A page a block added says what it shows, such as a calendar's month.
  const pageTitle = page.view?.title ? [ownTitle || settings.title, page.view.title].join(": ") : ownTitle;
  // Each language's home page is a home page, so it's named after the site in that language.
  const isHome = isLanguageHome(settings, page.path);

  return {
    title: pageTitle && !isHome ? settings.titleTemplate.replaceAll("%s", pageTitle) : pageTitle || settings.title,
    description: readString(props, "description") || settings.description,
    language: settings.language,
    canonicalUrl: settings.url ? absoluteUrl(settings.url, page.path) : undefined,
    favicon: settings.favicon,
    socialImage: readString(props, "image") || settings.socialImage,
    noIndex: neverIndexed(page.path) || props?.noIndex === true,
  };
}

/**
 * A page's head as the site shows it: in the page's language (`contentForPage()`),
 * with its translations as `alternates`. Takes the site as loaded.
 */
export function pageHead(content: SiteContent, page: Page): PageHead {
  const head = getPageHead(contentForPage(content, page).settings, page);
  const { url } = content.settings;
  const translations = pageAlternates(content, page);
  if (!url || translations.size === 0 || head.noIndex) return head;
  const main = translations.get(mainLanguage(content.settings));
  const alternates = [...translations].map(([language, path]) => ({ language, href: absoluteUrl(url, path) }));
  return {
    ...head,
    alternates: main ? [...alternates, { language: "x-default", href: absoluteUrl(url, main) }] : alternates,
  };
}

/** One page in a sitemap: its full address and, where it has translations, theirs by language. */
export interface SitemapPage {
  url: string;
  alternates?: Record<string, string>;
}

/**
 * The pages a sitemap lists, once the site's address is set: every page but
 * "Page not found" and pages hidden from search engines, each with its
 * translations, as `hreflang` links list them. Takes the site as loaded.
 */
export function sitemapPages(content: SiteContent, pages: readonly Page[]): SitemapPage[] {
  const { url } = content.settings;
  if (!url) return [];
  return pages.flatMap((page) => {
    const head = pageHead(content, page);
    if (head.noIndex) return [];
    return [
      {
        url: absoluteUrl(url, page.path),
        ...(head.alternates && {
          alternates: Object.fromEntries(head.alternates.map(({ language, href }) => [language, href])),
        }),
      },
    ];
  });
}
