/**
 * What a site's admin text (`content/admin-text/<code>.json`) has to say in
 * its language, and how much of it it says: the admin panel's own strings,
 * Puck's text (`PUCK_ENGLISH`) and the labels of the site's blocks, as the
 * Admin languages screen counts and translates them. No React, so it's
 * tested on its own.
 */
import type { AdminTextSource } from "@goodfellow-cms/ai";
import {
  type AdminTextEntry,
  type AdminTextFile,
  adminTextProblem,
  englishHash,
  type SiteDescription,
} from "@goodfellow-cms/core";
import { PUCK_ENGLISH } from "./languages/en-puck.js";
import { defaultStrings } from "./strings.js";

export type AdminTextTable = "strings" | "puck" | "labels";

const TABLES: readonly AdminTextTable[] = ["strings", "puck", "labels"];

/** A source's key in one list of every table's: the table, a colon, then its own key, since labels' keys are words. */
export function sourceKey(table: AdminTextTable, key: string): string {
  return `${table}:${key}`;
}

function splitKey(key: string): { table: AdminTextTable; key: string } | undefined {
  const colon = key.indexOf(":");
  const table = key.slice(0, colon) as AdminTextTable;
  return TABLES.includes(table) ? { table, key: key.slice(colon + 1) } : undefined;
}

/** Every label a block's fields show, as `withLabels()` puts them in another language: settings, choices and placeholders. */
function fieldLabels(fields: Record<string, unknown>, found: Set<string>): void {
  for (const field of Object.values(fields)) {
    const described = (field ?? {}) as Record<string, unknown>;
    for (const name of ["label", "placeholder"]) {
      const value = described[name];
      if (typeof value === "string" && value.trim()) found.add(value);
    }
    if (Array.isArray(described.options)) {
      for (const option of described.options as { label?: unknown }[]) {
        if (typeof option?.label === "string" && option.label.trim()) found.add(option.label);
      }
    }
    for (const nested of ["arrayFields", "objectFields"]) {
      const inner = described[nested];
      if (inner && typeof inner === "object") fieldLabels(inner as Record<string, unknown>, found);
    }
  }
}

/** The labels of the site's blocks and its page settings, from its description, with any more given (such as groups'). */
export function labelSources(
  description: Pick<SiteDescription, "blocks" | "root">,
  more: Iterable<string> = [],
): string[] {
  const found = new Set<string>(more);
  for (const block of Object.values(description.blocks)) {
    if (block.label?.trim()) found.add(block.label);
    fieldLabels(block.fields, found);
  }
  fieldLabels(description.root.fields, found);
  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Everything the admin panel says in English, from every table, keyed with `sourceKey()`. */
export function adminTextSources(labels: readonly string[]): AdminTextSource[] {
  return [
    ...Object.entries(defaultStrings).map(([key, english]) => ({
      key: sourceKey("strings", key),
      english,
      table: "strings" as const,
    })),
    ...Object.entries(PUCK_ENGLISH).map(([key, english]) => ({
      key: sourceKey("puck", key),
      english,
      table: "puck" as const,
    })),
    ...labels.map((english) => ({ key: sourceKey("labels", english), english, table: "labels" as const })),
  ];
}

function entryOf(file: AdminTextFile | undefined, key: string): AdminTextEntry | undefined {
  const split = splitKey(key);
  if (!file || !split) return undefined;
  const table = file[split.table];
  return Object.hasOwn(table, split.key) ? table[split.key] : undefined;
}

export type SourceState = "missing" | "unusable" | "outdated" | "current";

/**
 * Where a string stands in a language's file: not there, there but not
 * usable (`adminTextProblem()`), made from English that has changed since,
 * or current. Labels are keyed by their English, so they can't be outdated.
 */
export function sourceState(file: AdminTextFile | undefined, source: AdminTextSource): SourceState {
  const entry = entryOf(file, source.key);
  if (!entry) return "missing";
  if (adminTextProblem(entry.text, source.english)) return "unusable";
  if (source.table !== "labels" && entry.source !== undefined && entry.source !== englishHash(source.english)) {
    return "outdated";
  }
  return "current";
}

export interface LanguageStatus {
  total: number;
  current: number;
  outdated: number;
  missing: number;
  unusable: number;
  /** Current strings someone who speaks the language has read. */
  reviewed: number;
}

/** How much of the admin panel a language's file says. */
export function languageStatus(file: AdminTextFile | undefined, sources: readonly AdminTextSource[]): LanguageStatus {
  const status: LanguageStatus = {
    total: sources.length,
    current: 0,
    outdated: 0,
    missing: 0,
    unusable: 0,
    reviewed: 0,
  };
  for (const source of sources) {
    const state = sourceState(file, source);
    status[state] += 1;
    if (state === "current" && entryOf(file, source.key)?.reviewed) status.reviewed += 1;
  }
  return status;
}

/** The strings to translate: those missing or unusable, and with `outdated`, those made from English that has changed. */
export function sourcesToTranslate(
  file: AdminTextFile | undefined,
  sources: readonly AdminTextSource[],
  options: { outdated?: boolean } = {},
): AdminTextSource[] {
  return sources.filter((source) => {
    const state = sourceState(file, source);
    return state === "missing" || state === "unusable" || (options.outdated === true && state === "outdated");
  });
}

/**
 * A language's file with new translations in it, by `sourceKey()`, each with
 * the hash of the English it was made from, and not marked reviewed, since
 * no one has read it yet. What the file had besides is kept as it was.
 */
export function withTranslations(
  file: AdminTextFile | undefined,
  name: string,
  translated: ReadonlyMap<string, string>,
  sources: readonly AdminTextSource[],
): AdminTextFile {
  const next: AdminTextFile = {
    version: 1,
    name: file?.name ?? name,
    strings: { ...file?.strings },
    puck: { ...file?.puck },
    labels: { ...file?.labels },
  };
  const english = new Map(sources.map((source) => [source.key, source.english]));
  for (const [key, text] of translated) {
    const split = splitKey(key);
    const source = english.get(key);
    if (!split || source === undefined) continue;
    next[split.table][split.key] = { text, source: englishHash(source) };
  }
  return next;
}
