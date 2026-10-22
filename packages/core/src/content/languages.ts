/**
 * Sites in more than one language. The main language's pages are at the root
 * of the site's address; each other language's are under its code, such as
 * `/es/…`, so a page's language is where it is. Collections' items say theirs
 * (`inLanguage`), and their pages are under their language's code too.
 *
 * A translation names the main language's page or item it translates
 * (`translationOf`), with a hash of it as it was then (`translatedFrom`), so
 * the admin panel can say which translations are missing or out of date.
 * Each language is shown the site as it sees it (`contentInLanguage()`): its
 * own settings, menus, header and footer, and only its own items.
 */
import type { Collection, Entry } from "./collections.js";
import { allPages, type Page, type SiteContent } from "./load.js";
import { entryAddress } from "./paths.js";
import type { CollectionFile, LayoutFile, Menus, SiteSettings } from "./schemas.js";
import { serializeContent } from "./serialize.js";

/** One of a site's languages. */
export interface SiteLanguage {
  /** Its code, as `<html lang>` says it, such as `es`. */
  code: string;
  /** Its name in its own language, such as "Español". */
  name: string;
  /** Where its pages are: `""` for the main language, `/es` for Spanish. */
  prefix: string;
  main: boolean;
}

/**
 * The site's main language. Settings in another language
 * (`localizedSettings()`) have that one as their `language`, and the main
 * one as `mainLanguage`.
 */
export function mainLanguage(settings: Pick<SiteSettings, "language" | "mainLanguage">): string {
  return settings.mainLanguage ?? settings.language;
}

/** A language's name in that language, such as "Español" for `es`, from the browser's or Node's own list. */
export function languageName(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: "language" }).of(code);
    if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    // Codes Intl doesn't know are shown as they're written.
  }
  return code;
}

/** Where a language's pages are: `/es` for `es`, `/pt-br` for `pt-BR`. */
export function languagePrefix(code: string): string {
  return `/${code.toLowerCase()}`;
}

/** The site's languages, the main one first, then the others in the order Site Settings lists them. */
export function siteLanguages(settings: SiteSettings): SiteLanguage[] {
  const main = mainLanguage(settings);
  return [
    { code: main, name: settings.languageName || languageName(main), prefix: "", main: true },
    ...(settings.languages ?? [])
      .filter((language) => language.code.toLowerCase() !== main.toLowerCase())
      .map((language) => ({
        code: language.code,
        name: language.name || languageName(language.code),
        prefix: languagePrefix(language.code),
        main: false,
      })),
  ];
}

/**
 * Where addresses in the language of `settings` start: `""` for the main
 * language, `/es` for settings in Spanish (`localizedSettings()`).
 */
export function settingsPrefix(settings: SiteSettings): string {
  return settings.language === mainLanguage(settings) ? "" : languagePrefix(settings.language);
}

/** Whether the site has languages besides its main one. */
export function hasLanguages(settings: SiteSettings): boolean {
  return siteLanguages(settings).length > 1;
}

/** The language whose pages an address is among: the one whose code it starts with, or the main language. */
export function pathLanguage(settings: SiteSettings, path: string): string {
  for (const language of siteLanguages(settings)) {
    if (language.main) continue;
    if (path === language.prefix || path.startsWith(`${language.prefix}/`)) return language.code;
  }
  return mainLanguage(settings);
}

/** An item's language: its own, or the main language. */
export function entryLanguage(settings: SiteSettings, entry: Pick<Entry, "content">): string {
  return entry.content.inLanguage ?? mainLanguage(settings);
}

/** Whether a language is one of the site's other languages. */
export function isOtherLanguage(settings: SiteSettings, code: string): boolean {
  return siteLanguages(settings).some((language) => !language.main && language.code === code);
}

/**
 * The address pattern a collection's items in a language have: the
 * collection's own for the main language, and for another, its
 * `languagePaths` one or the collection's under the language's code.
 */
export function languagePattern(
  settings: SiteSettings,
  collection: Pick<CollectionFile, "path" | "languagePaths">,
  language: string,
): string | undefined {
  if (collection.path === undefined) return undefined;
  if (language === mainLanguage(settings)) return collection.path;
  return collection.languagePaths?.[language] ?? `${languagePrefix(language)}${collection.path}`;
}

