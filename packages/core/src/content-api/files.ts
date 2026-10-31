/**
 * The content API: the site's content as static JSON files, written by builds
 * beside the pages, so apps and other sites can show it without a server. It's
 * what visitors see (the site as `shownContent()` gives it, each page as
 * `preparePage()` leaves it), never the content files as they're stored.
 */

import { describedIn, focusPosition, type PageCredit } from "../content/credits.js";
import type { LanguageLink } from "../content/language-map.js";
import { contentInLanguage, languagePrefix, mainLanguage, siteLanguages } from "../content/languages.js";
import type { Page, SiteContent } from "../content/load.js";
import { markdownToHtml } from "../content/markdown.js";
import { type PageLink, pageLinks } from "../content/page-links.js";
import { redirectFrom, redirectTarget } from "../content/redirects.js";
import { sanitizeHtml } from "../content/sanitize.js";
import { isAddedPage, type PageView } from "../content/site-pages.js";
import { setLinkTargets } from "../external-links.js";
import type { PageHead } from "../head.js";
import type { ContentKind } from "../migrations/index.js";
import { hashText } from "../registry.js";
import type { SiteDescription } from "../site-description.js";
import { isMarkdownParts, markdownPartsNodes, type RichTextBlock, richTextNodes } from "./rich-text.js";

/** The folder the content API is written to, at the site's root: `/api/`. */
export const CONTENT_API_DIR = "api";

/** The content API's manifest, which lists everything else: `/api/manifest.json`. */
export const CONTENT_API_MANIFEST = `/${CONTENT_API_DIR}/manifest.json`;

/** Puck's data, as a page's blocks are stored and prepared. */
export interface ApiData {
  root: { props?: Record<string, unknown> };
  content: unknown[];
  zones?: Record<string, unknown[]>;
}

/**
 * Rich text as a simple structure, by what it's in: the block's id (`root`
 * for the page's settings), then the prop, with a dot between the parts of
 * one inside a list or a group, such as `items.0.text`.
 */
export type ApiRichText = Record<string, Record<string, RichTextBlock[]>>;

/** A file the manifest lists: where it is, from the manifest's folder, and a hash of its text. */
export interface ApiFile {
  file: string;
  /** A hex SHA-256 of the file's text, which changes whenever the file does. */
  hash: string;
}

/** A page, as `/api/pages/…json` has it. */
export interface ApiPageFile {
  version: 1;
  path: string;
  language: string;
  /** What the page's head says: its title as the browser shows it, description, social image and so on. */
  head: Omit<PageHead, "favicon">;
  /** On an item's page, which item it shows. */
  entry?: { collection: string; slug: string };
  /** On a page a block adds, such as a calendar's month, and on the page it adds it to: what it shows. */
  view?: PageView;
  /** The page's blocks, as the page renders them: after preparation, with an item's values filled in. */
  data: ApiData;
  richText: ApiRichText;
  /** The credits of the photos the page shows, which their licenses ask for, as the page lists them. */
  credits?: PageCredit[];
  /** On a site in several languages, the page in each: its translation, or the language's home page. */
  languages?: LanguageLink[];
}

/** The header or footer in a language, as `/api/header.json` and `/api/footer.json` have it. */
export interface ApiLayoutFile {
  version: 1;
  language: string;
  data: ApiData;
  richText: ApiRichText;
}

/** The site in a language, as `/api/site.json` has it: what blocks read with `useSite()`. */
export interface ApiSiteFile {
  version: 1;
  language: string;
  settings: SiteContent["settings"];
  menus: SiteContent["menus"];
  /** The site's pages in this language, for lists of pages (`pageLinks()`). */
  pages: PageLink[];
  /** The media library's descriptions of its images in this language, by address, for images whose blocks leave theirs empty. */
  descriptions?: Record<string, string>;
  /** The media library's focal points of its images, as CSS positions (`30% 60%`), by address. */
  focus?: Record<string, string>;
}

/** An item, as `/api/collections.json` has it. */
export interface ApiEntry {
  slug: string;
  /** Its page's address, if its collection gives items pages. */
  path?: string;
  /** Its values. Rich text is sanitized HTML, and a Markdown body is HTML too, as pages show them. */
  fields: Record<string, unknown>;
  /** Its rich text and Markdown fields as a simple structure, by field. */
  richText: Record<string, RichTextBlock[]>;
}

