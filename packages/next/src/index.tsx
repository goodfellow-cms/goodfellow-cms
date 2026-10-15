import {
  absoluteUrl,
  demoContent,
  findRedirect,
  type GoodfellowConfig,
  getPageHead,
  googleFontsUrl,
  loadSiteContent,
  normalizePagePath,
  type Page,
  type SiteContent,
  sitePages,
  themeToCss,
  todayIn,
  withBase,
} from "@goodfellow-cms/core";
import { fileSystemSource, readMediaSizes } from "@goodfellow-cms/core/node";
import {
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
import { CurrentMenuLinks, NextImage, NextLink } from "./components.js";

export interface GoodfellowPagesOptions {
  /** The site's folder, holding `content/`. Defaults to the folder Next.js runs in. */
  root?: string;
  /**
   * The path the site is served from, such as `/my-site`. Defaults to the
   * `basePath` that `withGoodfellow()` gave Next.js.
   */
  basePath?: string;
}

/** Next.js's own link and image components, for blocks' `<SiteLink>` and `<SiteImage>`. */
const components: SiteComponents = { Link: NextLink, Image: NextImage };

/** Set by `withGoodfellow()` from Next.js's `basePath`. */
function configuredBasePath(): string {
  return process.env.GOODFELLOW_BASE_PATH ?? "";
}

/** The route parameters of an optional catch-all route named `[[...path]]`. */
export interface PageProps {
  params: Promise<{ path?: string[] }>;
}

/**
 * Reads the site's content from disk. Cached for the length of one request, so
 * a page and its metadata read it once, and content edits show on reload in development.
 */
export const loadSite = cache(
  (root: string = process.cwd()): Promise<SiteContent> => loadSiteContent(fileSystemSource(root)),
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

function toAbsolute(siteUrl: string | undefined, url: string | undefined): string | undefined {
  if (!url || !siteUrl || !url.startsWith("/") || url.startsWith("//")) return url;
  return absoluteUrl(siteUrl, url);
}

/** A page's title, description and link previews, as Next.js metadata. */
export function pageMetadata(content: SiteContent, page: Page, basePath = configuredBasePath()): Metadata {
  const head = getPageHead(content.settings, page);
  const socialImage = toAbsolute(content.settings.url, head.socialImage);
  return {
    ...(content.settings.url && { metadataBase: new URL(content.settings.url) }),
    title: { absolute: head.title },
    ...(head.description && { description: head.description }),
    ...(head.noIndex && { robots: { index: false } }),
    ...(head.canonicalUrl && { alternates: { canonical: head.canonicalUrl } }),
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

  const renderOptions = async () => ({ base: basePath(), components, media: await readMediaSizes(root) });

  /** The site's theme and fonts, which React moves into the document's head. themeToCss escapes its output. */
  function Theme({ content }: { content: SiteContent }) {
    const fontsUrl = googleFontsUrl(content.settings.theme);
    return (
      <>
        <style href="goodfellow-theme" precedence="default">
          {themeToCss(content.settings.theme)}
        </style>
        {fontsUrl && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            <link rel="stylesheet" href={fontsUrl} precedence="default" />
          </>
        )}
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
      const layout = await prepareLayout(configs, content, await renderOptions());
      return (
        <>
          <Theme content={content} />
          {/* React moves the head's links, meta tags and loading scripts into the head; inline scripts run here. */}
          <HeadCode code={content.code?.head} />
          <PageHeader site={layout.site} layoutConfig={layout.layoutConfig} data={layout.header} />
          {children}
          <PageFooter site={layout.site} layoutConfig={layout.layoutConfig} data={layout.footer} />
          <CurrentMenuLinks basePath={basePath()} />
          <BodyCode code={content.code?.body} />
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
      return <PageContent site={prepared.site} pageConfig={prepared.pageConfig} page={prepared.data} />;
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
          <title>{getPageHead(content.settings, page).title}</title>
          <Theme content={content} />
          <HeadCode code={content.code?.head} />
          <PageBody
            site={prepared.site}
            pageConfig={prepared.pageConfig}
            layoutConfig={prepared.layoutConfig}
            page={prepared.data}
            header={prepared.header}
            footer={prepared.footer}
          />
          <BodyCode code={content.code?.body} />
        </>
      );
    },

    /** For `app/sitemap.ts`: every page but "Page not found", once the site's address is set. */
    async sitemap(): Promise<MetadataRoute.Sitemap> {
      const content = await site();
      const url = content.settings.url;
      if (!url) return [];
      return exportedPages(content, config.blocks)
        .filter((page) => page.path !== "/404")
        .map((page) => ({ url: absoluteUrl(url, page.path) }));
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
      return Response.json(describeSite(config));
    },

    /** For `app/robots.ts`: lets search engines in, and points them at the sitemap once the site's address is set. */
    async robots(): Promise<MetadataRoute.Robots> {
      const url = (await site()).settings.url;
      return { rules: { userAgent: "*", allow: "/" }, ...(url && { sitemap: absoluteUrl(url, "/sitemap.xml") }) };
    },
  };
}
