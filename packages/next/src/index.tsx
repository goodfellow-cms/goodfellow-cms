import {
  type AdminSite,
  absoluteUrl,
  adminSiteForCopy,
  colorSchemeMeta,
  colorSchemeScript,
  consentScript,
  contentForPage,
  demoContent,
  describedForCopy,
  feedLinks,
  findRedirect,
  fontPreloads,
  type GoodfellowConfig,
  googleFontsUrl,
  type HostedFonts,
  hasLanguages,
  IMAGE_WIDTHS,
  loadSiteContent,
  normalizePagePath,
  type Page,
  pageHead,
  type SiteContent,
  shownContent,
  siteCopyFrom,
  languageMap as siteLanguageMap,
  siteLanguages,
  sitemapPages,
  sitePages,
  storedMediaSizes,
  themeToCss,
  todayIn,
  withBase,
  withSelfHostedFonts,
} from "@goodfellow-cms/core";
import {
  BUILD_DATES_ENV,
  builtSiteSource,
  fileSystemSource,
  fontStandIns,
  readMediaSizes,
  readStylesheet,
  reportDatesTo,
} from "@goodfellow-cms/core/node";
import {
  adminSite,
  applyPageEntry,
  BodyCode,
  createPuckConfigs,
  describeSite,
  HeadCode,
  PageBody,
  PageContent,
  PageFooter,
  PageHeader,
  prepareLayout,
  preparePage,
  type SiteComponents,
} from "@goodfellow-cms/react";
import type { Metadata, MetadataRoute } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { preload } from "react-dom";
import { ByLanguage, CurrentMenuLinks, NextImage, NextLink, PageLanguage } from "./components.js";
import { IMAGE_SIZES_ENV } from "./image-sizes-mark.js";

export interface GoodfellowPagesOptions {
  /** The site's folder, holding `content/`. Defaults to the folder Next.js runs in. */
  root?: string;
  /**
   * The path the site is served from, such as `/my-site`. Defaults to the
   * `basePath` that `withGoodfellow()` gave Next.js.
   */
  basePath?: string;
}

// In `next build`, which renders pages in several processes, each writes the dates what its pages show by today's
// date changes on, for the build record `goodfellow-next finish` writes (see `withGoodfellow()`).
const buildDates = process.env[BUILD_DATES_ENV];
if (buildDates) reportDatesTo(buildDates);

/** Next.js's own link and image components, for blocks' `<SiteLink>` and `<SiteImage>`. */
const components: SiteComponents = { Link: NextLink, Image: NextImage };

/** Set by `withGoodfellow()` from Next.js's `basePath`. */
function configuredBasePath(): string {
  return process.env.GOODFELLOW_BASE_PATH ?? "";
}

/**
 * Where a full-stack site's build copied its Google Fonts (`hostFonts()`), for
 * the stylesheet at `source`. `withGoodfellow()` puts them in the env, which
 * Next.js writes into this code by its name, so pages it renders later have
 * them too. Static exports have none: `goodfellow-next finish` copies theirs.
 */
function hostedFonts(source: string): HostedFonts | undefined {
  const value = process.env.GOODFELLOW_FONTS;
  if (!value) return undefined;
  try {
    const fonts = JSON.parse(value) as HostedFonts;
    return fonts.source === source ? fonts : undefined;
  } catch {
    return undefined;
  }
}

/** The route parameters of an optional catch-all route named `[[...path]]`. */
export interface PageProps {
  params: Promise<{ path?: string[] }>;
}

/**
 * Reads the site's content from disk, as visitors see it now: without pages
 * and items scheduled for later, or hidden again (`shownContent()`). Cached
 * for the length of one request, so a page and its metadata read it once, and
 * content edits show on reload in development.
 */
export const loadSite = cache(
  async (root: string = process.cwd()): Promise<SiteContent> =>
    shownContent(await loadSiteContent(builtSiteSource(root))),
);

function pathOf(segments: string[] | undefined): string {
  try {
    return normalizePagePath(`/${(segments ?? []).map((segment) => decodeURIComponent(segment)).join("/")}`);
  } catch {
    return "";
  }
}