/** The collections in a language, each with only its items in that language. */
export interface ApiCollectionsFile {
  version: 1;
  language: string;
  collections: Array<{
    id: string;
    /** The collection's settings, without its template, which its items' pages already have filled in. */
    settings: Omit<SiteContent["collections"][number]["settings"], "template">;
    entries: ApiEntry[];
  }>;
}

/** `/api/manifest.json`. */
export interface ApiManifest {
  version: 1;
  /** The Goodfellow release the site was built with. */
  goodfellow: string;
  /** The version of each kind of content file the site reads, so an app can tell content newer than it knows. */
  content: Partial<Record<ContentKind, number>>;
  /**
   * The path the site is served from, such as `/` or `/my-site/`. Addresses in
   * the files are from the site's root (`/about`, `/media/photo.jpg`), without it.
   */
  base: string;
  /** The Site address, where it's set. */
  url?: string;
  mainLanguage: string;
  /** Each language's site, collections, header and footer, by its code. */
  languages: Record<string, { site: ApiFile; collections: ApiFile; header: ApiFile; footer: ApiFile }>;
  /** Every page, "Page not found" (`/404`) and pages blocks add included. */
  pages: Array<
    ApiFile & { path: string; language: string; entry?: { collection: string; slug: string }; added?: true }
  >;
  /** The blocks the site's pages, headers and footers use, by name. */
  blocks: string[];
  /**
   * The site's redirects, as builds send them: old addresses spelled one way
   * (`/about-us`, without a trailing slash), never one a page has, since pages
   * win, and where each goes, a page's address or another site's (`https://`).
   * Left out where the site has none.
   */
  redirects?: ApiRedirect[];
}

/** An old address and where it sends visitors, in the manifest's `redirects`. */
export interface ApiRedirect {
  from: string;
  to: string;
}

/** A page, prepared as it's shown. */
export interface ContentApiPage {
  /** The page, with an item's values filled into its collection's template. */
  page: Page;
  /** Its blocks after preparation (`preparePage()`'s `data`). */
  data: ApiData;
  head: PageHead;
  credits?: PageCredit[];
  languages?: LanguageLink[];
}

/** What a renderer gives `contentApiFiles()`: the site as shown, its pages and layouts prepared. */
export interface ContentApiInput {
  /** The site as visitors see it (`shownContent()`). */
  content: SiteContent;
  /** The site's blocks' fields (`describeSite()`), which say where rich text and slots are. */
  description: SiteDescription;
  pages: ContentApiPage[];
  /** The header and footer in each language, prepared for every page (`prepareLayout()`). */
  layouts: Array<{ language: string; header: ApiData; footer: ApiData }>;
  /** The path the site is served from (default `/`). */
  base?: string;
}

/** A file of the content API, by its address: `/api/manifest.json`. */
export interface ContentApiFile {
  path: string;
  content: string;
}

/** Where a page's file is, from the manifest's folder: `/` is `pages/index.json`, `/news/a` `pages/news/a.json`. */
export function apiPageFile(path: string): string {
  return path === "/" ? "pages/index.json" : `pages${path}.json`;
}

/** The folder a language's files are in, from the manifest's: none for the main language, `es/` for another. */
function languageFolder(content: SiteContent, language: string): string {
  return language === mainLanguage(content.settings) ? "" : `${languagePrefix(language).slice(1)}/`;
}

type Fields = Record<string, { type?: string; arrayFields?: Fields; objectFields?: Fields } | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Whether a value is a list of blocks, as a slot holds, whatever the block's fields say. */
function isBlockList(value: unknown): value is Array<{ type: string; props: Record<string, unknown> }> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isRecord(item) && typeof item.type === "string" && isRecord(item.props))
  );
}

/** A block's default props, without its slots' defaults, which a block saved before a slot existed shows empty. */
function withoutSlots(defaults: Record<string, unknown>, fields: Fields): Record<string, unknown> {
  return Object.fromEntries(Object.entries(defaults).filter(([name]) => fields[name]?.type !== "slot"));
}

