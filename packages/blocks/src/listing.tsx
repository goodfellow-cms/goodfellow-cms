/**
 * What Collection list and Collection loop share: which entries they show, in
 * what order, and the pages they add for later entries and for each choice of
 * a field (see `withPages`), with the links between them.
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
  type PageVariant,
  shownOccurrence,
  sortCollectionEntries,
  sortEntries,
  todayIn,
  variantPath,
} from "@goodfellow-cms/core";
import { type SiteContextValue, SiteLink, useParts, useSite } from "@goodfellow-cms/react";
import type { Fields } from "@puckeditor/core";
import { options, yesNo } from "./options.js";

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
  /** A choice or tags field, and the choice entries must have, to show only some. */
  filterField: string;
  filterValue: string;
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
const MAX_LIMIT = 1000;

function fieldOf(collection: Collection, name: string): CollectionField | undefined {
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
  if (props.filterField && props.filterValue) {
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
  if (!collection) return [];
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

/** What a list or loop shows on a page: which of its pages it's on, and that page's entries. */
export function currentListing(
  stored: Partial<ListingProps> & { id?: string },
  site: Pick<SiteContextValue, "collections" | "settings" | "path" | "view">,
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
  const all = selectedEntries(collection, props, todayIn(site.settings.timeZone), choice);
  const size = pageSize(props.limit);
  const pages = props.paginate ? pageCount(all.length, size) : 1;
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

/**
 * Why a block that would have pages of its own doesn't, for the editor to say:
 * another block higher on the page has them, or it's somewhere that never
 * does, such as an item's page or the header.
 */
export function pagesNotice(view: SiteContextValue["view"], shows: "page" | "month"): string {
  const rest =
    shows === "month"
      ? "only this month, with no links to the others"
      : "only its first page, with no links to the rest";
  return view
    ? `A block higher on this page already has pages of its own, and a page can have only one, so this one shows ${rest}. Move it to a page of its own to give it pages.`
    : `Items' pages, "Page not found" and the header and footer don't get pages of their own, so this shows ${rest}.`;
}

/** Whether a list would have pages of its own: later pages, or a page for each choice. */
export function wantsPages(listing: Listing, stored: Partial<ListingProps>): boolean {
  const props = { ...listingDefaults, ...stored };
  return listing.pages > 1 || (!!props.choicePages && choicePageList(listing.collection, props.choicePages).length > 0);
}

/** In the editor, why a list that would have pages of its own doesn't. */
export function PagesNotice({ listing, props }: { listing: Listing; props: Partial<ListingProps> }) {
  const { view } = useSite();
  if (listing.linked || !wantsPages(listing, props)) return null;
  return (
    <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
      {pagesNotice(view, "page")}
    </p>
  );
}

/** Links to a list's pages for each choice, with "All" first. */
export function ChoiceLinks({ listing, props: stored }: { listing: Listing; props: Partial<ListingProps> }) {
  const part = useParts();
  const props = { ...listingDefaults, ...stored };
  const choices = props.choicePages ? choicePageList(listing.collection, props.choicePages) : [];
  if (!listing.linked || choices.length === 0) return null;
  // The current choice's link is the page itself only on its first page.
  const link = (label: string, href: string, current: boolean) => (
    <li key={href}>
      <SiteLink
        href={href}
        aria-current={current ? (listing.page === 1 ? "page" : "true") : undefined}
        className={part(
          "gf-choice-link",
          "inline-flex rounded-full border border-border px-3 py-1 text-sm hover:bg-muted",
          // The current choice stays marked whatever the theme gives choices.
          current && "border-primary bg-primary text-primary-foreground hover:bg-primary",
        )}
      >
        {label}
      </SiteLink>
    </li>
  );
  return (
    <ul className={part("gf-choices", "flex flex-wrap gap-2")}>
      {link(props.allLabel, listing.path, listing.choice === undefined)}
      {choices.map((choice) =>
        link(choice.label, listingPath(listing.path, props, choice), listing.choice === choice.value),
      )}
    </ul>
  );
}

/** Links to a list's other pages: previous, each page's number, and next. */
export function PageLinks({ listing, props: stored }: { listing: Listing; props: Partial<ListingProps> }) {
  const part = useParts();
  const props = { ...listingDefaults, ...stored };
  if (!listing.linked || listing.pages <= 1) return null;
  const choice = listing.choice
    ? choicePageList(listing.collection, props.choicePages).find((item) => item.value === listing.choice)
    : undefined;
  const href = (page: number) => listingPath(listing.path, props, choice, page);
  const numbers = Array.from({ length: listing.pages }, (_, index) => index + 1);
  const linkClass = "inline-flex min-w-9 justify-center rounded-md px-3 py-1.5 text-sm hover:bg-muted";
  return (
    <nav
      aria-label={props.pagesLabel}
      className={part("gf-page-links", "flex flex-wrap items-center justify-center gap-1")}
    >
      {listing.page > 1 && (
        <SiteLink href={href(listing.page - 1)} rel="prev" className={part("gf-page-link", linkClass)}>
          ← {props.previousLabel}
        </SiteLink>
      )}
      <ol className={part("gf-page-numbers", "flex flex-wrap gap-1")}>
        {numbers.map((page) => (
          <li key={page}>
            <SiteLink
              href={href(page)}
              aria-current={page === listing.page ? "page" : undefined}
              className={part(
                "gf-page-link",
                linkClass,
                // The current page stays marked whatever the theme gives page links.
                page === listing.page && "bg-primary text-primary-foreground hover:bg-primary",
              )}
            >
              {page}
            </SiteLink>
          </li>
        ))}
      </ol>
      {listing.page < listing.pages && (
        <SiteLink href={href(listing.page + 1)} rel="next" className={part("gf-page-link", linkClass)}>
          {props.nextLabel} →
        </SiteLink>
      )}
    </nav>
  );
}

const NONE = { label: "None", value: "" };

/** The fields for choosing and ordering entries, and splitting them into pages. */
export const listingFields: Fields<ListingProps> = {
  collection: { type: "select", label: "Collection", options: [] },
  filterField: { type: "select", label: "Only items with", options: [NONE] },
  filterValue: { type: "select", label: "Choice", options: [NONE] },
  dateField: { type: "select", label: "Date", options: [NONE] },
  show: {
    type: "select",
    label: "Show",
    options: options({ all: "Everything", upcoming: "Today and later", past: "Before today" }),
  },
  order: {
    type: "select",
    label: "Order",
    options: options({
      default: "The collection's order",
      newest: "Newest first",
      oldest: "Oldest first",
      title: "A to Z",
      "title-desc": "Z to A",
      "field-asc": "By a field, lowest first",
      "field-desc": "By a field, highest first",
    }),
  },
  sortField: { type: "select", label: "Field to order by", options: [NONE] },
  limit: { type: "number", label: "How many (0 for all)", min: 0, max: MAX_LIMIT },
  paginate: { type: "radio", label: "More on later pages", options: yesNo },
  choicePages: { type: "select", label: "A page for each choice of", options: [NONE] },
  allLabel: { type: "text", label: 'Link to every item, beside the choices ("All")' },
  previousLabel: { type: "text", label: "Previous page's link" },
  nextLabel: { type: "text", label: "Next page's link" },
  pageTitle: { type: "text", label: "Later pages' titles, with {number} for the page's number" },
  pagesLabel: { type: "text", label: "Links to other pages, for screen readers" },
};

/**
 * A list or loop's fields for its props: its collection's own fields to choose
 * from, and only the settings that apply.
 */
export function resolveListingFields<Props extends ListingProps>(
  fields: Fields<Props>,
  props: ListingProps,
  collections: Collection[],
): Partial<Fields<Props>> {
  const collection = collections.find((candidate) => candidate.id === props.collection);
  const fieldsOf = (accept: (field: CollectionField) => boolean) => [
    NONE,
    ...(collection?.settings.fields ?? []).filter(accept).map((field) => ({ label: field.label, value: field.name })),
  ];
  const filterDefinition = collection && fieldOf(collection, props.filterField);
  const resolved: Partial<Fields<ListingProps>> = {
    ...(fields as Partial<Fields<ListingProps>>),
    collection: {
      type: "select",
      label: "Collection",
      options: [{ label: "Choose…", value: "" }, ...collections.map((c) => ({ label: c.settings.name, value: c.id }))],
    },
    filterField: { type: "select", label: "Only items with", options: fieldsOf(isChoiceField) },
    filterValue: {
      type: "select",
      label: "Choice",
      options: [NONE, ...(filterDefinition?.options ?? [])],
    },
    dateField: { type: "select", label: "Date", options: fieldsOf((field) => ["date", "event"].includes(field.type)) },
    sortField: {
      type: "select",
      label: "Field to order by",
      options: fieldsOf((field) => ["text", "number", "date", "event", "select"].includes(field.type)),
    },
    choicePages: { type: "select", label: "A page for each choice of", options: fieldsOf(isChoiceField) },
  };
  if (!props.filterField) delete resolved.filterValue;
  if (!props.dateField) delete resolved.show;
  if (props.order !== "field-asc" && props.order !== "field-desc") delete resolved.sortField;
  if (!props.paginate || !(props.limit > 0)) {
    delete resolved.previousLabel;
    delete resolved.nextLabel;
    delete resolved.pageTitle;
    if (!props.choicePages) delete resolved.pagesLabel;
  }
  if (!props.choicePages) delete resolved.allLabel;
  return resolved as Partial<Fields<Props>>;
}
