/**
 * Links to items: an `item` field holds the names of items in another
 * collection (or its own), which pages show as their titles, linked to their
 * pages. Names are what links keep, so renaming an item renames them, and
 * deleting one takes it out of them, in the same publish.
 */
import { type Collection, type Entry, entryTitle, linkedItems } from "./collections.js";
import type { SiteContent } from "./load.js";
import type { CollectionField } from "./schemas.js";

/** A field of a collection that links to items of `target`. */
export interface ItemLinkField {
  collection: Collection;
  field: CollectionField;
}

/** Every field in the site that links to items of a collection. */
export function itemLinkFields(content: Pick<SiteContent, "collections">, target: string): ItemLinkField[] {
  return content.collections.flatMap((collection) =>
    collection.settings.fields
      .filter((field) => field.type === "item" && field.collection === target)
      .map((field) => ({ collection, field })),
  );
}

/** The collections with a field that links to a collection's items, which keep it from being deleted. */
export function collectionsLinkingTo(content: Pick<SiteContent, "collections">, target: string): Collection[] {
  const found = itemLinkFields(content, target)
    .map((link) => link.collection)
    .filter((collection) => collection.id !== target);
  return [...new Map(found.map((collection) => [collection.id, collection])).values()];
}

/** The items that link to one, in any collection, such as a deleted speaker's talks. */
export function itemsLinkingTo(content: Pick<SiteContent, "collections">, target: string, slug: string): Entry[] {
  const found = itemLinkFields(content, target).flatMap(({ collection, field }) =>
    collection.entries.filter((entry) => linkedItems(field, entry.content.fields[field.name]).includes(slug)),
  );
  // An item that links to it in more than one field is listed once.
  return [...new Map(found.map((entry) => [entry.file, entry])).values()];
}

/**
 * The site with every link to items of `target` changed by `change`, which
 * gives an item's new name, or `undefined` to take it out; and the files of
 * the items that changed, to write with `relinkedChanges()`.
 */
export function changeItemLinks(
  content: SiteContent,
  target: string,
  change: (slug: string) => string | undefined,
): { content: SiteContent; files: string[] } {
  const files: string[] = [];
  const collections = content.collections.map((collection) => {
    const fields = collection.settings.fields.filter((field) => field.type === "item" && field.collection === target);
    if (fields.length === 0) return collection;
    const entries = collection.entries.map((entry) => {
      let values = entry.content.fields;
      for (const field of fields) {
        const value = values[field.name];
        const before = linkedItems(field, value);
        if (before.length === 0) continue;
        const after = before.flatMap((slug) => change(slug) ?? []);
        if (after.length === before.length && after.every((slug, index) => slug === before[index])) continue;
        const next = field.multiple ? after : after[0];
        const { [field.name]: _old, ...rest } = values;
        values =
          next === undefined || (Array.isArray(next) && next.length === 0) ? rest : { ...rest, [field.name]: next };
      }
      if (values === entry.content.fields) return entry;
      files.push(entry.file);
      return { ...entry, content: { ...entry.content, fields: values } };
    });
    return { ...collection, entries };
  });
  return files.length === 0 ? { content, files } : { content: { ...content, collections }, files };
}

/** A link to an item that isn't in its collection. */
export interface MissingItemLink {
  /** The item that links. */
  entry: Entry;
  field: CollectionField;
  /** The collection it links into, and the name of the item that isn't there. */
  target: string;
  slug: string;
}

/** Every link to an item that isn't there, such as one deleted outside the admin panel. */
export function missingItemLinks(content: Pick<SiteContent, "collections">): MissingItemLink[] {
  const names = new Map(
    content.collections.map((collection) => [collection.id, new Set(collection.entries.map((entry) => entry.slug))]),
  );
  return content.collections.flatMap((collection) =>
    collection.settings.fields
      .filter((field) => field.type === "item" && field.collection)
      .flatMap((field) =>
        collection.entries.flatMap((entry) =>
          linkedItems(field, entry.content.fields[field.name])
            .filter((slug) => !names.get(field.collection ?? "")?.has(slug))
            .map((slug) => ({ entry, field, target: field.collection ?? "", slug })),
        ),
      ),
  );
}

/**
 * The item a link names, in a collection: the item itself, or, where the
 * site is shown in another language and has only that language's items
 * (`contentInLanguage()`), its translation.
 */
export function linkedItem(collection: Collection | undefined, slug: string): Entry | undefined {
  return (
    collection?.entries.find((entry) => entry.slug === slug) ??
    collection?.entries.find((entry) => entry.content.translationOf === slug)
  );
}

/** An item's title by its collection and name, for `formatFieldValue()`'s `itemTitle`. */
export function itemTitleIn(collections: readonly Collection[]) {
  return (collection: string, slug: string): string | undefined => {
    const entry = linkedItem(
      collections.find((candidate) => candidate.id === collection),
      slug,
    );
    return entry ? entryTitle(entry) : undefined;
  };
}
