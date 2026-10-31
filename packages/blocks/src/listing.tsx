/**
 * What Collection list and Collection loop share on the web: the links
 * between their pages, and their fields. What they show is in
 * `listing-data.ts`, which their native versions share.
 */

import { type Collection, type CollectionField, isChoiceField } from "@goodfellow-cms/core";
import { type SiteContextValue, SiteLink, useParts, useSite } from "@goodfellow-cms/react";
import type { Fields } from "@puckeditor/core";
import {
  choicePageList,
  fieldOf,
  type Listing,
  type ListingProps,
  listingDefaults,
  listingPath,
  MAX_LIMIT,
} from "./listing-data.js";
import { options, yesNo } from "./options.js";

export {
  choicePageList,
  currentListing,
  type Listing,
  type ListingProps,
  listingDefaults,
  listingPages,
  listingPath,
  type Order,
  type Show,
  selectedEntries,
} from "./listing-data.js";

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
  return (
    listing.pages > 1 ||
    (!props.linkedFrom && !!props.choicePages && choicePageList(listing.collection, props.choicePages).length > 0)
  );
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
  linkedFrom: { type: "select", label: "Only the items this one links to, in", options: [NONE] },
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
  /** In a collection's template, that collection, whose items' links the list can follow. */
  template?: Collection,
): Partial<Fields<Props>> {
  const collection = collections.find((candidate) => candidate.id === props.collection);
  const fieldsOf = (accept: (field: CollectionField) => boolean) => [
    NONE,
    ...(collection?.settings.fields ?? []).filter(accept).map((field) => ({ label: field.label, value: field.name })),
  ];
  const filterDefinition = collection && fieldOf(collection, props.filterField);
  const linkFields = (template?.settings.fields ?? []).filter(
    (field) => field.type === "item" && !!props.collection && field.collection === props.collection,
  );
  const resolved: Partial<Fields<ListingProps>> = {
    ...(fields as Partial<Fields<ListingProps>>),
    collection: {
      type: "select",
      label: "Collection",
      options: [{ label: "Choose…", value: "" }, ...collections.map((c) => ({ label: c.settings.name, value: c.id }))],
    },
    filterField: {
      type: "select",
      label: "Only items with",
      options: fieldsOf((field) => isChoiceField(field) || field.type === "yesno"),
    },
    linkedFrom: {
      type: "select",
      label: "Only the items this one links to, in",
      options: [NONE, ...linkFields.map((field) => ({ label: field.label, value: field.name }))],
    },
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
  if (!props.filterField || filterDefinition?.type === "yesno") delete resolved.filterValue;
  if (linkFields.length === 0 && !props.linkedFrom) delete resolved.linkedFrom;
  if (props.linkedFrom) {
    delete resolved.paginate;
    delete resolved.choicePages;
  }
  if (!props.dateField) delete resolved.show;
  if (props.order !== "field-asc" && props.order !== "field-desc") delete resolved.sortField;
  if (!props.paginate || !(props.limit > 0) || props.linkedFrom) {
    delete resolved.previousLabel;
    delete resolved.nextLabel;
    delete resolved.pageTitle;
    if (!props.choicePages) delete resolved.pagesLabel;
  }
  if (!props.choicePages || props.linkedFrom) delete resolved.allLabel;
  return resolved as Partial<Fields<Props>>;
}
