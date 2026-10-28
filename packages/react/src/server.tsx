import {
  absoluteUrl,
  colorSchemeMeta,
  colorSchemeScript,
  contentForPage,
  feedLinks,
  fontPreloads,
  type GoodfellowConfig,
  googleFontsUrl,
  type Page,
  pageHead,
  type SiteContent,
  themeToCss,
} from "@goodfellow-cms/core";
import { fontStandIns, readStylesheet } from "@goodfellow-cms/core/node";
import { prerender } from "react-dom/static";
import { BodyCode, HeadCode } from "./custom-code.js";
import { fillSlots } from "./island.js";
import { ISLAND_TAG, SITE_DATA_ID } from "./island-shared.js";
import { PageBody } from "./page-body.js";
import { createPuckConfigs, preparePage } from "./prepare.js";

export interface PageAssets {
  /** Stylesheet URLs, in order. */
  stylesheets?: string[];
  /** Module script URLs, in order. */
  scripts?: string[];
  /** What pages with Client Components load to run them in the browser. Pages without any load nothing. */
  islands?: IslandAssets;
}

export interface IslandAssets {
  /** The module script that finds the page's islands and runs them. */
  script: string;
  /** Modules the script imports, to fetch at the same time. */
  preload?: string[];
  /** The path the site is served from, for `useSite().base` in the browser, when the HTML is rewritten afterwards. */
  base?: string;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** The site data and scripts a page with islands needs, for the end of its body. */
function islandScripts(site: object, islands: IslandAssets): string {
  // JSON with "<" escaped can't close the script element.
  const data = JSON.stringify({ ...site, ...(islands.base && { base: islands.base }) }).replace(/</g, "\\u003c");
  return [
    `<script type="application/json" id="${SITE_DATA_ID}">${data}</script>`,
    ...(islands.preload ?? []).map((href) => `<link rel="modulepreload" href="${escapeAttribute(href)}"/>`),
    `<script type="module" src="${escapeAttribute(islands.script)}"></script>`,
  ].join("");
}

function toAbsolute(siteUrl: string | undefined, url: string | undefined): string | undefined {
  if (!url || !siteUrl || !url.startsWith("/") || url.startsWith("//")) return url;
  return absoluteUrl(siteUrl, url);
}

/**
 * Creates a function that renders pages of a site to complete HTML documents.
 * Rendering waits for everything (including lazily loaded rich text), so the
 * output is final static HTML. Only pages whose blocks use Client Components
 * load JavaScript, given `assets.islands`, to run those components.
 */
export function createPageRenderer(config: GoodfellowConfig) {
  const configs = createPuckConfigs(config);

  return async function renderPage(content: SiteContent, page: Page, assets: PageAssets = {}): Promise<string> {
    const prepared = await preparePage(configs, content, page);
    page = prepared.page;
    // The site in the page's language: its title, menus and feeds.
    const shown = contentForPage(content, page);
    const { settings } = shown;

    const head = pageHead(content, page);
    const fontsUrl = googleFontsUrl(settings.theme);
    const [fontFiles, standIns] = await Promise.all([
      fontPreloads(settings.theme, readStylesheet),
      fontStandIns(settings.theme),
    ]);
    const colorScheme = colorSchemeMeta(settings.theme);
    const schemeScript = colorSchemeScript(settings.theme);
    const socialImage = toAbsolute(settings.url, head.socialImage);

    const document = (
      <html lang={head.language}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          {colorScheme && <meta name="color-scheme" content={colorScheme} />}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Goodfellow's own script, which puts back the visitor's light or dark choice */}
          {schemeScript && <script dangerouslySetInnerHTML={{ __html: schemeScript }} />}
          <title>{head.title}</title>
          {head.description && <meta name="description" content={head.description} />}
          {head.noIndex && <meta name="robots" content="noindex" />}
          {head.canonicalUrl && <link rel="canonical" href={head.canonicalUrl} />}
          {head.alternates?.map((alternate) => (
            <link key={alternate.language} rel="alternate" hrefLang={alternate.language} href={alternate.href} />
          ))}
          {head.favicon && <link rel="icon" href={head.favicon} />}
          <meta property="og:type" content="website" />
          <meta property="og:title" content={head.title} />
          {head.description && <meta property="og:description" content={head.description} />}
          {head.canonicalUrl && <meta property="og:url" content={head.canonicalUrl} />}
          {socialImage && <meta property="og:image" content={socialImage} />}
          {feedLinks(shown).map((feed) => (
            <link key={feed.href} rel="alternate" type="application/rss+xml" title={feed.title} href={feed.href} />
          ))}
          {fontsUrl && (
            <>
              {fontFiles.map((href) => (
                <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="" />
              ))}
              <link rel="stylesheet" href={fontsUrl} />
            </>
          )}
          {assets.stylesheets?.map((href) => (
            <link key={href} rel="stylesheet" href={href} />
          ))}
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: themeToCss escapes its output */}
          <style dangerouslySetInnerHTML={{ __html: themeToCss(settings.theme, standIns) }} />
          <HeadCode code={content.code?.head} />
        </head>
        <body>
          <PageBody
            site={prepared.site}
            pageConfig={prepared.pageConfig}
            layoutConfig={prepared.layoutConfig}
            page={prepared.data}
            header={prepared.header}
            footer={prepared.footer}
            {...(prepared.structuredData && { structuredData: prepared.structuredData })}
          />
          <BodyCode code={content.code?.body} />
          {assets.scripts?.map((src) => (
            <script key={src} type="module" src={src} />
          ))}
        </body>
      </html>
    );

    const { prelude } = await prerender(document);
    // React writes the doctype itself when the root element is <html>.
    let html = fillSlots(await new Response(prelude).text());
    if (assets.islands && html.includes(`<${ISLAND_TAG} `)) {
      const end = html.lastIndexOf("</body>");
      html = `${html.slice(0, end)}${islandScripts(prepared.site, assets.islands)}${html.slice(end)}`;
    }
    return html;
  };
}

export type PageRenderer = ReturnType<typeof createPageRenderer>;

export { contentApi, prepareContentApi } from "./content-api.js";
