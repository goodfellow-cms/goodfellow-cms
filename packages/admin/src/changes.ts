/**
 * The file changes the admin panel saves. Most are built by core's helpers,
 * which the Claude connector shares; converting a collection's items between
 * Markdown and formatted text needs the browser's HTML handling, so it's here.
 */
import {
  type AddressMove,
  type Collection,
  type CollectionField,
  type CollectionFile,
  collectionFileChange,
  entryFileChange,
  entryLanguage,
  entryPathIn,
  type FileChange,
  relinkedChanges,
  relinkSite,
  type SiteContent,
  type SiteSettings,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { formattedHtml, htmlToMarkdown } from "./markdown-text.js";

export {
  type AddressProblem,
  addressPatternFor,
  checkEntrySlug,
  checkPageAddress,
  codeFileChanges,
  collectionFileChange,
  customCssFileChange,
  deleteCollectionChanges,
  duplicatePageData,
  type EntryNameProblem,
  entryFileChange,
  layoutFileChange,
  mediaFileChange,
  menusFileChange,
  movedPageRedirects,
  moveEntryChanges,
  movePageChanges,
  newCollectionSettings,
  newPageData,
  pageFileChange,
  pageTitle,
  redirectsFileChange,
  type SiteRedirects,
  siteSettingsFileChange,
  slugify,
  storedCss,
  storedData,
  storedEntryFields,
  uniqueName,
  updateSettingsFileChange,
  withoutCredits,
} from "@goodfellow-cms/core";

/**
 * A stored value as it fits its collection's field now, or `undefined` if it
 * doesn't: the field must exist, and a choice must still be offered. Tags
 * keep the ones that still are.
 */
function keptValue(fields: Map<string, CollectionField>, name: string, value: unknown): unknown {
  const field = fields.get(name);
  if (!field) return undefined;
  const offered = (choice: unknown) => field.options?.some((option) => option.value === choice) === true;
  if (field.type === "select") return offered(value) ? value : undefined;
  if (field.type === "tags" && Array.isArray(value)) {
    const tags = value.filter(offered);
    if (tags.length === value.length) return value;
    return tags.length > 0 ? tags : undefined;
  }
  return value;
}

/** Where each item's page goes when its collection's address patterns change, in each of the site's languages. */
function movedEntryPages(site: SiteSettings, collection: Collection, settings: CollectionFile): AddressMove[] {
  if (!collection.settings.path || !settings.path) return [];
  return collection.entries.flatMap((entry) => {
    const to = entryPathIn(site, settings, entry.slug, entryLanguage(site, entry));
    return entry.path && to && to !== entry.path ? [{ from: entry.path, to }] : [];
  });
}

/**
 * Saves a collection's new settings. Values of fields that were removed, and
 * choices that are no longer offered, are removed from every entry in the
 * same save, so a field added later with the same name starts empty. Given
 * the `site`, a new address pattern points every link to an item's page at
 * its new address, in the same save.
 */
export function collectionSettingsChanges(
  collection: Collection,
  settings: CollectionFile,
  site?: { content: SiteContent; blocks?: Record<string, ComponentConfig> },
): FileChange[] {
  // Items are read with the fields they were saved with; the template is the new one.
  const relinked = site
    ? relinkSite(
        {
          ...site.content,
          collections: site.content.collections.map((candidate) =>
            candidate.id === collection.id
              ? { ...collection, settings: { ...collection.settings, template: settings.template } }
              : candidate,
          ),
        },
        movedEntryPages(site.content.settings, collection, settings),
        site.blocks,
      )
    : undefined;
  const current = relinked?.content.collections.find((candidate) => candidate.id === collection.id) ?? collection;
  const relinkedFiles = new Set(relinked?.files);
  const fields = new Map(settings.fields.map((field) => [field.name, field]));
  const changes = [collectionFileChange(collection.id, { ...settings, template: current.settings.template })];
  const before = collection.settings.markdown?.body;
  const after = settings.markdown?.body;
  const reformat = before !== after;
  for (const entry of current.entries) {
    const values = Object.entries(entry.content.fields);
    const remaining = values.flatMap(([name, value]): Array<[string, unknown]> => {
      const kept = keptValue(fields, name, value);
      return kept === undefined ? [] : [[name, kept]];
    });
    const changed =
      remaining.length !== values.length || remaining.some(([name, value]) => value !== entry.content.fields[name]);
    if (!changed && !reformat && !relinkedFiles.has(entry.file)) continue;
    const kept = Object.fromEntries(remaining);
    if (reformat) {
      // The body moves between Markdown and formatted text (HTML), and the file between .md and .json.
      if (before !== undefined && typeof kept[before] === "string") kept[before] = formattedHtml(kept[before]);
      if (after !== undefined && typeof kept[after] === "string") kept[after] = htmlToMarkdown(kept[after]);
    }
    const change = entryFileChange({ id: collection.id, settings }, entry.slug, kept, entry.content);
    if (change.path !== entry.file) changes.push({ path: entry.file, delete: true });
    changes.push(change);
  }
  if (relinked) {
    changes.push(...relinkedChanges(relinked, [collection.file, ...collection.entries.map((entry) => entry.file)]));
  }
  return changes;
}
