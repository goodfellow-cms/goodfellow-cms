import { type Collection, type Entry, markdownHeadings, type PageHeading } from "@goodfellow-cms/core";

// What the documentation blocks show, with no React, so their web and native versions share it.

/** The collection a block is about: the one it names, or else the entry's own. */
export function chosenCollection(
  id: string,
  collections: Collection[],
  own: Collection | undefined,
): Collection | undefined {
  return id ? collections.find((collection) => collection.id === id) : own;
}

/** Entries in the collection's order, grouped by a choice field in the order of its choices, then the ungrouped. */
export function navGroups(collection: Collection, groupBy: string): Array<{ label: string; entries: Entry[] }> {
  const field = collection.settings.fields.find(
    (candidate) => candidate.name === groupBy && candidate.type === "select",
  );
  if (!field) return [{ label: "", entries: collection.entries }];
  const groups = (field.options ?? []).map((option) => ({
    label: option.label,
    entries: collection.entries.filter((entry) => entry.content.fields[field.name] === option.value),
  }));
  const rest = collection.entries.filter(
    (entry) => !field.options?.some((option) => option.value === entry.content.fields[field.name]),
  );
  return [...groups, { label: "", entries: rest }].filter((group) => group.entries.length > 0);
}

/** A heading the On this page block lists: where it links, its words and its level (2 or 3). */
export interface ListedHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * The headings On this page lists, from the main ones down to `depth`: on an
 * item's page whose text is Markdown, its text's; anywhere else, the page's
 * heading blocks (`useSite().headings`).
 */
export function listedHeadings(
  collection: Collection | undefined,
  entry: Entry | undefined,
  headings: readonly PageHeading[] | undefined,
  depth: number,
): ListedHeading[] {
  const body = collection?.settings.markdown?.body;
  const markdown = body ? entry?.content.fields[body] : undefined;
  const all =
    typeof markdown === "string"
      ? markdownHeadings(markdown).map((item) => ({ id: item.id, text: item.text, level: item.depth }))
      : (headings ?? []).map((item) => ({ id: item.anchor, text: item.text, level: item.level }));
  return all.filter((item) => item.level >= 2 && item.level <= depth);
}
