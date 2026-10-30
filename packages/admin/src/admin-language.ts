import {
  ADMIN_TEXT_INDEX,
  type AdminTextFile,
  adminTextOverlay,
  adminTextTable,
  isLanguageCode,
  PUBLISHED_ADMIN_TEXT_DIR,
  parseAdminTextFile,
  parseAdminTextIndex,
} from "@goodfellow-cms/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { EditorText } from "./editor-text.js";
import { PUCK_ENGLISH } from "./languages/en-puck.js";
import { defaultStrings, type StringKey, type Strings } from "./strings.js";

/** The languages Goodfellow ships the admin panel in, each named in itself, as a menu of them shows it. */
export const ADMIN_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
] as const;

/**
 * A language's code, such as `es` or `pt-BR`: one of `ADMIN_LANGUAGES`, or
 * one the site has the admin panel's text in (`content/admin-text/`).
 */
export type AdminLanguage = string;

/**
 * Everything the admin panel shows in one language: its own text, Puck's
 * (its `dictionary`), and labels of blocks' settings by their English
 * wording, which the editor's frames put in place of the English.
 */
export interface AdminText extends EditorText {
  strings: Strings;
}

const ENGLISH: AdminText = { strings: defaultStrings, puck: {}, labels: {} };

/** Each language Goodfellow ships but English, loaded only when someone chooses it, so the admin panel stays small for everyone else. */
const LOADERS: Record<string, () => Promise<AdminText>> = {
  es: () => import("./languages/es.js").then((module) => module.spanish),
};

const builtIn = (code: string) => ADMIN_LANGUAGES.some((language) => language.code === code);

/**
 * The admin panel's text in the site's own languages: from the copy builds
 * publish beside the admin panel, before anyone signs in, then from the
 * site's files, which are newer, once it has loaded.
 */
interface SiteText {
  /** Whether the languages are known yet: until then, a language the site may have waits for them. */
  known: boolean;
  /** `site` once read from the site's files, which then win over the published copy. */
  from: "published" | "site" | undefined;
  languages: { code: string; name: string }[];
  /** The files read so far, by code: every one from the site's files, those chosen from the published copy. */
  files: Record<string, AdminTextFile>;
  /** Where the published copy is, for the files not read yet. */
  published?: string;
}

const listeners = new Set<() => void>();
let siteText: SiteText = { known: false, from: undefined, languages: [], files: {} };

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The site's languages from its own files, as the admin panel loaded them,
 * which take the place of the published copy's.
 */
export function useSiteAdminTextFiles(files: Record<string, AdminTextFile> | undefined): void {
  useEffect(() => {
    if (!files) return;
    siteText = {
      known: true,
      from: "site",
      languages: Object.entries(files).map(([code, file]) => ({ code, name: file.name })),
      files,
    };
    changed();
  }, [files]);
}

/** Reads the published copy's list of the site's languages, once, unless the site's own files came first. */
async function readPublished(siteUrl: string): Promise<void> {
  const base = new URL(`${siteUrl.replace(/\/+$/, "")}/`, location.href);
  const published = new URL(PUBLISHED_ADMIN_TEXT_DIR, base).href;
  let languages: SiteText["languages"] = [];
  try {
    const response = await fetch(new URL(ADMIN_TEXT_INDEX, base), { cache: "no-store", credentials: "omit" });
    if (response.ok) languages = parseAdminTextIndex(await response.text());
  } catch {
    // Without it, the admin panel speaks the languages Goodfellow ships until the site's files load.
  }
  if (siteText.from === "site") return;
  siteText = { known: true, from: "published", languages, files: {}, published };
  changed();
}

/** Starts reading the published copy's list of the site's languages, for the sign-in screen. */
export function usePublishedAdminText(siteUrl: string): void {
  useEffect(() => {
    if (siteText.from || typeof location === "undefined") return;
    void readPublished(siteUrl);
  }, [siteUrl]);
}