/** An item's address in its language, if its collection gives items pages. */
export function entryPathIn(
  settings: SiteSettings,
  collection: Pick<CollectionFile, "path" | "languagePaths">,
  slug: string,
  language: string,
): string | undefined {
  const pattern = languagePattern(settings, collection, language);
  return pattern === undefined ? undefined : entryAddress(pattern, slug);
}

/** The site's settings in a language: its code, and its own title, description and title template where it has them. */
export function localizedSettings(settings: SiteSettings, language: string): SiteSettings {
  const main = mainLanguage(settings);
  if (language === main) {
    if (settings.mainLanguage === undefined) return settings;
    const { mainLanguage: _shown, ...rest } = settings;
    return { ...rest, language: main };
  }
  const own = settings.translations?.[language];
  return {
    ...settings,
    language,
    mainLanguage: main,
    ...(own?.title && { title: own.title }),
    ...(own?.description && { description: own.description }),
    ...(own?.titleTemplate && { titleTemplate: own.titleTemplate }),
  };
}

/** The menus in a language: its own where it has a menu, the main language's where it doesn't. */
export function menusIn(content: Pick<SiteContent, "settings" | "menus" | "languageMenus">, language: string): Menus {
  if (language === mainLanguage(content.settings)) return content.menus;
  return { ...content.menus, ...content.languageMenus?.[language] };
}

/** The header or footer in a language: its own (`header.es.json`) where it has one, the main language's where it doesn't. */
export function layoutIn(content: SiteContent, part: "header" | "footer", language: string): LayoutFile {
  if (language === mainLanguage(content.settings)) return content[part];
  return content.languageLayouts?.[language]?.[part] ?? content[part];
}

/**
 * The site as a language shows it: its settings, menus, header and footer,
 * and each collection with only its items in that language, so blocks that
 * list items list them in the page's language. Takes the site as loaded.
 */
export function contentInLanguage(content: SiteContent, language: string): SiteContent {
  // Sites in one language are shown as they are, and so is the site already shown in a language.
  if (!hasLanguages(content.settings) || content.settings.mainLanguage !== undefined) return content;
  return {
    ...content,
    settings: localizedSettings(content.settings, language),
    menus: menusIn(content, language),
    header: layoutIn(content, "header", language),
    footer: layoutIn(content, "footer", language),
    collections: content.collections.map((collection) => ({
      ...collection,
      entries: collection.entries.filter((entry) => entryLanguage(content.settings, entry) === language),
    })),
  };
}

/** A page's language, from its address. */
export function pageLanguage(content: Pick<SiteContent, "settings">, page: Pick<Page, "path">): string {
  return pathLanguage(content.settings, page.path);
}

/** The site as a page's language shows it (see `contentInLanguage()`). */
export function contentForPage(content: SiteContent, page: Pick<Page, "path">): SiteContent {
  return contentInLanguage(content, pageLanguage(content, page));
}

