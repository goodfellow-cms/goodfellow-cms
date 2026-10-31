/**
 * What Collection list and Collection loop share, with no React, so their
 * native versions share it too: which entries they show, in what order, and
 * the pages they add for later entries and for each choice of a field (see
 * `withPages`).
 */

import {
  addDays,
  type BlockPagesContext,
  type Collection,
  type CollectionField,
  changesOn,
  choiceSlug,
  type Entry,
  hasChoice,
  isChoiceField,
  isDateValue,
  isEventLike,
  isUpcoming,
  linkedItems,
  type PageVariant,
  type PageView,
  type SiteSettings,
  shownOccurrence,
  sortCollectionEntries,
  sortEntries,
  todayIn,
  variantPath,
} from "@goodfellow-cms/core";

/** What a list needs to know about the site, from `useSite()` on the web or `useNativeSite()` in an app. */
export interface ListingSite {
  collections: Collection[];
  settings: SiteSettings;
  path: string;
  view?: PageView;
  /** On an item's page, its collection and the item, whose links a list can follow (`linkedFrom`). */
  collection?: Collection;
  entry?: Entry;
}

export type Order = "default" | "newest" | "oldest" | "title" | "title-desc" | "field-asc" | "field-desc";
export type Show = "all" | "upcoming" | "past";

/** The props both blocks have for choosing and ordering entries, and splitting them into pages. */
export interface ListingProps {
  collection: string;
  /** A date or event field, for "newest first" and for showing only upcoming or past entries. */
  dateField: string;
  /** For `field-asc` and `field-desc`. */
  sortField: string;
  order: Order;
  show: Show;
  /**
   * A choice or tags field, and the choice entries must have, to show only
   * some; or a yes or no field, for only the entries where it's on.
   */
  filterField: string;
  filterValue: string;
  /**
   * In a collection's template, a field of the item whose page it is that
   * links to items of this list's collection: the list shows only those.
   */
  linkedFrom?: string;
  /** How many, or on each page; 0 for all. */
  limit: number;
  /** Whether entries past `limit` go on later pages: `page/2` and so on. */
  paginate: boolean;
  /** A choice or tags field whose every choice gets a page, such as `topics/music`. */
  choicePages: string;
  allLabel: string;
  previousLabel: string;
  nextLabel: string;
  /** A later page's title, with `{number}` for its number. */
  pageTitle: string;
  /** What screen readers call the links to other pages. */
  pagesLabel: string;
}

export const listingDefaults: ListingProps = {
  collection: "",
  dateField: "",
  sortField: "",
  order: "default",
  show: "all",
  filterField: "",
  filterValue: "",
  linkedFrom: "",
  limit: 0,
  paginate: false,
  choicePages: "",
  allLabel: "All",
  previousLabel: "Previous",
  nextLabel: "Next",
  pageTitle: "Page {number}",
  pagesLabel: "Pages",
};

/** The most entries in one list or on each of its pages. */
export const MAX_LIMIT = 1000;

export function fieldOf(collection: Collection, name: string): CollectionField | undefined {
  return collection.settings.fields.find((field) => field.name === name);
}

/**
 * The entries a list or loop shows, in order, before they're split into
 * pages. `now` is today's date: pages are rebuilt nightly to keep it current.
 * With `choice`, only entries with that choice of `choicePages`.
 */
export function selectedEntries(
  collection: Collection,
  props: Pick<ListingProps, "dateField" | "sortField" | "order" | "show" | "filterField" | "filterValue"> &
    Partial<Pick<ListingProps, "choicePages">>,
  now = todayIn(undefined),
  choice?: string,
): Entry[] {
  const { dateField, order, show } = props;
  let entries = collection.entries;
  if (props.filterField && fieldOf(collection, props.filterField)?.type === "yesno") {
    entries = entries.filter((entry) => entry.content.fields[props.filterField] === true);
  } else if (props.filterField && props.filterValue) {
    entries = entries.filter((entry) => hasChoice(collection, entry, props.filterField, props.filterValue));
  }
  if (choice && props.choicePages) {
    entries = entries.filter((entry) => hasChoice(collection, entry, props.choicePages ?? "", choice));
  }
  if (dateField && show !== "all") {
    entries = entries.filter((entry) => {
      const date = entry.content.fields[dateField];
      // An event that repeats is upcoming until its last time.
      if (isEventLike(date)) return show === "upcoming" ? isUpcoming(date, now) : !isUpcoming(date, now);
      if (!isDateValue(date)) return false;
      // It moves from "Today and later" to "Before today" the day after its date.
      if (date >= now) changesOn(addDays(date, 1));
      return show === "upcoming" ? date >= now : date < now;
    });
  }
  const isEventField = fieldOf(collection, dateField)?.type === "event";
  if (order === "title" || order === "title-desc") {
    return sortEntries(entries, undefined, order === "title" ? "asc" : "desc");
  }
  if ((order === "field-asc" || order === "field-desc") && props.sortField) {
    return sortEntries(entries, props.sortField, order === "field-asc" ? "asc" : "desc");
  }
  if (isEventField && (order !== "default" || collection.settings.sort?.field === dateField)) {
    // Events that repeat come in order of when they next happen, rather than when they first did.
    const next = (entry: Entry) => {
      const value = entry.content.fields[dateField];
      return isEventLike(value) ? (shownOccurrence(value, now)?.start ?? value.start) : "";
    };
    const descending = order === "newest" || (order === "default" && collection.settings.sort?.order === "desc");
    return [...entries].sort((a, b) => {
      const [x, y] = [next(a), next(b)];
      if (!x || !y) return x ? -1 : y ? 1 : 0;
      return descending ? y.localeCompare(x) : x.localeCompare(y);
    });
  }
  if ((order === "newest" || order === "oldest") && dateField) {
    return sortEntries(entries, dateField, order === "newest" ? "desc" : "asc");
  }
  return sortCollectionEntries(collection.settings, entries);
}

