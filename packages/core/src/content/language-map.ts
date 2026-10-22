/**
 * Where a language switch links on any page, worked out in the browser for a
 * layout shared by every page, such as Next.js's, which doesn't know which
 * page it's on. It has no imports, since it runs in visitors' browsers.
 */

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

/** The site's languages and its pages' translations, from `languageMap()`. */
export interface LanguageMap {
  /** The site's languages, the main one first: each one's pages are under `prefix` (`""` for the main one). */
  languages: Array<{ code: string; name: string; prefix: string; home: string }>;
  /** The pages that have translations: by address, each translation's address by language. */
  translations: Record<string, Record<string, string>>;
}

/** An address without the trailing slash some sites' addresses have, so `/es/` is `/es`. */
function trimmed(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** The links a language switch shows at an address: each language, to the page's translation where it has one. */
export function languageLinksAt(map: LanguageMap, path: string): LanguageLink[] {
  const at = trimmed(path) || "/";
  const own =
    map.languages.find(
      (language) => language.prefix && (at === language.prefix || at.startsWith(`${language.prefix}/`)),
    ) ?? map.languages[0];
  const translations = map.translations[at];
  return map.languages.map((language) => {
    const translation = translations?.[language.code];
    const current = language.code === own?.code;
    return {
      code: language.code,
      name: language.name,
      // A page without translations is still its own language's.
      path: translation ?? (current ? at : language.home),
      translated: translation !== undefined || current,
      current,
    };
  });
}