/** Reads prepared data for rich text and the blocks it uses, sanitizing rich text as pages do. */
class DataReader {
  readonly richText: ApiRichText = {};

  constructor(
    private readonly description: SiteDescription,
    private readonly used: Set<string>,
  ) {}

  data(data: ApiData, rootFields: Fields): ApiData {
    const root = { ...data.root, props: this.props(data.root.props ?? {}, rootFields, "root") };
    const content = this.blocks(data.content);
    const zones =
      data.zones && Object.fromEntries(Object.entries(data.zones).map(([zone, blocks]) => [zone, this.blocks(blocks)]));
    return { ...data, root, content, ...(zones && { zones }) };
  }

  private blocks(blocks: unknown[]): unknown[] {
    return blocks.map((block) => {
      if (!isRecord(block) || typeof block.type !== "string" || !isRecord(block.props)) return block;
      this.used.add(block.type);
      const described = this.description.blocks[block.type];
      const fields = (described?.fields ?? {}) as Fields;
      const id = typeof block.props.id === "string" ? block.props.id : block.type;
      // Blocks saved before a setting existed don't have it, so they get the block's default, as its web code gives it.
      const props = { ...withoutSlots(described?.defaultProps ?? {}, fields), ...block.props };
      return { ...block, props: this.props(props, fields, id) };
    });
  }