/** Every page the site's export has: its pages, entries' pages and the pages blocks add, such as a calendar's months. */
function exportedPages(content: SiteContent, blocks: GoodfellowConfig["blocks"]): Page[] {
  return sitePages(content, todayIn(content.settings.timeZone), blocks);
}

function findPage(content: SiteContent, blocks: GoodfellowConfig["blocks"], path: string): Page | undefined {
  return exportedPages(content, blocks).find((page) => page.path === path);
}

/** Whether the site asks visitors before loading other sites' content. */
function asks(content: SiteContent): boolean {
  return content.settings.consent !== undefined;
}

/** The consent script, after the footer's notice, on a site that asks. */
function ConsentAsk({ content }: { content: SiteContent }) {
  if (!asks(content)) return null;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: Goodfellow's own script, which asks visitors before loading other sites' content
  return <script dangerouslySetInnerHTML={{ __html: consentScript() }} />;
}

function toAbsolute(siteUrl: string | undefined, url: string | undefined): string | undefined {
  if (!url || !siteUrl || !url.startsWith("/") || url.startsWith("//")) return url;
  return absoluteUrl(siteUrl, url);
}

/** A page's title, description and link previews, as Next.js metadata. */
export function pageMetadata(content: SiteContent, page: Page, basePath = configuredBasePath()): Metadata {
  const head = pageHead(content, page);
  const socialImage = toAbsolute(content.settings.url, head.socialImage);
  // The feeds in the page's language.
  const feeds = feedLinks(contentForPage(content, page));
  return {
    ...(content.settings.url && { metadataBase: new URL(content.settings.url) }),
    title: { absolute: head.title },
    ...(head.description && { description: head.description }),
    ...(head.noIndex && { robots: { index: false } }),
    ...((head.canonicalUrl || feeds.length > 0) && {
      alternates: {
        ...(head.canonicalUrl && { canonical: head.canonicalUrl }),
        // The page in the site's other languages.
        ...(head.alternates && {
          languages: Object.fromEntries(head.alternates.map(({ language, href }) => [language, href])),
        }),
        // The site's feeds, which feed readers find from any page.
        ...(feeds.length > 0 && {
          types: {
            "application/rss+xml": feeds.map((feed) => ({ url: withBase(feed.href, basePath), title: feed.title })),
          },
        }),
      },
    }),
    ...(head.favicon && { icons: { icon: withBase(head.favicon, basePath) } }),
    openGraph: {
      type: "website",
      title: head.title,
      ...(head.description && { description: head.description }),
      ...(head.canonicalUrl && { url: head.canonicalUrl }),
      // Link previews need a full address, which needs the site's address.
      ...(socialImage && /^https?:\/\//.test(socialImage) && { images: [socialImage] }),
    },
  };
}

/**
 * Renders the site's pages in a Next.js App Router site, as Server Components.
 * Blocks' links to the site's pages use `next/link`, and their images
 * `next/image`, through `<SiteLink>` and `<SiteImage>`; Client Components in
 * blocks run in the browser. Use the results in `app/(site)/layout.tsx`,
 * which shows the header and footer once for every page, in
 * `app/(site)/[[...path]]/page.tsx`, and in `app/not-found.tsx`.
 */
export function goodfellowPages(config: GoodfellowConfig, options: GoodfellowPagesOptions = {}) {
  const configs = createPuckConfigs(config);
  const root = options.root ?? process.cwd();
  // The same arguments as the layout's `loadSite()`, so a request reads the site once.
  const site = () => loadSite(options.root);
  const basePath = () => options.basePath ?? configuredBasePath();

  // Stored media's sizes are by its public address, which the site shows it from.
  const renderOptions = async () => ({
    base: basePath(),
    components,
    media: { ...(await readMediaSizes(root)), ...storedMediaSizes((await site()).mediaStorage) },
    // Where `goodfellow-next finish` writes smaller copies of the media library's photos, pages list them.
    ...(process.env[IMAGE_SIZES_ENV] && { imageWidths: IMAGE_WIDTHS }),
  });

  /** The site's theme and fonts, which React moves into the document's head. themeToCss escapes its output. */
  async function Theme({ content }: { content: SiteContent }) {
    const googleUrl = googleFontsUrl(content.settings.theme);
    const hosted = googleUrl ? hostedFonts(googleUrl) : undefined;
    const fontsUrl = googleUrl && hosted ? withSelfHostedFonts(googleUrl, hosted, basePath()) : googleUrl;
    // React adds these to the head once each, where a <link> would also be kept as it is.
    const [fontFiles, standIns] = await Promise.all([
      fontPreloads(content.settings.theme, readStylesheet),
      fontStandIns(content.settings.theme),
    ]);
    for (const file of fontFiles) {
      const href = hosted ? withSelfHostedFonts(file, hosted, basePath()) : file;
      // With the site's copies, a file Google has added since the build isn't one of them, and isn't asked for.
      if (hosted && href === file) continue;
      preload(href, { as: "font", type: "font/woff2", crossOrigin: "" });
    }
    const colorScheme = colorSchemeMeta(content.settings.theme);
    const schemeScript = colorSchemeScript(content.settings.theme);
    return (
      <>
        {colorScheme && <meta name="color-scheme" content={colorScheme} />}
        {/* Before the header, so the visitor's light or dark choice is back before anything shows. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Goodfellow's own script, which puts back the visitor's light or dark choice */}
        {schemeScript && <script dangerouslySetInnerHTML={{ __html: schemeScript }} />}
        <style href="goodfellow-theme" precedence="default">
          {themeToCss(content.settings.theme, standIns)}
        </style>
        {fontsUrl && <link rel="stylesheet" href={fontsUrl} precedence="default" />}
      </>
    );
  }

  return {
    /** Every page's address, so Next.js builds them all. Any other address is "not found". */
    async generateStaticParams(): Promise<Array<{ path: string[] }>> {
      return exportedPages(await site(), config.blocks)
        .filter((page) => page.path !== "/404")
        .map((page) => ({ path: page.path === "/" ? [] : page.path.slice(1).split("/") }));
    },

    async generateMetadata({ params }: PageProps): Promise<Metadata> {
      const content = await site();
      const page = findPage(content, config.blocks, pathOf((await params).path));
      return page ? pageMetadata(content, applyPageEntry(configs, content, page), basePath()) : {};
    },

    /**
     * For `app/admin/page.tsx`: what the admin panel's page knows about the
     * site, which never loads its config. The site's blocks run in the
     * editor's frames, at `app/admin/editor/page.tsx`.
     */
    admin(): AdminSite {
      return adminSiteForCopy(adminSite(config), siteCopyFrom(process.env));
    },

    /** For `app/admin/layout.tsx`: the admin panel's title, kept out of search engines, with the site's icon. */
    async adminMetadata(): Promise<Metadata> {
      // Content with a problem still opens the admin panel, which explains it.
      const favicon = await site().then(
        (content) => content.settings.favicon,
        () => undefined,
      );
      return {
        title: "Site admin",
        robots: { index: false },
        ...(favicon && { icons: { icon: withBase(favicon, basePath()) } }),
      };
    },

    /**
     * For `app/(site)/layout.tsx`: the site's header and footer around every page, kept as
     * they are when moving between pages. Menus mark the current page in the browser.
     */
    async Layout({ children }: { children: ReactNode }) {
      const content = await site();
      const options = await renderOptions();
      let header: ReactNode;
      let footer: ReactNode;
      if (hasLanguages(content.settings)) {
        // A header and footer for each language, which the browser picks from by the page's address, with where each
        // page's translations are, for the Language switch.
        const languageMap = siteLanguageMap(content, exportedPages(content, config.blocks));
        const layouts = await Promise.all(
          siteLanguages(content.settings).map(async (language) => ({
            prefix: language.prefix,
            layout: await prepareLayout(configs, content, { ...options, languageMap }, language.code),
          })),
        );
        header = (
          <ByLanguage
            variants={layouts.map(({ prefix, layout }) => ({
              prefix,
              children: <PageHeader site={layout.site} layoutConfig={layout.layoutConfig} data={layout.header} />,
            }))}
          />
        );
        footer = (
          <ByLanguage
            variants={layouts.map(({ prefix, layout }) => ({
              prefix,
              children: <PageFooter site={layout.site} layoutConfig={layout.layoutConfig} data={layout.footer} />,
            }))}
          />
        );
      } else {
        const layout = await prepareLayout(configs, content, options);
        header = <PageHeader site={layout.site} layoutConfig={layout.layoutConfig} data={layout.header} />;
        footer = <PageFooter site={layout.site} layoutConfig={layout.layoutConfig} data={layout.footer} />;
      }
      return (
        <>
          <Theme content={content} />
          {/* React moves the head's links, meta tags and loading scripts into the head; inline scripts run here. */}
          <HeadCode code={content.code?.head} held={asks(content)} />
          {header}
          {children}
          {footer}
          <CurrentMenuLinks basePath={basePath()} />
          <BodyCode code={content.code?.body} held={asks(content)} />
          <ConsentAsk content={content} />
        </>
      );
    },

    /** The page at the route's address, inside `Layout`'s header and footer. */
    async Page({ params }: PageProps) {
      const content = await site();
      const segments = (await params).path;
      const page = findPage(content, config.blocks, pathOf(segments));
      if (!page || page.path === "/404") {
        // In `next dev`. Exports have a page at each old address instead, which `goodfellow-next finish` writes.
        const moved = findRedirect(content, `/${(segments ?? []).join("/")}`);
        if (moved) redirect(moved.to);
        notFound();
      }
      const prepared = await preparePage(configs, content, page, await renderOptions());
      const pageContent = (
        <PageContent
          site={prepared.site}
          pageConfig={prepared.pageConfig}
          page={prepared.data}
          {...(prepared.structuredData && { structuredData: prepared.structuredData })}
        />
      );
      if (!hasLanguages(content.settings)) return pageContent;
      return (
        <>
          <PageLanguage language={prepared.site.settings.language} />
          {pageContent}
        </>
      );
    },

    /**
     * The site's "Page not found" page (`content/pages/404.json`), for `app/not-found.tsx`,
     * with the header and footer, since Next.js shows it outside the `(site)` layout.
     */
    async NotFound() {
      const content = await site();
      const page = findPage(content, config.blocks, "/404");
      if (!page) return <h1>Page not found</h1>;
      const prepared = await preparePage(configs, content, page, await renderOptions());
      return (
        <>
          {/* Next.js doesn't take metadata from not-found pages; React moves this into the head. */}
          <title>{pageHead(content, page).title}</title>
          <Theme content={content} />
          <HeadCode code={content.code?.head} held={asks(content)} />
          <PageBody
            site={prepared.site}
            pageConfig={prepared.pageConfig}
            layoutConfig={prepared.layoutConfig}
            page={prepared.data}
            header={prepared.header}
            footer={prepared.footer}
          />
          <BodyCode code={content.code?.body} held={asks(content)} />
          <ConsentAsk content={content} />
        </>
      );
    },

    /** For `app/sitemap.ts`: every page but "Page not found" and pages hidden from search engines, once the site's address is set. */
    async sitemap(): Promise<MetadataRoute.Sitemap> {
      const content = await site();
      return sitemapPages(content, exportedPages(content, config.blocks)).map(({ url, alternates }) => ({
        url,
        ...(alternates && { alternates: { languages: alternates } }),
      }));
    },

    /**
     * For `app/admin/demo-content.json/route.ts`: in a demo (the config's `demo`), the copy of
     * the site's content its admin panel starts from. A static export can't leave a route out,
     * so other sites get an empty file.
     */
    async demoContent(): Promise<Response> {
      if (!config.demo) return new Response(null, { status: 404 });
      return new Response(await demoContent(fileSystemSource(root)), {
        headers: { "content-type": "application/json" },
      });
    },

    /**
     * For `app/goodfellow-site.json/route.ts`: what the site says about its blocks, for tools that
     * edit its content without its code, such as the Claude connector.
     */
    siteDescription(): Response {
      return Response.json(describedForCopy(describeSite(config), siteCopyFrom(process.env)));
    },

    /** For `app/robots.ts`: lets search engines in, and points them at the sitemap once the site's address is set. */
    async robots(): Promise<MetadataRoute.Robots> {
      const url = (await site()).settings.url;
      return { rules: { userAgent: "*", allow: "/" }, ...(url && { sitemap: absoluteUrl(url, "/sitemap.xml") }) };
    },
  };
}
