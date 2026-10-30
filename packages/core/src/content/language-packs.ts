/**
 * Language packs: the admin panel's text in one language, as data with no
 * code, published on npm as `goodfellow-language-<name>` so sites share a
 * translation rather than each making their own. Installing one writes its
 * strings into the site's `content/admin-text/<code>.json`, each marked with
 * a hash of the text as installed (`pack`), so an update replaces only the
 * strings nobody has changed since, and an owner's own words are kept unless
 * they choose the pack's.
 */
import { z } from "zod";
import {
  type AdminTextEntry,
  type AdminTextFile,
  adminTextFile,
  adminTextFileChange,
  adminTextTableSchema,
  englishHash,
} from "./admin-text.js";
import { isLanguageCode } from "./schemas.js";
import type { FileChange } from "./store.js";

/** `goodfellow-language.json`, at the root of a language pack's package: the language, and its text. */
export const languagePackManifestSchema = z.object({
  version: z.literal(1),
  /** The language's code, such as `fr` or `pt-BR`, which names the site's file. */
  code: z.string().refine(isLanguageCode, "must be a language's code, such as fr or pt-BR"),
  /** The language's name in itself, as the admin panel's language menu shows it: `Français`. */
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).optional(),
  /** As a site's admin text file has them: the admin panel's strings, Puck's text and blocks' labels. */
  strings: adminTextTableSchema,
  puck: adminTextTableSchema,
  labels: adminTextTableSchema,
});
export type LanguagePackManifest = z.output<typeof languagePackManifestSchema>;

/** A language pack's release, read from its package. */
export interface LanguagePack {
  /** Its npm package, such as `goodfellow-language-fr`. */
  name: string;
  /** The release, such as `1.2.0`. */
  release: string;
  manifest: LanguagePackManifest;
  /** The Goodfellow releases it says it works with: its `peerDependencies` range on `@goodfellow-cms/core`. */
  goodfellow?: string;
}

const TABLES = ["strings", "puck", "labels"] as const;
export type AdminTextTableName = (typeof TABLES)[number];

/** Whether a string's text is still what a language pack installed. */
export function fromLanguagePack(entry: AdminTextEntry): boolean {
  return entry.pack !== undefined && entry.pack === englishHash(entry.text);
}

/** A string, by its table and key. */
export interface AdminTextString {
  table: AdminTextTableName;
  key: string;
}

export interface LanguagePackOptions {
  /** Whether the pack's text replaces the owner's own where both have a string. */
  replaceOwn?: boolean;
}

export interface LanguagePackPlan {
  code: string;
  /** The language's file afterwards, or `undefined` where nothing is left in it. */
  file: AdminTextFile | undefined;
  /** The one change that writes or deletes it. */
  changes: FileChange[];
  /** How many of the pack's strings it writes. */
  written: number;
  /** The previous pack's strings the new one doesn't have, taken out. */
  removed: number;
  /** The owner's own strings kept in place of the pack's different text. */
  kept: AdminTextString[];
  /** The owner's own strings the pack's text replaces, with `replaceOwn`. */
  replaced: AdminTextString[];
}

function packed(entry: AdminTextEntry): AdminTextEntry {
  return {
    text: entry.text,
    ...(entry.source !== undefined && { source: entry.source }),
    ...(entry.reviewed && { reviewed: true }),
    pack: englishHash(entry.text),
  };
}

/**
 * Installing, updating or removing (`pack` undefined) a language's pack, with
 * no network access: the previous pack's strings that nobody has changed go,
 * the owner's own stay, and the pack's go in where the owner has none, or
 * over the owner's with `replaceOwn`. A file left with no strings is deleted.
 */
export function planLanguagePack(
  code: string,
  file: AdminTextFile | undefined,
  pack: LanguagePack | undefined,
  options: LanguagePackOptions = {},
): LanguagePackPlan {
  if (pack && pack.manifest.code !== code) {
    throw new Error(`${pack.name} is for "${pack.manifest.code}", not "${code}".`);
  }
  const next: AdminTextFile = {
    version: 1,
    name: file?.name ?? pack?.manifest.name ?? code,
    strings: {},
    puck: {},
    labels: {},
  };
  const kept: AdminTextString[] = [];
  const replaced: AdminTextString[] = [];
  let written = 0;
  let removed = 0;
  for (const table of TABLES) {
    const before = file?.[table] ?? {};
    const given = pack?.manifest[table] ?? {};
    for (const [key, entry] of Object.entries(before)) {
      if (!fromLanguagePack(entry)) next[table][key] = entry;
      else if (!Object.hasOwn(given, key)) removed += 1;
    }
    for (const [key, entry] of Object.entries(given)) {
      const own = Object.hasOwn(next[table], key) ? next[table][key] : undefined;
      if (own && own.text === entry.text) {
        // The owner's words are the pack's: later releases may change them.
        next[table][key] = { ...own, pack: englishHash(own.text) };
        continue;
      }
      if (own && !options.replaceOwn) {
        kept.push({ table, key });
        continue;
      }
      if (own) replaced.push({ table, key });
      next[table][key] = packed(entry);
      written += 1;
    }
  }
  if (pack) {
    next.pack = {
      name: pack.name,
      release: pack.release,
      ...(pack.goodfellow !== undefined && { goodfellow: pack.goodfellow }),
    };
  }
  const empty = TABLES.every((table) => Object.keys(next[table]).length === 0);
  const result = !pack && empty ? undefined : next;
  return {
    code,
    file: result,
    changes: [result ? adminTextFileChange(code, result) : { path: adminTextFile(code), delete: true }],
    written,
    removed,
    kept,
    replaced,
  };
}
