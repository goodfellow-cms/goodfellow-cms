import {
  type AdminSite,
  absoluteUrl,
  adminSiteForCopy,
  BLOCK_SCRIPTS,
  builtSource,
  type CollectionSources,
  type ContentSource,
  checkSourceModules,
  collectionSources,
  colorSchemeMeta,
  colorSchemeScript,
  consentScript,
  contentForPage,
  customFontPreloads,
  DARK_MODE_ATTRIBUTE,
  demoContent,
  describedForCopy,
  expandSyncedBlocks,
  type FontStandIns,
  feedLinks,
  findRedirect,
  fontPreloads,
  type GoodfellowConfig,
  googleFontsUrl,
  type HostedFonts,
  hasLanguages,
  heldCode,
  heldStats,
  IMAGE_WIDTHS,
  type ImageSize,
  isMembersOnly,
  loadSiteContent,
  normalizePagePath,
  type Page,
  pageHead,
  robotsRules,
  type SiteContent,
  type SourceModuleImport,
  shownContent,
  siteCopyFrom,
  languageMap as siteLanguageMap,
  siteLanguages,
  sitemapPages,
  sitePages,
  storedMediaSizes,
  type Theme,
  TRAILING_SLASH_VARIABLE,
  teaserData,
  themeToCss,
  todayIn,
  withBase,
  withoutPaywall,
  withSelfHostedFonts,
  withSourcedCollections,
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
  StatsCode,
} from "@goodfellow-cms/react";
import type { Metadata, MetadataRoute } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { preload } from "react-dom";
import {
  ByLanguage,
  CurrentMenuLinks,
  GoatCounterNavigation,
  NextImage,
  NextLink,
  PageLanguage,
  SearchResultLinks,
} from "./components.js";
import type { BuiltFontStandIns } from "./font-stand-ins.js";
import { IMAGE_SIZES_ENV } from "./image-sizes-mark.js";