  private props(props: Record<string, unknown>, fields: Fields, owner: string, prefix = ""): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(props).map(([name, value]) => [name, this.value(value, fields[name], owner, `${prefix}${name}`)]),
    );
  }

  private keep(owner: string, path: string, nodes: RichTextBlock[]): void {
    if (nodes.length === 0) return;
    this.richText[owner] ??= {};
    this.richText[owner][path] = nodes;
  }

  private value(value: unknown, field: Fields[string], owner: string, path: string): unknown {
    if (field?.type === "richtext" && typeof value === "string") {
      const html = sanitizeHtml(value);
      const nodes = richTextNodes(html);
      this.keep(owner, path, nodes);
      return html;
    }
    if (isBlockList(value)) return this.blocks(value);
    if (field?.type === "array" && Array.isArray(value)) {
      return value.map((item, index) =>
        isRecord(item) ? this.props(item, field.arrayFields ?? {}, owner, `${path}.${index}.`) : item,
      );
    }
    if (field?.type === "object" && isRecord(value))
      return this.props(value, field.objectFields ?? {}, owner, `${path}.`);
    // Markdown a block rendered in its preparation, such as an item's body in the Entry field block.
    if (isMarkdownParts(value)) {
      const nodes = markdownPartsNodes(value);
      this.keep(owner, path, nodes);
    }
    return value;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** The collections in a language, with rich text sanitized and Markdown as HTML, as pages show them. */
function collectionsFile(content: SiteContent, language: string): ApiCollectionsFile {
  const shown = contentInLanguage(content, language);
  const { settings } = shown;
  const links = { newTab: settings.externalLinksInNewTab === true, siteUrl: settings.url };
  return {
    version: 1,
    language,
    collections: shown.collections.map((collection) => {
      const { template: _template, ...own } = collection.settings;
      const markdownBody = own.markdown?.body;
      return {
        id: collection.id,
        settings: own,
        entries: collection.entries.map((entry): ApiEntry => {
          const richText: Record<string, RichTextBlock[]> = {};
          const fields = Object.fromEntries(
            Object.entries(entry.content.fields).map(([name, value]) => {
              const definition = own.fields.find((field) => field.name === name);
              const isMarkdown = name === markdownBody && typeof value === "string";
              if (typeof value !== "string" || !(isMarkdown || definition?.type === "richtext")) return [name, value];
              const html = isMarkdown
                ? markdownToHtml(value, { externalLinks: links })
                : sanitizeHtml(setLinkTargets(value, links));
              const nodes = richTextNodes(html);
              if (nodes.length > 0) richText[name] = nodes;
              return [name, html];
            }),
          );
          return { slug: entry.slug, ...(entry.path !== undefined && { path: entry.path }), fields, richText };
        }),
      };
    }),
  };
}

/** The redirects builds write pages for: from addresses no page has, each once. */
function apiRedirects(content: SiteContent, pages: ReadonlySet<string>): ApiRedirect[] {
  const seen = new Set<string>();
  return (content.redirects ?? []).flatMap(({ from, to }) => {
    const path = redirectFrom(from);
    const target = redirectTarget(to);
    if (!path.ok || !target || pages.has(path.path) || seen.has(path.path)) return [];
    seen.add(path.path);
    return [{ from: path.path, to: target }];
  });
}

/**
 * The content API's files: each page as it's shown (`pages/…json`), each
 * language's site settings, menus and pages (`site.json`), collections
 * (`collections.json`), header and footer, and the manifest listing them all
 * with their hashes, so a client downloads only what changed. Addresses in
 * them are from the site's root, without the base path the manifest gives.
 */
export async function contentApiFiles(input: ContentApiInput): Promise<ContentApiFile[]> {
  const { content, description } = input;
  const used = new Set<string>();
  const files: ContentApiFile[] = [];
  const add = async (file: string, value: unknown): Promise<ApiFile> => {
    const text = json(value);
    files.push({ path: `/${CONTENT_API_DIR}/${file}`, content: text });
    return { file, hash: await hashText(text) };
  };

  const pages: ApiManifest["pages"] = [];
  const rootFields = description.root.fields as Fields;
  for (const prepared of input.pages) {
    const { page } = prepared;
    const reader = new DataReader(description, used);
    const data = reader.data(prepared.data, rootFields);
    const { favicon: _favicon, ...head } = prepared.head;
    const file: ApiPageFile = {
      version: 1,
      path: page.path,
      language: head.language,
      head,
      ...(page.entry && { entry: page.entry }),
      ...(page.view && { view: page.view }),
      data,
      richText: reader.richText,
      ...(prepared.credits && prepared.credits.length > 0 && { credits: prepared.credits }),
      ...(prepared.languages && prepared.languages.length > 0 && { languages: prepared.languages }),
    };
    pages.push({
      path: page.path,
      language: head.language,
      ...(await add(apiPageFile(page.path), file)),
      ...(page.entry && { entry: page.entry }),
      ...(isAddedPage(page) && { added: true as const }),
    });
  }

  const languages: ApiManifest["languages"] = {};
  for (const { code } of siteLanguages(content.settings)) {
    const folder = languageFolder(content, code);
    const shown = contentInLanguage(content, code);
    const layout = input.layouts.find((candidate) => candidate.language === code);
    const layoutFile = async (part: "header" | "footer") => {
      const reader = new DataReader(description, used);
      const data = reader.data(layout?.[part] ?? { root: { props: {} }, content: [] }, {});
      const file: ApiLayoutFile = { version: 1, language: code, data, richText: reader.richText };
      return add(`${folder}${part}.json`, file);
    };
    const site: ApiSiteFile = {
      version: 1,
      language: code,
      settings: shown.settings,
      menus: shown.menus,
      pages: pageLinks(shown),
      ...(content.descriptions && {
        descriptions: Object.fromEntries(
          Object.entries(content.descriptions).map(([url, description]) => [url, describedIn(description, code)]),
        ),
      }),
      ...(content.focus && {
        focus: Object.fromEntries(Object.entries(content.focus).map(([url, point]) => [url, focusPosition(point)])),
      }),
    };
    languages[code] = {
      site: await add(`${folder}site.json`, site),
      collections: await add(`${folder}collections.json`, collectionsFile(content, code)),
      header: await layoutFile("header"),
      footer: await layoutFile("footer"),
    };
  }

  const redirects = apiRedirects(content, new Set(pages.map((page) => page.path)));
  const manifest: ApiManifest = {
    version: 1,
    goodfellow: description.goodfellow,
    content: description.content,
    base: input.base ?? "/",
    ...(content.settings.url && { url: content.settings.url }),
    mainLanguage: mainLanguage(content.settings),
    languages,
    pages,
    blocks: [...used].sort(),
    ...(redirects.length > 0 && { redirects }),
  };
  files.push({ path: CONTENT_API_MANIFEST, content: json(manifest) });
  return files;
}
