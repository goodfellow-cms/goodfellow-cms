import { useEffect, useState, useSyncExternalStore } from "react";
import type { EditorText } from "./editor-text.js";
import { defaultStrings, type Strings } from "./strings.js";

/** The languages the admin panel speaks, each named in itself, as a menu of them shows it. */
export const ADMIN_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
] as const;

export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number]["code"];

/**
 * Everything the admin panel shows in one language: its own text, Puck's
 * (its `dictionary`), and labels of blocks' settings by their English
 * wording, which the editor's frames put in place of the English.
 */
export interface AdminText extends EditorText {
  strings: Strings;
}

const ENGLISH: AdminText = { strings: defaultStrings, puck: {}, labels: {} };

/** Each language but English, loaded only when someone chooses it, so the admin panel stays small for everyone else. */
const LOADERS: Record<Exclude<AdminLanguage, "en">, () => Promise<AdminText>> = {
  es: () => import("./languages/es.js").then((module) => module.spanish),
};

export function isAdminLanguage(code: string): code is AdminLanguage {
  return ADMIN_LANGUAGES.some((language) => language.code === code);
}

/** The first of the browser's languages the admin panel speaks, by its main part (`es-MX` is `es`), else English. */
export function browserAdminLanguage(languages: readonly string[]): AdminLanguage {
  for (const tag of languages) {
    const code = tag.toLowerCase().split("-")[0] ?? "";
    if (isAdminLanguage(code)) return code;
  }
  return "en";
}

const KEY = "goodfellow-admin-language";
const listeners = new Set<() => void>();
let current: AdminLanguage | undefined;

function read(): AdminLanguage {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && isAdminLanguage(saved)) return saved;
  } catch {
    // Without storage, the browser's languages decide.
  }
  return browserAdminLanguage(typeof navigator === "undefined" ? [] : navigator.languages);
}

function language(): AdminLanguage {
  current ??= read();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Chooses the admin panel's language, kept in this browser. */
export function setAdminLanguage(next: AdminLanguage): void {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage, the choice lasts until the page is closed.
  }
  for (const listener of listeners) listener();
}

/** The language the admin panel shows: the editor's choice in this browser, else the browser's own. */
export function useAdminLanguage(): AdminLanguage {
  return useSyncExternalStore(subscribe, language, () => "en" as const);
}

/**
 * The text for the admin panel's language, `undefined` while a language other
 * than English loads. The page's `lang` follows it while the admin panel is open.
 */
export function useAdminText(): AdminText | undefined {
  const code = useAdminLanguage();
  const [loaded, setLoaded] = useState<{ code: AdminLanguage; text: AdminText }>();
  useEffect(() => {
    if (code === "en") return;
    let live = true;
    LOADERS[code]().then(
      (text) => live && setLoaded({ code, text }),
      // A language that can't be loaded, such as offline after an update, leaves the admin panel in English.
      () => live && setLoaded({ code, text: ENGLISH }),
    );
    return () => {
      live = false;
    };
  }, [code]);
  useEffect(() => {
    const root = document.documentElement;
    const before = root.lang;
    root.lang = code;
    return () => {
      root.lang = before;
    };
  }, [code]);
  if (code === "en") return ENGLISH;
  return loaded?.code === code ? loaded.text : undefined;
}
