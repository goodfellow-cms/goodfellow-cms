/**
 * The admin panel's text in languages Goodfellow doesn't ship, kept in the
 * site (`content/admin-text/<code>.json`), so a site can have its admin panel
 * in any language without Goodfellow keeping every one. Each file holds the
 * admin panel's strings, Puck's and blocks' labels in one language, each with
 * a hash of the English it was made from (`englishHash()`), so text made from
 * English that has changed since can be found again.
 *
 * Owners change these files (`isSettingsPath()` covers them), but their words
 * reach every editor, so every string is checked as it's used, never trusted:
 * the same `{placeholders}` as the English, not empty and not too long
 * (`adminTextProblem()`). A string that fails falls back to Goodfellow's own
 * translation, else the English.
 * Builds publish the files beside the admin panel (`publishedAdminText()`), so
 * the sign-in screen, which can't read the site's files yet, speaks them too.
 */
import { z } from "zod";
import type { ContentProblem } from "./errors.js";
import { type ContentSource, parseContentFile, readTextFiles } from "./load.js";
import { CONTENT_DIR } from "./paths.js";
import { isLanguageCode } from "./schemas.js";
import { serializeContent } from "./serialize.js";
import type { FileChange } from "./store.js";

/** Where the site keeps the admin panel's text, one file per language. */
export const ADMIN_TEXT_DIR = `${CONTENT_DIR}/admin-text`;

/** Where builds publish the site's admin text, beside the admin panel: `index.json` lists the languages. */
export const PUBLISHED_ADMIN_TEXT_DIR = "admin/text";
export const ADMIN_TEXT_INDEX = `${PUBLISHED_ADMIN_TEXT_DIR}/index.json`;

/** The longest text a string may have; Goodfellow's longest are a few hundred characters. */
export const MAX_ADMIN_TEXT_LENGTH = 2000;

/** The most strings a file may hold in each of its tables, a few times what the admin panel has. */
export const MAX_ADMIN_TEXT_ENTRIES = 10_000;

/** A language's file, by its code: `content/admin-text/fr.json`. */
export function adminTextFile(code: string): string {
  return `${ADMIN_TEXT_DIR}/${code}.json`;
}

/** The language a file under `ADMIN_TEXT_DIR` is for, or `undefined` for a file that isn't one. */
export function adminTextCode(path: string): string | undefined {
  const match = new RegExp(`^${ADMIN_TEXT_DIR}/([^/]+)\\.json$`).exec(path);
  return match?.[1] && isLanguageCode(match[1]) ? match[1] : undefined;
}

const entrySchema = z.object({
  /** The text in the file's language. */
  text: z.string(),
  /** `englishHash()` of the English it was made from; for labels, which are keyed by their English, it may be left out. */
  source: z.string().optional(),
  /** Whether someone who speaks the language has read it, rather than it coming from machine translation alone. */
  reviewed: z.boolean().optional(),
});

const tableSchema = z
  .record(z.string(), entrySchema)
  .default({})
  .refine((table) => Object.keys(table).length <= MAX_ADMIN_TEXT_ENTRIES, "has too many strings");

export const adminTextFileSchema = z.object({
  version: z.literal(1),
  /** The language's name in itself, as the admin panel's language menu shows it: `Français`. */
  name: z.string().trim().min(1).max(60),
  /** The admin panel's own strings, by key (`Strings` in `@goodfellow-cms/admin`). */
  strings: tableSchema,
  /** Puck's text, by its dictionary's keys. */
  puck: tableSchema,
  /** Blocks' names, settings' labels and choices, by their English wording. */
  labels: tableSchema,
});

export type AdminTextEntry = z.output<typeof entrySchema>;
export type AdminTextFile = z.output<typeof adminTextFileSchema>;

/**
 * A short hash of English text, FNV-1a's 32 bits in hex, which a string's
 * `source` holds, so text whose English has changed since can be found. It
 * only tells versions apart; it isn't a check anyone could be fooled by.
 */
