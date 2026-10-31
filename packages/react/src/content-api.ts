import {
  type GoodfellowConfig,
  normalizeBase,
  type Page,
  pageHead,
  type SiteContent,
  siteLanguages,
} from "@goodfellow-cms/core";
import { type ContentApiFile, type ContentApiInput, contentApiFiles } from "@goodfellow-cms/core/content-api";
import { createPuckConfigs, prepareLayout, preparePage } from "./prepare.js";
import { describeSite } from "./puck-config.js";

/**
 * Prepares the site's pages, and its header and footer in each language, for
 * the content API, as they're rendered: each page with `preparePage()`, so
 * items' values are filled into their templates and blocks' `resolveData`
 * has run. Addresses stay as content has them, without the base path, so both
 * renderers write the same files. Takes the site as visitors see it
 * (`shownContent()`) and the pages it has (`sitePages()`).
 */
export async function prepareContentApi(
  config: GoodfellowConfig,
  content: SiteContent,
  pages: readonly Page[],
  options: { base?: string } = {},
): Promise<ContentApiInput> {
  const configs = createPuckConfigs(config);
  const prepared: ContentApiInput["pages"] = [];
  for (const page of pages) {
    const { page: shown, data, site } = await preparePage(configs, content, page);
    prepared.push({
      page: shown,
      data,
      head: pageHead(content, shown),
      ...(site.credits && { credits: site.credits }),
      ...(site.languages && { languages: site.languages }),
      ...(site.headings && { headings: site.headings }),
    });
  }
  const layouts: ContentApiInput["layouts"] = [];
  for (const { code } of siteLanguages(content.settings)) {
    const { header, footer } = await prepareLayout(configs, content, {}, code);
    layouts.push({ language: code, header, footer });
  }
  return {
    content,
    description: describeSite(config),
    pages: prepared,
    layouts,
    base: normalizeBase(options.base),
  };
}

/**
 * The content API's files for a site, which builds write at `/api/`, or none
 * where the config's `api` is `false` (see `contentApiFiles()`).
 */
export async function contentApi(
  config: GoodfellowConfig,
  content: SiteContent,
  pages: readonly Page[],
  options: { base?: string } = {},
): Promise<ContentApiFile[]> {
  if (config.api === false) return [];
  return contentApiFiles(await prepareContentApi(config, content, pages, options));
}