/** A language's file from the published copy, or `undefined` where it can't be read. */
async function publishedFile(code: string): Promise<AdminTextFile | undefined> {
  if (!siteText.published) return undefined;
  try {
    const path = `${PUBLISHED_ADMIN_TEXT_DIR}/${code}.json`;
    const response = await fetch(`${siteText.published}/${encodeURIComponent(code)}.json`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return undefined;
    const parsed = parseAdminTextFile(path, await response.text());
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

const languagesSnapshot = () => siteText;

/** Every language the admin panel speaks here: Goodfellow's, then the site's own, each named in itself. */
export function useAdminLanguages(): { code: string; name: string }[] {
  const text = useSyncExternalStore(subscribe, languagesSnapshot, languagesSnapshot);
  return [
    ...ADMIN_LANGUAGES,
    ...text.languages.filter((language) => !builtIn(language.code)).sort((a, b) => a.code.localeCompare(b.code)),
  ];
}

/** Whether the admin panel can speak a language here: Goodfellow ships it, or the site has its text. */
export function isAdminLanguage(code: string): code is AdminLanguage {
  return builtIn(code) || siteText.languages.some((language) => language.code === code);
}

/**
 * The first of the browser's languages the admin panel speaks, whole (`pt-BR`)
 * or by its main part (`es-MX` is `es`), else English.
 */
export function browserAdminLanguage(
  languages: readonly string[],
  available: readonly string[] = ADMIN_LANGUAGES.map(({ code }) => code),
): AdminLanguage {
  const lower = new Map(available.map((code) => [code.toLowerCase(), code]));
  for (const tag of languages) {
    const whole = lower.get(tag.toLowerCase());
    if (whole) return whole;
    const main = lower.get(tag.toLowerCase().split("-")[0] ?? "");
    if (main) return main;
  }
  return "en";
}

const KEY = "goodfellow-admin-language";
let chosen: string | undefined | null = null;

/** The editor's choice in this browser, which may be a language the site's files haven't said they have yet. */
function choice(): string | undefined {
  if (chosen !== null) return chosen;
  chosen = undefined;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && isLanguageCode(saved)) chosen = saved;
  } catch {
    // Without storage, the browser's languages decide.
  }
  return chosen;
}

/** The language shown: the editor's choice, where it's spoken here, else the browser's, else English; `undefined` while the site's languages may still bring it. */
function language(): AdminLanguage | undefined {
  const saved = choice();
  if (saved && isAdminLanguage(saved)) return saved;
  // A language only the site has waits until the site's languages are known.
  if (saved && !siteText.known) return undefined;
  const available = [...ADMIN_LANGUAGES.map(({ code }) => code), ...siteText.languages.map(({ code }) => code)];
  return browserAdminLanguage(typeof navigator === "undefined" ? [] : navigator.languages, available);
}

let shown: { text: SiteText; saved: string | undefined; code: AdminLanguage | undefined } | undefined;
function languageSnapshot(): AdminLanguage | undefined {
  // The same answer for the same state, as useSyncExternalStore needs.
  if (shown?.text !== siteText || shown.saved !== choice())
    shown = { text: siteText, saved: choice(), code: language() };
  return shown.code;
}

/** Chooses the admin panel's language, kept in this browser. */
export function setAdminLanguage(next: AdminLanguage): void {
  chosen = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Without storage, the choice lasts until the page is closed.
  }
  changed();
}

/** The language the admin panel shows, `undefined` while it waits to know whether the site has the one chosen. */
export function useAdminLanguage(): AdminLanguage | undefined {
  return useSyncExternalStore(subscribe, languageSnapshot, () => "en");
}

/**
 * Strings whose English is shown beside the site's own translation of them:
 * those about signing in, tokens, owners' access, plugins and what can't be
 * undone, where a wrong translation, by a machine or by someone else, could
 * cost the editor their access or the site its files.
 */
export function showsEnglish(key: string): boolean {
  return (
    /^(signIn|owner|security|editors|plugins|broker)\./.test(key) ||
    /token/i.test(key) ||
    (/(delete|remove|discard)/i.test(key) && /(title|body\w*|confirm)$/i.test(key)) ||
    /\.(confirm|publishAnyway)$/.test(key)
  );
}

/**
 * A language's text: the site's file over Goodfellow's own translation, where
 * it ships one, over the English, each string checked as it's used. The
 * site's strings in `showsEnglish()` have the English after them.
 */
export function composeAdminText(base: AdminText | undefined, file: AdminTextFile | undefined): AdminText {
  if (!file) return base ?? ENGLISH;
  const { table, fromFile } = adminTextTable(defaultStrings, file.strings, base?.strings);
  for (const key of fromFile) {
    const english = defaultStrings[key as StringKey];
    if (showsEnglish(key) && table[key] !== english) table[key] = `${table[key]} (${english})`;
  }
  return {
    strings: table as Strings,
    // Puck's text, checked against its English where the admin panel knows it.
    puck: {
      ...adminTextOverlay(file.puck, base?.puck ?? {}),
      ...adminTextTable(PUCK_ENGLISH, file.puck, base?.puck).table,
    },
    labels: adminTextOverlay(file.labels, base?.labels ?? {}, { keyedByEnglish: true }),
  };
}

/** A language's file from the site, from its own files or the published copy, or `undefined` without one. */
async function siteFile(code: string): Promise<AdminTextFile | undefined> {
  if (!siteText.languages.some((language) => language.code === code)) return undefined;
  const loaded = siteText.files[code];
  if (loaded || siteText.from === "site") return loaded;
  const file = await publishedFile(code);
  if (file && siteText.from === "published") siteText.files = { ...siteText.files, [code]: file };
  return file;
}

/**
 * The text for the admin panel's language, `undefined` while it loads. The
 * page's `lang` follows it while the admin panel is open.
 */
export function useAdminText(): AdminText | undefined {
  const code = useAdminLanguage();
  const text = useSyncExternalStore(subscribe, languagesSnapshot, languagesSnapshot);
  const [loaded, setLoaded] = useState<{ code: string; text: SiteText; value: AdminText }>();
  useEffect(() => {
    if (!code) return;
    let live = true;
    const base = code === "en" ? Promise.resolve(ENGLISH) : (LOADERS[code]?.() ?? Promise.resolve(undefined));
    Promise.all([
      // A language that can't be loaded, such as offline after an update, leaves the admin panel in English.
      base.catch(() => undefined),
      siteFile(code).catch(() => undefined),
    ]).then(([shipped, file]) => {
      if (live) setLoaded({ code, text, value: composeAdminText(shipped, file) });
    });
    return () => {
      live = false;
    };
  }, [code, text]);
  useEffect(() => {
    if (!code) return;
    const root = document.documentElement;
    const before = root.lang;
    root.lang = code;
    return () => {
      root.lang = before;
    };
  }, [code]);
  if (!code) return undefined;
  if (loaded?.code === code) return loaded.value;
  // English needs nothing loaded unless the site has text of its own for it.
  if (code === "en" && !text.languages.some((language) => language.code === "en")) return ENGLISH;
  return undefined;
}
