import { describedIn } from "./content/credits.js";
import { dateField, entryDetails } from "./content/entry-details.js";
import { contentForPage, isLanguageHome, mainLanguage, pageAlternates } from "./content/languages.js";
import { findEntry, type Page, type SiteContent } from "./content/load.js";
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
  /** Whether search engines are asked not to follow the page's links (`noFollow`). */
  noFollow: boolean;
  /** Whether search engines are asked to show none of the page's text in results (`noSnippet`). */
  noSnippet: boolean;
  /**
   * How links to the page show its picture where they're shared: large, over
   * the title, or small beside it (`card`; large where the page has one).
   */
  card: "summary" | "summary_large_image";
  /** The site's name, for link previews. */
  siteName: string;
  /** The page's language as link previews name it, such as `en_US`. */
  locale: string;
  /** What the shared picture shows: its description from the media library, in the page's language. */
  socialImageAlt?: string;
  /** `article` for a dated item's page, as its structured data says, with when it was published. */
  type: "website" | "article";
  publishedTime?: string;
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

/**
 * A page's path as its full address ends it: with a `/` (`/about/`) unless
 * `trailingSlash` is `false`. The home page, files (a last part with a dot,
 * such as `/media/bulletin.pdf`) and paths already ending in one stay as they
 * are, and a `?…` or `#…` stays after it.
 */
