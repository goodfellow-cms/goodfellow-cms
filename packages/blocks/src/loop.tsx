import type { Collection } from "@goodfellow-cms/core";
import { withPages } from "@goodfellow-cms/core";
import {
  classNameField,
  cx,
  type LoopItem,
  repeatsForEntries,
  type SiteContextValue,
  SiteLink,
  useParts,
  useSite,
  withParts,
} from "@goodfellow-cms/react";
import type { ComponentConfig, Fields, Slot, SlotComponent } from "@puckeditor/core";
import {
  ChoiceLinks,
  currentListing,
  type ListingProps,
  listingDefaults,
  listingFields,
  listingPages,
  PageLinks,
  PagesNotice,
  resolveListingFields,
} from "./listing.js";
import { type Gap, gapClasses, gapLabels, options, yesNo } from "./options.js";
import { COLLECTION_LOOP_PARTS } from "./parts.js";

type Columns = "1" | "2" | "3" | "4";

export interface CollectionLoopProps extends ListingProps {
  /** The blocks shown for each item, with placeholders such as `{title}` for its values. */
  design: Slot;
  /** The copies of `design`, one for each item, made where pages are built. */
  items: Slot;
  /** Set on each copy: the item it's for. */
  item?: LoopItem;
  columns: Columns;
  gap: Gap;
  /** Whether each item links to its page, if its collection gives items pages. */
  linkToPage: boolean;
  emptyText: string;
  className: string;
}

const columnClasses: Record<Columns, string> = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 md:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

type ViewProps = Omit<CollectionLoopProps, "design" | "items"> & {
  id?: string;
  design: SlotComponent;
  items: SlotComponent;
  isEditing: boolean;
};

function CollectionLoopView({
  design: Design,
  items: Items,
  item,
  columns,
  gap,
  linkToPage,
  emptyText,
  className,
  isEditing,
  ...props
}: ViewProps) {
  const site = useSite();
  const part = useParts();

  // One item's copy of the design.
  if (item) {
    return (
      <div className={part("gf-collection-loop-item", "relative flex flex-col")}>
        <Design className={part("gf-collection-loop-design", "flex flex-col gap-3")} />
        {linkToPage && item.path && (
          <SiteLink href={item.path} className="absolute inset-0">
            <span className="sr-only">{item.title}</span>
          </SiteLink>
        )}
      </div>
    );
  }

  const listing = currentListing(props, site);
  if (isEditing) {
    return (
      <div className={cx("flex flex-col gap-2 rounded-md border border-dashed border-border p-4", className)}>
        <p className="text-sm text-muted-foreground">
          {listing
            ? `Shown once for each item in ${listing.collection.settings.name}. Use {title} and the other fields' names in braces for their values.`
            : "Choose a collection, then design what each of its items shows here."}
        </p>
        {listing && <PagesNotice listing={listing} props={props} />}
        {/* The design, as wide as one item. */}
        <div className={cx("grid", columnClasses[columns], gapClasses[gap])}>
          <Design className="flex min-h-16 flex-col gap-3" />
        </div>
      </div>
    );
  }
  if (!listing) return null;

  return (
    <div className={part("gf-collection-loop", "flex flex-col gap-6", className)}>
      <ChoiceLinks listing={listing} props={props} />
      {listing.entries.length === 0 ? (
        emptyText && <p className={part("gf-collection-loop-empty", "text-muted-foreground")}>{emptyText}</p>
      ) : (
        <Items className={part("gf-collection-loop-items", "grid", columnClasses[columns], gapClasses[gap])} />
      )}
      <PageLinks listing={listing} props={props} />
    </div>
  );
}

const loopFields: Fields<CollectionLoopProps> = {
  ...listingFields,
  design: { type: "slot" },
  items: { type: "slot" },
  columns: { type: "select", label: "Items per row", options: options({ "1": "1", "2": "2", "3": "3", "4": "4" }) },
  gap: { type: "select", label: "Space between", options: options(gapLabels) },
  linkToPage: { type: "radio", label: "Each item links to its page", options: yesNo },
  emptyText: { type: "text", label: "Text when there's nothing to show" },
  className: classNameField,
};

const collectionLoop: ComponentConfig<CollectionLoopProps> = {
  label: "Collection loop",
  fields: loopFields,
  defaultProps: {
    ...listingDefaults,
    design: [],
    items: [],
    columns: "3",
    gap: "md",
    linkToPage: true,
    emptyText: "",
    className: "",
  },
  resolveFields: ({ props }, { fields, metadata }) => {
    const collections = (metadata.collections as Collection[] | undefined) ?? [];
    return resolveListingFields(
      fields,
      props,
      collections,
      metadata.collection as Collection | undefined,
    ) as Fields<CollectionLoopProps>;
  },
  render: ({ puck, ...props }) => <CollectionLoopView {...props} isEditing={puck.isEditing} />,
};

/**
 * Shows blocks designed in the editor once for each of a collection's items,
 * with each item's values in place of placeholders such as `{title}`, for
 * layouts Collection list's own don't cover. The copies are made where pages
 * are built (see `repeatsForEntries`), and like Collection list it can add
 * later pages and a page for each choice of a field (see `withPages`).
 */
export const CollectionLoop = withPages(
  repeatsForEntries(withParts(collectionLoop, COLLECTION_LOOP_PARTS), {
    design: "design",
    items: "items",
    entries: (props: CollectionLoopProps & { id?: string }, site: SiteContextValue) => {
      const listing = currentListing(props, site);
      return listing && { collection: listing.collection, entries: listing.entries };
    },
  }),
  listingPages,
);