export function englishHash(english: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < english.length; index++) {
    hash ^= english.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const placeholdersOf = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(" ");

export type AdminTextProblem = "empty" | "placeholders" | "too-long";

/**
 * What's wrong with a string, or nothing: compared with its English where
 * there is one, it must have the same `{placeholders}`, since the admin panel
 * fills in only those, and a missing one would leave out a page's name.
 */
export function adminTextProblem(text: string, english: string | undefined): AdminTextProblem | undefined {
  if (text.trim() === "") return "empty";
  if (text.length > MAX_ADMIN_TEXT_LENGTH) return "too-long";
  if (english !== undefined && placeholdersOf(text) !== placeholdersOf(english)) return "placeholders";
  return undefined;
}

export interface AdminTextTable {
  /** Each string: the file's where it's fine, else `base`'s, else the English. */
  table: Record<string, string>;
  /** Keys whose text came from the file. */
  fromFile: Set<string>;
  /** Strings the file has that couldn't be used, with why. */
  problems: { key: string; problem: AdminTextProblem }[];
  /** Strings made from English that has changed since (their `source` isn't the English's hash). */
  outdated: string[];
  /** Strings the English has that the file doesn't. */
  missing: string[];
}

/**
 * One table of the admin panel's text in a language: `english`'s keys, each
 * with the file's text where it can be used, else `base`'s (Goodfellow's own
 * translation into the language, where it has one), else the English. Keys
 * the English doesn't have are left out, such as strings Goodfellow no longer
 * uses.
 */
export function adminTextTable(
  english: Readonly<Record<string, string>>,
  entries: Readonly<Record<string, AdminTextEntry>> | undefined,
  base: Readonly<Record<string, string>> = {},
): AdminTextTable {
  const table: Record<string, string> = {};
  const fromFile = new Set<string>();
  const problems: AdminTextTable["problems"] = [];
  const outdated: string[] = [];
  const missing: string[] = [];
  for (const [key, source] of Object.entries(english)) {
    const entry = Object.hasOwn(entries ?? {}, key) ? entries?.[key] : undefined;
    const fallback = Object.hasOwn(base, key) ? base[key] : undefined;
    if (!entry) {
      missing.push(key);
      table[key] = fallback ?? source;
      continue;
    }
    const problem = adminTextProblem(entry.text, source);
    if (problem) {
      problems.push({ key, problem });
      table[key] = fallback ?? source;
      continue;
    }
    if (entry.source !== undefined && entry.source !== englishHash(source)) outdated.push(key);
    table[key] = entry.text;
    fromFile.add(key);
  }
  return { table, fromFile, problems, outdated, missing };
}

/**
 * A table keyed by its English, such as blocks' labels, or one whose English
 * the admin panel doesn't have, such as Puck's: `base` with the file's
 * strings that can be used over it, each checked against its key where the
 * key is the English.
 */
export function adminTextOverlay(
  entries: Readonly<Record<string, AdminTextEntry>> | undefined,
  base: Readonly<Record<string, string>> = {},
  options: { keyedByEnglish?: boolean } = {},
): Record<string, string> {
  const table: Record<string, string> = { ...base };
  for (const [key, entry] of Object.entries(entries ?? {})) {
    const english = options.keyedByEnglish ? key : base[key];
    if (!adminTextProblem(entry.text, english)) table[key] = entry.text;
  }
  return table;
}

/** A language's file from its text, or a problem in words where it can't be used. */
export function parseAdminTextFile(
  file: string,
  text: string,
): { ok: true; value: AdminTextFile } | { ok: false; problem: ContentProblem } {
  return parseContentFile("admin-text", adminTextFileSchema, file, text);
}

/** The languages the site has the admin panel's text in, by code, with the files that couldn't be read. */
export interface SiteAdminText {
  files: Record<string, AdminTextFile>;
  problems: ContentProblem[];
}

/**
 * Every language's file the site has. A file that can't be read is left out
 * and listed in `problems`, never thrown: the admin panel and the site work
 * in the languages Goodfellow ships whatever these files hold.
 */
export async function readAdminText(source: ContentSource): Promise<SiteAdminText> {
  const listed = (await source.list(ADMIN_TEXT_DIR)).filter((path) => adminTextCode(path));
  const texts = await readTextFiles(source, listed);
  const files: Record<string, AdminTextFile> = {};
  const problems: ContentProblem[] = [];
  for (const path of listed.sort()) {
    const code = adminTextCode(path);
    const text = texts.get(path);
    if (!code || text === undefined) continue;
    const parsed = parseAdminTextFile(path, text);
    if (parsed.ok) files[code] = parsed.value;
    else problems.push(parsed.problem);
  }
  return { files, problems };
}

/** What `ADMIN_TEXT_INDEX` lists: each language's code and its name in itself. */
export interface AdminTextIndex {
  version: 1;
  languages: { code: string; name: string }[];
}

/** The index's languages from its text, or none where it isn't one. */
export function parseAdminTextIndex(text: string): AdminTextIndex["languages"] {
  try {
    const index = JSON.parse(text) as Partial<AdminTextIndex>;
    if (index.version !== 1 || !Array.isArray(index.languages)) return [];
    return index.languages.filter(
      (language): language is { code: string; name: string } =>
        typeof language?.code === "string" &&
        isLanguageCode(language.code) &&
        typeof language.name === "string" &&
        language.name.trim() !== "",
    );
  } catch {
    return [];
  }
}

/**
 * The files builds publish beside the admin panel, under its address
 * (`admin/text/index.json` and a file for each language), as the site has
 * them, in canonical form. No language, no files.
 */
export function publishedAdminText(
  files: Readonly<Record<string, AdminTextFile>>,
): { path: string; content: string }[] {
  const codes = Object.keys(files).sort();
  if (codes.length === 0) return [];
  const index: AdminTextIndex = {
    version: 1,
    languages: codes.map((code) => ({ code, name: files[code]?.name ?? code })),
  };
  return [
    { path: ADMIN_TEXT_INDEX, content: serializeContent(index) },
    ...codes.map((code) => ({
      path: `${PUBLISHED_ADMIN_TEXT_DIR}/${code}.json`,
      content: serializeContent(files[code]),
    })),
  ];
}

/** The change that writes a language's file, in canonical form. */
export function adminTextFileChange(code: string, file: AdminTextFile): FileChange {
  if (!isLanguageCode(code)) throw new Error(`"${code}" isn't a language's code.`);
  return { path: adminTextFile(code), content: serializeContent(adminTextFileSchema.parse(file)) };
}
