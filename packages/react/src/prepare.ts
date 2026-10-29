import {
  applyBasePath,
  contentForPage,
  contentInLanguage,
  findEntry,
  type GoodfellowConfig,
  hasLanguages,
  languageHome,
  languageLinks,
  mainLanguage,
  normalizeBase,
  type Page,
  pageCredits,
  pageLanguage,
  pageLinks,
  type SiteContent,
  type SiteSettings,
  setLinkTargets,
  structuredData,
  structuredDataScript,
  todayIn,
} from "@goodfellow-cms/core";
import type { Config, Data } from "@puckeditor/core";
// The server entry works everywhere and has no browser-only code, so Server Components can prepare pages too.
import { migrate, resolveAllData } from "@puckeditor/core/rsc";
import { applyEntry, expandEntryLoops } from "./entry.js";
import { createPuckConfig } from "./puck-config.js";
import { type SiteContextValue, siteMetadata } from "./site-types.js";

/** How the page will be rendered, for renderers that don't rewrite the finished HTML. */
export type RenderOptions = Pick<SiteContextValue, "base" | "components" | "media" | "imageWidths" | "languageMap">;

/** The Puck configs a site's pages are rendered with. */
export interface PuckConfigs {
  page: Config;
  layout: Config;
  template: Config;
}

export function createPuckConfigs(config: GoodfellowConfig): PuckConfigs {
  return {
    page: createPuckConfig(config, "page"),
    layout: createPuckConfig(config, "layout"),
    template: createPuckConfig(config, "template"),
  };
}

/** Everything `<PageBody>` needs to render a page. */
export interface PreparedPage {
  site: SiteContextValue;
  /** The page, with an entry's values filled into its collection's template. */
  page: Page;
  pageConfig: Config;
  layoutConfig: Config;
  data: Data;
  header: Data;
  footer: Data;
  /** What search engines are told about the page, as JSON-LD (`structuredDataScript()`), if anything. */
  structuredData?: string;
}

/**
 * Brings stored Puck data up to date with the installed Puck version, then runs
 * every block's `resolveData`, so blocks can fetch or compute content at build time.
 */
async function prepareData(data: unknown, config: Config, site: SiteContextValue): Promise<Data> {
  const stored = data as Data;
  // Puck's DropZone-to-slot migration needs the config and logs on every call, so only run it on data that has zones.
  const migrated = migrate(stored, stored.zones && Object.keys(stored.zones).length > 0 ? config : undefined);
  return resolveAllData(expandEntryLoops(migrated, config, site), config, siteMetadata(site));
}

/** The entry a page shows, if it's an entry's page. */
function pageEntry(content: SiteContent, page: Page) {
  if (!page.entry) return undefined;
  const found = findEntry(content, page.entry.collection, page.entry.slug);
  if (!found) throw new Error(`${page.file} isn't an entry in the "${page.entry.collection}" collection.`);
  return found;
}

/**
 * The page with an entry's values filled into its collection's template, such
 * as its title for the browser tab. Other pages are returned as they are.
 */
export function applyPageEntry(configs: PuckConfigs, content: SiteContent, page: Page): Page {
  const found = pageEntry(content, page);
  if (!found) return page;
  const data = applyEntry(
    migrate(page.content.data as Data),
    configs.template,
    found.collection,
    found.entry,
    content.settings.language,
    content.settings.timeZone,
  );
  return { ...page, content: { ...page.content, data: data as Page["content"]["data"] } };
}

/** Adds the base path to addresses in rich text, which renders as HTML rather than through `<SiteLink>`. */
function withBaseInHtml(value: unknown, base: string): unknown {
  if (typeof value === "string") return value.includes('="/') ? applyBasePath(value, base) : value;
  if (Array.isArray(value)) return value.map((item) => withBaseInHtml(item, base));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withBaseInHtml(item, base)]));
  }
  return value;
}

/** Everything `<PageHeader>` and `<PageFooter>` need to render the site's header and footer. */
export interface PreparedLayout {
  /** The site, without a current page: a layout is shared by every page. */
  site: SiteContextValue;
  layoutConfig: Config;
  header: Data;
  footer: Data;
}