/** A short hash of a page's or item's content, which a translation keeps to tell whether it's out of date. */
export function translationHash(value: unknown): string {
  const text = serializeContent(value);
  // FNV-1a, twice with different starting points: enough to notice a change, with nothing to keep secret.
  const hash = (seed: number) => {
    let h = seed >>> 0;
    for (let index = 0; index < text.length; index++) {
      h ^= text.charCodeAt(index);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x01000193)}`;
}

/** What a translation is hashed from: a page's blocks, or an item's values. */
export function pageSourceHash(page: Pick<Page, "content">): string {
  return translationHash(page.content.data);
}

export function entrySourceHash(entry: Pick<Entry, "content">): string {
  return translationHash(entry.content.fields);
}

/** How a page or item's translation into a language stands. */
export type TranslationState = "missing" | "current" | "outdated";

/** Whether a translation is up to date with the page or item it translates, as it is now. */
export function translationState(
  sourceHash: string,
  translation: { translatedFrom?: string } | undefined,
): TranslationState {
  if (!translation) return "missing";
  // A translation that doesn't say what it was made from can't be known to be out of date.
  if (translation.translatedFrom === undefined) return "current";
  return translation.translatedFrom === sourceHash ? "current" : "outdated";
}

/**
 * A page and its translations, by language: the main language's page and
 * every page that says it translates it. A page in another language that
 * translates nothing is on its own.
 */
export function pageTranslations(content: SiteContent, page: Page): Map<string, Page> {
  const { settings } = content;
  const language = pageLanguage(content, page);
  const sourcePath = language === mainLanguage(settings) ? page.path : page.content.translationOf;
  const group = new Map<string, Page>();
  const source =
    sourcePath === undefined ? undefined : content.pages.find((candidate) => candidate.path === sourcePath);
  if (!source || pageLanguage(content, source) !== mainLanguage(settings)) {
    group.set(language, page);
    return group;
  }
  group.set(mainLanguage(settings), source);
  for (const candidate of content.pages) {
    if (candidate.content.translationOf !== source.path) continue;
    const other = pageLanguage(content, candidate);
    if (other !== mainLanguage(settings) && !group.has(other)) group.set(other, candidate);
  }
  return group;
}

/** An item and its translations in its collection, by language, as for pages (see `pageTranslations()`). */
export function entryTranslations(settings: SiteSettings, collection: Collection, entry: Entry): Map<string, Entry> {
  const language = entryLanguage(settings, entry);
  const sourceSlug = language === mainLanguage(settings) ? entry.slug : entry.content.translationOf;
  const group = new Map<string, Entry>();
  const source =
    sourceSlug === undefined ? undefined : collection.entries.find((candidate) => candidate.slug === sourceSlug);
  if (!source || entryLanguage(settings, source) !== mainLanguage(settings)) {
    group.set(language, entry);
    return group;
  }
  group.set(mainLanguage(settings), source);
  for (const candidate of collection.entries) {
    if (candidate.content.translationOf !== source.slug) continue;
    const other = entryLanguage(settings, candidate);
    if (other !== mainLanguage(settings) && !group.has(other)) group.set(other, candidate);
  }
  return group;
}

/** The addresses of a page and its translations, by language, for an ordinary page or an item's page. */
function translationPaths(content: SiteContent, page: Page): Map<string, string> {
  const paths = new Map<string, string>();
  if (!hasLanguages(content.settings)) return paths;
  if (page.entry) {
    const collection = content.collections.find((candidate) => candidate.id === page.entry?.collection);
    const entry = collection?.entries.find((candidate) => candidate.slug === page.entry?.slug);
    if (!collection || !entry) return paths;
    for (const [language, translation] of entryTranslations(content.settings, collection, entry)) {
      if (translation.path) paths.set(language, translation.path);
    }
    return paths;
  }
  const own = content.pages.find((candidate) => candidate.file === page.file) ?? page;
  for (const [language, translation] of pageTranslations(content, own)) paths.set(language, translation.path);
  return paths;
}

/**
 * The page's translations' addresses, by language, itself included, for
 * `hreflang` links: none where it has no translations. A page a block added,
 * such as a list's second page, has none, since its translations may not
 * have a page like it.
 */
export function pageAlternates(content: SiteContent, page: Page): Map<string, string> {
  if (page.view && page.view.path !== page.path) return new Map();
  const paths = translationPaths(content, page);
  return paths.size > 1 ? paths : new Map();
}

/** A language's home page: the page at its code, such as `/es`, or the main language's home page where it has none. */
export function languageHome(content: Pick<SiteContent, "settings" | "pages">, language: string): string {
  if (language === mainLanguage(content.settings)) return "/";
  const prefix = languagePrefix(language);
  return content.pages.some((page) => page.path === prefix) ? prefix : "/";
}

/** Whether an address is a language's home page: `/`, or a language's code such as `/es`. */
export function isLanguageHome(settings: SiteSettings, path: string): boolean {
  return path === "/" || siteLanguages(settings).some((language) => !language.main && path === language.prefix);
}

/** One link of a language switch. */
export interface LanguageLink {
  code: string;
  name: string;
  /** The page's translation in this language, or, without one, the language's home page. */
  path: string;
  /** Whether the page has a translation in this language. */
  translated: boolean;
  /** Whether this is the page's own language. */
  current: boolean;
}

/** The links a language switch shows on a page: each of the site's languages, to the page's translation where it has one. */
export function languageLinks(content: SiteContent, page: Page): LanguageLink[] {
  if (!hasLanguages(content.settings)) return [];
  // A page a block added links to the translations of the page it's on.
  const own =
    page.view && page.view.path !== page.path
      ? allPages(content).find((candidate) => candidate.path === page.view?.path)
      : page;
  const alternates = own ? translationPaths(content, own) : new Map<string, string>();
  const current = pageLanguage(content, page);
  return siteLanguages(content.settings).map((language) => {
    const path = alternates.get(language.code);
    return {
      code: language.code,
      name: language.name,
      path: path ?? languageHome(content, language.code),
      translated: path !== undefined,
      current: language.code === current,
    };
  });
}
