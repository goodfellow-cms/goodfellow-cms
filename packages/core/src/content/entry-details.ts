/**
 * What an entry says about itself, read from its collection's fields, for
 * places outside the site's pages that show entries: feeds and the structured
 * data search engines read. Collections don't name these fields, so they're
 * found by their types: the date the collection sorts by (or its first), its
 * summary (a calendar's, or its first plain-text area), its body (the first
 * formatted-text field) and its first image.
 */
import { type Collection, type Entry, entryTitle, imagesOf, isDateValue, richTextToPlainText } from "./collections.js";
import { markdownText } from "./markdown.js";
import type { CollectionField } from "./schemas.js";

/** The most characters of an entry's text a summary made from it has. */
export const SUMMARY_LENGTH = 300;

export interface EntryDetails {
  title: string;
  /** When it was published, as `YYYY-MM-DD`, from a date field. */
  date?: string;
  /** A sentence or two of plain text. */
  summary?: string;
  /** Its text as plain text, without formatting. */
  text?: string;
  /** An image's address, such as `/media/photo.jpg`. */
  image?: string;
}

/** The date field entries are dated by: the one the collection sorts by, or its first. */
export function dateField(collection: Collection): CollectionField | undefined {
  const { fields, sort } = collection.settings;
  const sorted = fields.find((field) => field.name === sort?.field && field.type === "date");
  return sorted ?? fields.find((field) => field.type === "date");
}

/** The field a summary comes from: a calendar's, or the first plain-text area. */
function summaryField(collection: Collection): CollectionField | undefined {
  const { fields, calendar } = collection.settings;
  return (
    fields.find((field) => field.name === calendar?.summary) ??
    fields.find((field) => field.type === "textarea" && field.name !== calendar?.place)
  );
}

/** Text cut at a word to at most `length` characters, with an ellipsis when it was cut. */
function shortened(text: string, length = SUMMARY_LENGTH): string {
  if (text.length <= length) return text;
  const cut = text.slice(0, length - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A field's value as plain text, whatever kind of text field it is. */
function plainText(collection: Collection, field: CollectionField | undefined, value: unknown): string | undefined {
  if (!field || typeof value !== "string") return undefined;
  const text =
    collection.settings.markdown?.body === field.name
      ? markdownText(value)
      : field.type === "richtext"
        ? richTextToPlainText(value)
        : value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** What an entry says about itself, from its collection's fields. */
export function entryDetails(collection: Collection, entry: Entry): EntryDetails {
  const { fields } = collection.settings;
  const values = entry.content.fields;
  const date = dateField(collection);
  const dated = date ? values[date.name] : undefined;
  const body = fields.find((field) => field.type === "richtext");
  const text = plainText(collection, body, body && values[body.name]);
  const summary = plainText(collection, summaryField(collection), values[summaryField(collection)?.name ?? ""]);
  const image =
    fields
      .map((field) =>
        field.type === "image" && typeof values[field.name] === "string"
          ? String(values[field.name]).trim()
          : field.type === "images"
            ? (imagesOf(values[field.name])[0] ?? "")
            : "",
      )
      .find((address) => address !== "") ?? "";
  return {
    title: entryTitle(entry),
    ...(isDateValue(dated) && { date: dated }),
    ...((summary || text) && { summary: shortened(summary ?? text ?? "") }),
    ...(text && { text }),
    ...(image && { image }),
  };
}