/** Says where rich text's links open, as `<SiteLink>` does for blocks' own links: see `setLinkTargets()`. */
function linkTargetsInHtml(value: unknown, settings: SiteSettings): unknown {
  if (typeof value === "string") {
    return value.includes("<a ")
      ? setLinkTargets(value, { newTab: settings.externalLinksInNewTab === true, siteUrl: settings.url })
      : value;
  }
  if (Array.isArray(value)) return value.map((item) => linkTargetsInHtml(item, settings));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, linkTargetsInHtml(item, settings)]));
  }
  return value;
}

/** What rich text needs once resolved: the base path, and where its links open. */
function rebaser(options: RenderOptions, settings: SiteSettings) {
  const base = normalizeBase(options.base);
  return <T>(value: T): T => {
    const rebased = base === "/" ? value : (withBaseInHtml(value, base) as T);
    return linkTargetsInHtml(rebased, settings) as T;
  };
}

/**
 * Gets the site's header and footer ready to render for a layout shared by
 * every page, such as a Next.js layout, in one of the site's languages (the
 * main one unless given). They're given no current page (`path` is empty), so
 * blocks that highlight it, such as Menu, leave that to the browser.
 */
export async function prepareLayout(
  configs: PuckConfigs,
  loaded: SiteContent,
  options: RenderOptions = {},
  language = mainLanguage(loaded.settings),
): Promise<PreparedLayout> {
  const content = contentInLanguage(loaded, language);
  const home = hasLanguages(loaded.settings) ? languageHome(loaded, language) : undefined;
  const site: SiteContextValue = {
    settings: content.settings,
    menus: content.menus,
    path: "",
    collections: content.collections,
    pages: pageLinks(content),
    ...(home && { home }),
    ...options,
  };
  const [header, footer] = await Promise.all([
    prepareData(content.header.data, configs.layout, site),
    prepareData(content.footer.data, configs.layout, site),
  ]);
  const rebase = rebaser(options, content.settings);
  return { site, layoutConfig: configs.layout, header: rebase(header), footer: rebase(footer) };
}

/**
 * Gets a page ready to render: fills in an entry's values, and resolves the
 * page, header and footer, in the page's language (`contentForPage()`). With a
 * `base`, rich text's links and images get it too. Takes the site as loaded.
 */
export async function preparePage(
  configs: PuckConfigs,
  loaded: SiteContent,
  page: Page,
  options: RenderOptions = {},
): Promise<PreparedPage> {
  const content = contentForPage(loaded, page);
  const { settings } = content;
  const found = pageEntry(content, page);
  const languages = languageLinks(loaded, page);
  const site: SiteContextValue = {
    settings,
    menus: content.menus,
    path: page.path,
    collections: content.collections,
    pages: pageLinks(content),
    ...(found && { collection: found.collection, entry: found.entry }),
    ...(page.view && { view: page.view }),
    ...(languages.length > 0 && { languages, home: languageHome(loaded, pageLanguage(loaded, page)) }),
    ...options,
  };
  // An entry's page is its collection's template, with the entry's values filled in.
  const pageConfig = found ? configs.template : configs.page;
  const applied = applyPageEntry(configs, content, page);

  const [data, header, footer] = await Promise.all([
    prepareData(applied.content.data, pageConfig, site),
    prepareData(content.header.data, configs.layout, site),
    prepareData(content.footer.data, configs.layout, site),
  ]);
  const rebase = rebaser(options, content.settings);
  // The credits of the photos the page shows, which their licenses ask for.
  const credits = pageCredits(content, [data, header, footer]);
  const structured = structuredDataScript(structuredData(loaded, page, todayIn(settings.timeZone)));
  return {
    site: credits.length > 0 ? { ...site, credits } : site,
    page: applied,
    pageConfig,
    layoutConfig: configs.layout,
    data: rebase(data),
    header: rebase(header),
    footer: rebase(footer),
    ...(structured && { structuredData: structured }),
  };
}