export interface GoodfellowPagesOptions {
  /** The site's folder, holding `content/`. Defaults to the folder Next.js runs in. */
  root?: string;
  /**
   * The path the site is served from, such as `/my-site`. Defaults to the
   * `basePath` that `withGoodfellow()` gave Next.js.
   */
  basePath?: string;
  /**
   * The name, in the site's `blocks`, of the block that ends a members-only
   * page's teaser, on a full-stack site whose server keeps pages to their
   * members (see the docs' Full-stack Next.js page). With it, `Page` shows
   * everyone a members-only page's teaser (`teaserData()`), and `MembersPage`
   * shows every page in full, for the route members are sent to; both leave
   * the block out of what's shown in full. Without it, every page is shown in
   * full, as a static export publishes it.
   */
  paywall?: string;
  /**
   * Where pages' content comes from as they render, in place of `root`'s
   * `content/` folder: a function giving a source of the site's files, such as
   * `repositorySource()`'s from `@goodfellow-cms/core`, which reads the
   * repository's newest revision. A full-stack site then shows a publish once
   * the pages it changed render again (`revalidatePath()`, from
   * `goodfellowApi({ onPublish })`), without a rebuild. Site settings are read
   * as builds read them (`builtSource()`). Where it gives nothing, as a site's
   * might in `next dev`, pages read `root`'s files. Static sites leave it out.
   */
  source?: () => ContentSource | undefined | Promise<ContentSource | undefined>;
  /**
   * The modules of the sources the config's `collections` name, by collection
   * id, imported by the site's own code, since Next.js bundles only what's
   * imported: `{ jobs: jobsSource }` with
   * `import jobsSource from "@/lib/jobs"`. Pages, feeds and the content API then
   * show the source's items as the collection's (`withSourcedCollections()`).
   * Throws where the config names a collection whose module is missing.
   */
  sources?: Record<string, SourceModuleImport>;
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

/**
 * The theme's font stand-ins: those `withGoodfellow()` worked out while the
 * site built, which it puts in the env, where they're for the theme's fonts, so
 * the server's code never includes Fontaine. `next dev` works them out as it
 * renders, since the theme changes as it's edited; that code is left out of
 * builds, where NODE_ENV is "production".
 */
async function themeStandIns(theme: Theme, root: string): Promise<FontStandIns> {
  const value = process.env.GOODFELLOW_FONT_STAND_INS;
  if (value) {
    try {
      const built = JSON.parse(value) as BuiltFontStandIns;
      if (built.heading === theme.fonts.heading && built.body === theme.fonts.body) return built.standIns;
    } catch {
      // Not what withGoodfellow() writes: none.
    }
  }
  if (process.env.NODE_ENV === "development") return fontStandIns(theme, { root });
  return { css: "" };
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
  async (
    root: string = process.cwd(),
    sources: CollectionSources = {},
    // Collections whose item files aren't read, since their sources' items replace them: the sources' by default.
    sourced: readonly string[] = Object.keys(sources),
  ): Promise<SiteContent> =>
    // How pages' full addresses end comes from `withGoodfellow()`, which Next.js passes in its `env`.
    shownContent(
      await withSourcedCollections(
        await loadSiteContent(
          builtSiteSource(root, { ...process.env, [TRAILING_SLASH_VARIABLE]: process.env.GOODFELLOW_TRAILING_SLASH }),
          { sourced },
        ),
        sources,
      ),
    ),
);

/** No collection sources: the same object each time, so `loadSite()`'s cache knows it. */
const NO_SOURCES: CollectionSources = {};

/** The site as `source` gives it, read as builds read it, once a request, as visitors see it now. */
const loadSourceSite = cache(
  async (
    source: () => ContentSource | undefined | Promise<ContentSource | undefined>,
    root: string | undefined,
    sources: CollectionSources,
  ): Promise<SiteContent> => {
    const files = await source();
    if (!files) return loadSite(root, sources);
    return shownContent(
      await withSourcedCollections(
        await loadSiteContent(
          builtSource(files, { ...process.env, [TRAILING_SLASH_VARIABLE]: process.env.GOODFELLOW_TRAILING_SLASH }),
          { sourced: Object.keys(sources) },
        ),
        sources,
      ),
    );
  },
);

function pathOf(segments: string[] | undefined): string {
  try {
    return normalizePagePath(`/${(segments ?? []).map((segment) => decodeURIComponent(segment)).join("/")}`);
  } catch {
    return "";
  }
}

/** Every page the site's export has: its pages, entries' pages, and the pages blocks add, such as a calendar's months. */
function exportedPages(content: SiteContent, blocks: GoodfellowConfig["blocks"]): Page[] {
  return sitePages(content, todayIn(content.settings.timeZone), blocks);
}

function findPage(content: SiteContent, blocks: GoodfellowConfig["blocks"], path: string): Page | undefined {
  return exportedPages(content, blocks).find((page) => page.path === path);
}

/** Who a page is shown to: the site's members, or everyone else. */
export type PageReader = "everyone" | "members";

/**
 * The page as `reader` sees it, where the site has a `paywall` block (see
 * `GoodfellowPagesOptions.paywall`): a members-only page's teaser for everyone
 * else (`teaserData()`), and otherwise the page without its paywall blocks.
 * Synced blocks go in first, since a paywall can be in one. Without a paywall,
 * the page as it is.
 */
export function shownPage(content: SiteContent, page: Page, reader: PageReader, paywall?: string): Page {
  if (!paywall) return page;
  const inLanguage = contentForPage(content, page);
  const data = expandSyncedBlocks(page.content.data, inLanguage, inLanguage.settings.language);
  const shown =
    reader === "everyone" && isMembersOnly(page, content.collections)
      ? teaserData(data, paywall)
      : withoutPaywall(data, paywall);
  return { ...page, content: { ...page.content, data: shown } };
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

/**
 * What the built-in blocks need in the browser (copying code, the Dark mode
 * switch, search), each a small script that works on what navigations add.
 * `goodfellow build` adds each only to pages that use it; a layout can't know
 * the page, so it has them all, but the Dark mode switch's only where the
 * site has dark mode, since it shows nothing otherwise.
 */
function BlockScripts({ content }: { content: SiteContent }) {
  const scripts = BLOCK_SCRIPTS.filter(
    ({ attribute }) => attribute !== DARK_MODE_ATTRIBUTE || content.settings.theme.darkMode,
  );
  return (
    <>
      {scripts.map(({ attribute, script }) => (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Goodfellow's own scripts, for its built-in blocks
        <script key={attribute} dangerouslySetInnerHTML={{ __html: script() }} />
      ))}
    </>
  );
}

function toAbsolute(siteUrl: string | undefined, url: string | undefined): string | undefined {
  if (!url || !siteUrl || !url.startsWith("/") || url.startsWith("//")) return url;
  return absoluteUrl(siteUrl, url);
}

/**
 * A page's title, description, search engine settings, and link previews, as
 * Next.js metadata, with the shared picture's size where `media` has it.
 */
export function pageMetadata(
  content: SiteContent,
  page: Page,
  basePath = configuredBasePath(),
  media: Readonly<Record<string, ImageSize>> = {},
): Metadata {
  const head = pageHead(content, page);
  const socialImage = toAbsolute(content.settings.url, head.socialImage);
  const socialSize = head.socialImage ? media[head.socialImage] : undefined;
  // The feeds in the page's language.
  const feeds = feedLinks(contentForPage(content, page));
  return {
    ...(content.settings.url && { metadataBase: new URL(content.settings.url) }),
    title: { absolute: head.title },
    ...(head.description && { description: head.description }),
    // As robotsContent() says them, for goodfellow build's pages.
    robots: {
      ...(head.noIndex && { index: false }),
      ...(head.noFollow && { follow: false }),
      ...(!head.noIndex && head.noSnippet && { nosnippet: true }),
      ...(!head.noIndex && { "max-image-preview": "large" as const }),
    },
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
      ...(head.type === "article"
        ? { type: "article", ...(head.publishedTime && { publishedTime: head.publishedTime }) }
        : { type: "website" }),
      siteName: head.siteName,
      locale: head.locale,
      title: head.title,
      ...(head.description && { description: head.description }),
      ...(head.canonicalUrl && { url: head.canonicalUrl }),
      // Link previews need a full address, which needs the site's address.
      ...(socialImage &&
        /^https?:\/\//.test(socialImage) && {
          images: [
            {
              url: socialImage,
              ...(socialSize && { width: socialSize.width, height: socialSize.height }),
              ...(head.socialImageAlt && { alt: head.socialImageAlt }),
            },
          ],
        }),
    },
    twitter: { card: head.card },
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
  const source = options.source;
  // Every collection's module must be there from the start, but the sources themselves are made only once the
  // site is read, where a failure (such as a missing setting a source checks for) fails that read, and the root
  // layout's `language()` can still open the admin panel.
  checkSourceModules(config.collections, options.sources ?? {});
  const sourcedIds = Object.keys(config.collections ?? {});
  let made: CollectionSources | undefined;
  const site = async () => {
    made ??= collectionSources(config.collections, options.sources ?? {});
    if (source) return loadSourceSite(source, options.root, made);
    // Without sources, the same arguments as the starter's root layout's `loadSite()`, so React's cache reads the site
    // once a request; with them, a root layout gives `<html lang>` from `language()`, which reads it as pages do.
    if (sourcedIds.length === 0) return options.root === undefined ? loadSite() : loadSite(options.root);
    return loadSite(options.root, made);
  };
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
      themeStandIns(content.settings.theme, root),
    ]);
    // The site's own fonts, from its own files.
    for (const file of customFontPreloads(content.settings.theme)) {
      preload(withBase(file, basePath()), { as: "font", type: "font/woff2", crossOrigin: "" });
    }
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
          {themeToCss(content.settings.theme, standIns, { base: basePath() })}
        </style>
        {fontsUrl && <link rel="stylesheet" href={fontsUrl} precedence="default" />}
      </>
    );
  }

  /** The page at the route's address, as `reader` sees it, inside `Layout`'s header and footer. */
  async function renderPage(segments: string[] | undefined, reader: PageReader) {
    const content = await site();
    const page = findPage(content, config.blocks, pathOf(segments));
    if (!page || page.path === "/404") {
      // In `next dev`. Exports have a page at each old address instead, which `goodfellow-next finish` writes.
      const moved = findRedirect(content, `/${(segments ?? []).join("/")}`);
      if (moved) redirect(moved.to);
      notFound();
    }
    const prepared = await preparePage(
      configs,
      content,
      shownPage(content, page, reader, options.paywall),
      await renderOptions(),
    );
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
  }

  return {
    /**
     * The site as these pages show it, for the root layout's `<html lang>`:
     * `loadSite()`, or from `source` where the site gives one.
     */
    loadSite: site,

    /**
     * For the root layout's `<html lang>`: the site's main language. The root
     * layout also wraps the admin panel and sign-in, which must open while
     * `source` can't be read (to fix its token, say), so then it's the
     * language of the files the site was built with; the pages themselves
     * still fail, rather than show content the site would keep as current.
     */
    async language(): Promise<string> {
      try {
        return (await site()).settings.language;
      } catch {
        // Without the collections' sources, which the language doesn't need, and which may be what failed, or the item
        // files their items replace.
        return (await loadSite(options.root, NO_SOURCES, sourcedIds)).settings.language;
      }
    },

    /** Every page's address, so Next.js builds them all. Any other address is "not found". */
    async generateStaticParams(): Promise<Array<{ path: string[] }>> {
      return exportedPages(await site(), config.blocks)
        .filter((page) => page.path !== "/404")
        .map((page) => ({ path: page.path === "/" ? [] : page.path.slice(1).split("/") }));
    },

    async generateMetadata({ params }: PageProps): Promise<Metadata> {
      const content = await site();
      const page = findPage(content, config.blocks, pathOf((await params).path));
      if (!page) return {};
      return pageMetadata(content, applyPageEntry(configs, content, page), basePath(), (await renderOptions()).media);
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
          {/* React moves the head's links, meta tags, and loading scripts into the head; inline scripts run here. */}
          <HeadCode
            code={content.code?.head}
            held={heldCode(content.settings.consent, "head")}
            siteUrl={content.settings.url}
          />
          {/* Visit counts, on every page but "Page not found", which is shown outside this layout. */}
          <StatsCode
            stats={content.settings.stats}
            held={heldStats(content.settings.consent, content.settings.stats)}
          />
          {header}
          {children}
          {footer}
          <CurrentMenuLinks basePath={basePath()} />
          {content.settings.stats?.service === "goatcounter" && process.env.NODE_ENV !== "development" && (
            <GoatCounterNavigation />
          )}
          <SearchResultLinks basePath={basePath()} />
          <BodyCode code={content.code?.body} held={heldCode(content.settings.consent, "body")} />
          <ConsentAsk content={content} />
          <BlockScripts content={content} />
        </>
      );
    },

    /**
     * The page at the route's address, inside `Layout`'s header and footer:
     * with a `paywall`, a members-only page's teaser.
     */
    async Page({ params }: PageProps) {
      return renderPage((await params).path, "everyone");
    },

    /**
     * The page at the route's address in full, as the site's members see it,
     * for the route a full-stack site's proxy rewrites their requests to. It
     * builds no page ahead: each renders the first time it's asked for. Only
     * the site's own code can say who's a member, so that route must answer
     * "Page not found" to anything the proxy didn't send it, such as a
     * visitor's request for its own address.
     */
    async MembersPage({ params }: PageProps) {
      return renderPage((await params).path, "members");
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
          <HeadCode
            code={content.code?.head}
            held={heldCode(content.settings.consent, "head")}
            siteUrl={content.settings.url}
          />
          <PageBody
            site={prepared.site}
            pageConfig={prepared.pageConfig}
            layoutConfig={prepared.layoutConfig}
            page={prepared.data}
            header={prepared.header}
            footer={prepared.footer}
          />
          <BodyCode code={content.code?.body} held={heldCode(content.settings.consent, "body")} />
          <ConsentAsk content={content} />
          <BlockScripts content={content} />
          <SearchResultLinks basePath={basePath()} />
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

    /**
     * For `app/robots.ts`: lets search engines in, asks AI training's crawlers to stay out where Site Settings
     * says so, and points them at the sitemap once the site's address is set (`robotsRules()`).
     */
    async robots(): Promise<MetadataRoute.Robots> {
      const { settings } = await site();
      return {
        rules: robotsRules(settings),
        ...(settings.url && { sitemap: absoluteUrl(settings.url, "/sitemap.xml") }),
      };
    },
  };
}