/** How many entries go on each page, or in the list: none for all. */
function pageSize(limit: number): number | undefined {
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : undefined;
}

/** The choices that get pages: the field's choices whose names can be part of an address. */
export function choicePageList(
  collection: Collection,
  field: string,
): Array<{ value: string; label: string; slug: string }> {
  const definition = fieldOf(collection, field);
  if (!definition || !isChoiceField(definition)) return [];
  const seen = new Set<string>();
  return (definition.options ?? []).flatMap((option) => {
    const slug = choiceSlug(option.value);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [{ value: option.value, label: option.label, slug }];
  });
}

/** The address of a list's page: its choice's, then its number's. Page 1 is the page itself. */
export function listingPath(
  path: string,
  props: Pick<ListingProps, "choicePages">,
  choice?: { slug: string },
  page = 1,
): string {
  let address = path;
  if (choice) address = variantPath(address, `${props.choicePages}/${choice.slug}`);
  if (page > 1) address = variantPath(address, `page/${page}`);
  return address;
}

function pageCount(total: number, size: number | undefined): number {
  return size ? Math.max(1, Math.ceil(total / size)) : 1;
}

/** The pages a list or loop adds: later pages, and a page for each choice, with its later pages. */
export function listingPages(stored: Partial<ListingProps>, { content, today }: BlockPagesContext): PageVariant[] {
  // Blocks saved before a prop existed don't have it.
  const props = { ...listingDefaults, ...stored };
  const collection = content.collections.find((candidate) => candidate.id === props.collection);
  // A list of the items an item links to is short, and different on each item's page, so it has no pages.
  if (!collection || props.linkedFrom) return [];
  const size = props.paginate ? pageSize(props.limit) : undefined;
  const now = today;
  const variants: PageVariant[] = [];
  const pageTitle = (number: number) => props.pageTitle.replaceAll("{number}", String(number));
  const addPages = (entries: Entry[], suffix: string, choice?: { value: string; label: string }) => {
    const count = pageCount(entries.length, size);
    for (let page = choice ? 1 : 2; page <= count; page++) {
      const parts = [suffix, page > 1 ? `page/${page}` : ""].filter(Boolean);
      const titles = [choice?.label, page > 1 ? pageTitle(page) : ""].filter(Boolean);
      variants.push({
        suffix: parts.join("/"),
        ...(page > 1 && { page }),
        ...(choice && { choice: choice.value }),
        title: titles.join(", "),
      });
    }
  };
  addPages(selectedEntries(collection, props, now), "");
  if (props.choicePages) {
    for (const choice of choicePageList(collection, props.choicePages)) {
      addPages(selectedEntries(collection, props, now, choice.value), `${props.choicePages}/${choice.slug}`, choice);
    }
  }
  return variants;
}

/** What a list or loop shows on the page being rendered. */
export interface Listing {
  collection: Collection;
  /** The entries on this page. */
  entries: Entry[];
  page: number;
  pages: number;
  /** The choice of `choicePages` this page shows, if it's one of those. */
  choice?: string;
  /** The page the block is on, which its other pages are variations of. */
  path: string;
  /** Whether this block has the page's other pages, so its links go somewhere. */
  linked: boolean;
}

/**
 * The entries the item whose page this is links to in its field `name`, or
 * none off an item's page. An item shown in another language is linked by
 * the main language's name, which its translation names (`translationOf`).
 */
function linkedEntries(entries: Entry[], name: string, site: ListingSite): Entry[] {
  const field = site.collection && fieldOf(site.collection, name);
  const names = new Set(linkedItems(field, site.entry?.content.fields[name]));
  return entries.filter(
    (entry) =>
      names.has(entry.slug) || (entry.content.translationOf !== undefined && names.has(entry.content.translationOf)),
  );
}

/** What a list or loop shows on a page: which of its pages it's on, and that page's entries. */
export function currentListing(
  stored: Partial<ListingProps> & { id?: string },
  site: ListingSite,
): Listing | undefined {
  const props = { ...listingDefaults, ...stored };
  const collection = site.collections.find((candidate) => candidate.id === props.collection);
  if (!collection) return undefined;
  const view = site.view;
  // Only the block the page's other pages are for links to them; the others show their first page. The editor
  // gives the page the same view as builds (`pageView()`), so it shows the same.
  const owned = view !== undefined && view.block === props.id;
  const linked = owned;
  const choice = owned ? view.choice : undefined;
  const selected = selectedEntries(collection, props, todayIn(site.settings.timeZone), choice);
  const all = props.linkedFrom ? linkedEntries(selected, props.linkedFrom, site) : selected;
  const size = pageSize(props.limit);
  const pages = props.paginate && !props.linkedFrom ? pageCount(all.length, size) : 1;
  const page = owned ? Math.min(view.page ?? 1, pages) : 1;
  const start = size ? (page - 1) * size : 0;
  return {
    collection,
    entries: size ? all.slice(start, start + size) : all,
    page,
    pages,
    ...(choice !== undefined && { choice }),
    path: owned ? view.path : site.path,
    linked,
  };
}
