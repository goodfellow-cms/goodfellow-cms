import { eventValueProblem, formatOccurrence, isEventLike, shownOccurrence, todayIn, wallClock } from "../calendar.js";
import type { CollectionField, CollectionFile, EntryFile } from "./schemas.js";
import { TITLE_FIELD } from "./schemas.js";
import { withoutTags } from "./tags.js";

/** A group of similar entries sharing one set of fields and one template. */
export interface Collection {
  /** The collection's folder name, such as `videos`. */
  id: string;
  /** Its settings file, `content/collections/<id>/_collection.json`. */
  file: string;
  settings: CollectionFile;
  /** Entries in the collection's own order (see `sortEntries`). */
  entries: Entry[];
}

/** One item in a collection. */
export interface Entry {
  /** The id of the collection it belongs to. */
  collection: string;
  /** Its file name without `.json`, which is also the last part of its address. */
  slug: string;
  file: string;
  /** The entry's page address, if its collection gives entries pages. */
  path?: string;
  content: EntryFile;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether text is a calendar date written as `YYYY-MM-DD`, such as `2026-12-24`, that exists: never February 30. */
export function isDateValue(value: unknown): value is string {
  return typeof value === "string" && DATE.test(value) && wallClock(value) !== undefined;
}

/**
 * Checks an entry's values against its collection's fields. Fields left out
 * are fine (they show as empty); values of the wrong kind are not. Values for
 * fields the collection doesn't have are ignored.
 */
export function entryFieldProblems(fields: CollectionField[], values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === null) continue;
    switch (field.type) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) problems.push(`${field.name} must be a number`);
        break;
      case "date":
        if (value !== "" && !isDateValue(value)) problems.push(`${field.name} must be a date written as YYYY-MM-DD`);
        break;
      case "event": {
        const problem = eventValueProblem(value);
        if (problem) problems.push(`${field.name} ${problem}`);
        break;
      }
      case "select":
        if (value !== "" && !field.options?.some((option) => option.value === value)) {
          problems.push(`${field.name} must be one of: ${field.options?.map((option) => option.value).join(", ")}`);
        }
        break;
      case "tags":
        if (
          !Array.isArray(value) ||
          value.some((tag) => typeof tag !== "string" || !field.options?.some((option) => option.value === tag))
        ) {
          problems.push(`${field.name} must be a list of: ${field.options?.map((option) => option.value).join(", ")}`);
        }
        break;
      default:
        if (typeof value !== "string") problems.push(`${field.name} must be text`);
    }
  }
  return problems;
}

/** A tag that shows something without words: anything but paragraphs, line breaks and formatting. */
const SHOWN_TAG = /<(?!\/|(?:p|br|span|strong|b|em|i|u|s|sub|sup|mark|code|a)\b)[a-z]/i;

/** Whether a field has no value worth showing. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return !isEventLike(value);
  // Rich text with no words can still show something: a picture, a video, a line, a table.
  if (typeof value === "string") return richTextToPlainText(value) === "" && !SHOWN_TAG.test(value);
  return false;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Tags that end a line, which become spaces in plain text. */
const BREAKS = /^<(br|\/p|\/h[1-6]|\/li|\/blockquote)\b/i;

/** Rich text as plain text: tags removed, common entities decoded and whitespace collapsed. */
export function richTextToPlainText(html: string): string {
  return withoutTags(html, (tag) => (BREAKS.test(tag) ? " " : ""))
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function dateFormat(language: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" });
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });
  }
}

/**
 * A field's value as plain text, the way it appears where a placeholder like
 * `{date}` is used: dates are written out in the site's language, choices show
 * their label, and rich text loses its formatting. An event shows when it
 * next happens in the site's time zone, as of when the page is built.
 */
export function formatFieldValue(
  field: CollectionField | undefined,
  value: unknown,
  language = "en",
  timeZone?: string,
): string {
  if (value === undefined || value === null) return "";
  if (!field) return typeof value === "string" ? value : String(value);
  switch (field.type) {
    case "event": {
      if (!isEventLike(value)) return "";
      const shown = shownOccurrence(value, todayIn(timeZone));
      return shown ? formatOccurrence(shown, language) : "";
    }
    case "date":
      return isDateValue(value) ? dateFormat(language).format(new Date(`${value}T00:00:00Z`)) : String(value);
    case "select":
      return field.options?.find((option) => option.value === value)?.label ?? String(value);
    case "tags":
      return choicesOf(field, value)
        .map((choice) => field.options?.find((option) => option.value === choice)?.label ?? choice)
        .join(", ");
    case "richtext":
      return typeof value === "string" ? richTextToPlainText(value) : "";
    default:
      return String(value);
  }
}

/** The choices a choice or tags field's value has, as a list: none, one, or for tags, any number. */
export function choicesOf(field: CollectionField | undefined, value: unknown): string[] {
  if (field?.type === "tags") return Array.isArray(value) ? value.filter((tag) => typeof tag === "string") : [];
  return typeof value === "string" && value !== "" ? [value] : [];
}

/** Whether an entry has a choice in a choice or tags field. */
export function hasChoice(collection: Collection, entry: Entry, field: string, choice: string): boolean {
  const definition = collection.settings.fields.find((candidate) => candidate.name === field);
  return choicesOf(definition, entry.content.fields[field]).includes(choice);
}

/** The fields whose values are choices, which lists can filter by and give a page for each. */
export function isChoiceField(field: CollectionField): boolean {
  return field.type === "select" || field.type === "tags";
}

/**
 * A choice as part of an address, such as `youth-ministry` for "Youth
 * ministry": lowercase letters, numbers and hyphens, without accents.
 * `undefined` for a choice with none of those, such as one in another script.
 */
export function choiceSlug(choice: string): string | undefined {
  const slug = choice
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}

/** The name shown for an entry in lists: its title, or its file name. */
export function entryTitle(entry: Entry): string {
  const title = entry.content.fields[TITLE_FIELD];
  return typeof title === "string" && title.trim() ? title.trim() : entry.slug;
}

export type SortOrder = "asc" | "desc";

/**
 * Sorts entries by one field. Entries without a value for it come last, and
 * entries with the same value are ordered by title. Returns a new array.
 */
export function sortEntries(entries: Entry[], field: string = TITLE_FIELD, order: SortOrder = "asc"): Entry[] {
  const direction = order === "asc" ? 1 : -1;
  const sortValue = (entry: Entry) => {
    const value = entry.content.fields[field];
    // Events sort by when they start.
    if (isEventLike(value)) return value.start;
    if (typeof value === "string") return value.trim() === "" ? undefined : value.toLocaleLowerCase();
    return typeof value === "number" ? value : undefined;
  };
  const byTitle = (a: Entry, b: Entry) =>
    entryTitle(a).localeCompare(entryTitle(b), undefined, { sensitivity: "base" }) || a.slug.localeCompare(b.slug);

  return [...entries].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av === undefined || bv === undefined) {
      if (av !== bv) return av === undefined ? 1 : -1;
      return byTitle(a, b);
    }
    const compared =
      typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined);
    return compared * direction || byTitle(a, b);
  });
}

/** A collection's entries in its own order: by its `sort` setting, or by title. */
export function sortCollectionEntries(settings: CollectionFile, entries: Entry[]): Entry[] {
  return sortEntries(entries, settings.sort?.field, settings.sort?.order);
}