export function pageAddressPath(path: string, trailingSlash = true): string {
  const end = path.search(/[?#]/);
  const bare = end === -1 ? path : path.slice(0, end);
  const rest = end === -1 ? "" : path.slice(end);
  if (!trailingSlash) return `${bare === "/" ? bare : bare.replace(/\/+$/, "")}${rest}`;
  const last = bare.slice(bare.lastIndexOf("/") + 1);
  return bare.endsWith("/") || last.includes(".") ? path : `${bare}/${rest}`;
}

/**
 * A page's full address, such as `https://example.org/about/`, as the host
 * serves it: with a `/` at the end unless `settings.trailingSlash` is `false`
 * (see `TRAILING_SLASH_VARIABLE`). For pages' paths only; files keep theirs.
 */
export function pageUrl(settings: Pick<SiteSettings, "trailingSlash">, siteUrl: string, path: string): string {
  return absoluteUrl(siteUrl, pageAddressPath(path, settings.trailingSlash !== false));
}

/** A language code as link previews name it: `en-US` → `en_US`. */
function previewLocale(language: string): string {
  return language.replace("-", "_");
}

/**
 * What the robots meta tag of a page says, or `undefined` for nothing: `noindex`
 * for a page hidden from search engines, and otherwise the page's own asks,
 * with `max-image-preview:large`, which lets search engines show its pictures
 * large, as Google suggests for every site. In the order Next.js writes them.
 */
export function robotsContent(head: Pick<PageHead, "noIndex" | "noFollow" | "noSnippet">): string {
  if (head.noIndex) return head.noFollow ? "noindex, nofollow" : "noindex";
  return [
    ...(head.noFollow ? ["nofollow"] : []),
    ...(head.noSnippet ? ["nosnippet"] : []),
    "max-image-preview:large",
  ].join(", ");
}

export function getPageHead(settings: SiteSettings, page: Page): PageHead {
  const props = page.content.data.root.props;
  const ownTitle = readString(props, "title");
  // A page a block added says what it shows, such as a calendar's month.
  const socialImage = readString(props, "image") || settings.socialImage;
  const card = props?.card;
  const pageTitle = page.view?.title ? [ownTitle || settings.title, page.view.title].join(": ") : ownTitle;
  // Each language's home page is a home page, so it's named after the site in that language.
  const isHome = isLanguageHome(settings, page.path);

  return {
    title: pageTitle && !isHome ? settings.titleTemplate.replaceAll("%s", pageTitle) : pageTitle || settings.title,
    description: readString(props, "description") || settings.description,
    language: settings.language,
    canonicalUrl: settings.url ? pageUrl(settings, settings.url, page.path) : undefined,
    favicon: settings.favicon,
    socialImage: socialImage || undefined,
    noIndex: settings.noIndex === true || neverIndexed(page.path) || props?.noIndex === true,
    noFollow: props?.noFollow === true,
    noSnippet: props?.noSnippet === true,
    card: card === "small" || (card !== "large" && !socialImage) ? "summary" : "summary_large_image",
    siteName: settings.title,
    locale: previewLocale(settings.language),
    type: "website",
  };
}

/**
 * A page's head as the site shows it: in the page's language (`contentForPage()`),
 * with its translations as `alternates`. Takes the site as loaded.
 */
export function pageHead(content: SiteContent, page: Page): PageHead {
  const shown = contentForPage(content, page);
  const own = getPageHead(shown.settings, page);
  const head = { ...own, ...previewDetails(shown, page, own) };
  const { url } = content.settings;
  const translations = pageAlternates(content, page);
  if (!url || translations.size === 0 || head.noIndex) return head;
  const main = translations.get(mainLanguage(content.settings));
  const settings = content.settings;
  const alternates = [...translations].map(([language, path]) => ({ language, href: pageUrl(settings, url, path) }));
  return {
    ...head,
    alternates: main ? [...alternates, { language: "x-default", href: pageUrl(settings, url, main) }] : alternates,
  };
}

/**
 * The crawlers that collect pages to train AI models, by the names they read
 * `robots.txt` for, which `noAiTraining` asks to leave the site alone. Search
 * engines' own crawlers (Googlebot, Bingbot, Applebot) and the ones that only
 * fetch a page when someone asks an assistant about it aren't among them, so
 * the site stays in search results and answers.
 */
export const AI_TRAINING_CRAWLERS = [
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "meta-externalagent",
  "Bytespider",
  "cohere-training-data-crawler",
] as const;

/** One group of `robots.txt`'s rules: the crawlers it's for, and what they may read. */
export interface RobotsRule {
  userAgent: string | string[];
  allow?: string;
  disallow?: string;
}

/** What `robots.txt` asks of crawlers: every crawler may read every page, but AI training crawlers none with `noAiTraining`. */
export function robotsRules(settings: Pick<SiteSettings, "noAiTraining">): RobotsRule[] {
  return [
    { userAgent: "*", allow: "/" },
    ...(settings.noAiTraining ? [{ userAgent: [...AI_TRAINING_CRAWLERS], disallow: "/" }] : []),
  ];
}

/** The site's `robots.txt`: its rules (`robotsRules()`), and where its sitemap is once the Site address is set. */
export function robotsTxt(settings: Pick<SiteSettings, "url" | "noAiTraining">): string {
  const groups = robotsRules(settings).map((rule) =>
    [
      ...(Array.isArray(rule.userAgent) ? rule.userAgent : [rule.userAgent]).map((agent) => `User-agent: ${agent}`),
      ...(rule.allow ? [`Allow: ${rule.allow}`] : []),
      ...(rule.disallow ? [`Disallow: ${rule.disallow}`] : []),
    ].join("\n"),
  );
  const sitemap = settings.url ? [`Sitemap: ${absoluteUrl(settings.url, "/sitemap.xml")}`] : [];
  return `${[...groups, ...sitemap].join("\n\n")}\n`;
}

/** What link previews say beyond the page's settings: its picture's description, and a dated item's date. */
function previewDetails(content: SiteContent, page: Page, head: PageHead): Partial<PageHead> {
  const description = head.socialImage ? content.descriptions?.[head.socialImage] : undefined;
  const alt = description && describedIn(description, content.settings.language);
  const found = page.entry && findEntry(content, page.entry.collection, page.entry.slug);
  const date =
    found && !found.collection.settings.calendar && dateField(found.collection)
      ? entryDetails(found.collection, found.entry).date
      : undefined;
  return { ...(alt && { socialImageAlt: alt }), ...(date && { type: "article" as const, publishedTime: date }) };
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
        url: pageUrl(content.settings, url, page.path),
        ...(head.alternates && {
          alternates: Object.fromEntries(head.alternates.map(({ language, href }) => [language, href])),
        }),
      },
    ];
  });
}
