import type { Collection, Entry } from "@goodfellow-cms/core";

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
