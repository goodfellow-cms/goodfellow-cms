import { type Collection, type Entry, entryTitle, markdownHeadings } from "@goodfellow-cms/core";
import { classNameField, SiteLink, templateOnly, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import { options } from "./options.js";
import { COLLECTION_NAV_PARTS, ENTRY_PAGER_PARTS, ON_THIS_PAGE_PARTS } from "./parts.js";

/** The collection a block is about: the one it names, or else the entry's own. */
function chosenCollection(id: string, collections: Collection[], own: Collection | undefined): Collection | undefined {
  return id ? collections.find((collection) => collection.id === id) : own;
}

function collectionChoices(collections: Collection[] | undefined) {
  return [
    { label: "This item's collection", value: "" },
    ...(collections ?? []).map((collection) => ({ label: collection.settings.name, value: collection.id })),
  ];
}

/** A collection's choice fields, which entries can be grouped by. */
function selectChoices(collection: Collection | undefined) {
  return (collection?.settings.fields ?? [])
    .filter((field) => field.type === "select")
    .map((field) => ({ label: field.label, value: field.name }));
}

export interface CollectionNavProps {
  collection: string;
  groupBy: string;
  heading: string;
  className: string;
}

/** Entries in the collection's order, grouped by a choice field in the order of its choices, then the ungrouped. */
function navGroups(collection: Collection, groupBy: string): Array<{ label: string; entries: Entry[] }> {
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

function CollectionNavView({ collection: id, groupBy, heading, className }: CollectionNavProps) {
  const { collections, collection: own, path } = useSite();
  const part = useParts();
  const collection = chosenCollection(id, collections, own);
  if (!collection) return null;
  return (
    <nav
      aria-label={heading || collection.settings.name}
      className={part("gf-collection-nav", "flex flex-col gap-6 text-sm", className)}
    >
      {heading && <p className={part("gf-collection-nav-heading", "font-heading font-semibold")}>{heading}</p>}
      {navGroups(collection, groupBy).map((group) => (
        <div key={group.label || "rest"} className={part("gf-collection-nav-group", "flex flex-col gap-2")}>
          {group.label && (
            <p className={part("gf-collection-nav-group-label", "font-semibold text-foreground")}>{group.label}</p>
          )}
          <ul className={part("gf-collection-nav-links", "flex flex-col gap-1 border-l border-border")}>
            {group.entries.map((entry) => {
              const current = entry.path === path;
              return (
                <li key={entry.slug}>
                  {entry.path ? (
                    <SiteLink
                      href={entry.path}
                      aria-current={current ? "page" : undefined}
                      className={part(
                        "gf-collection-nav-link",
                        "-ml-px block border-l py-1 pl-4 border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                        // The current page stays marked whatever the theme gives links.
                        current && "border-primary font-medium text-primary hover:border-primary hover:text-primary",
                      )}
                    >
                      {entryTitle(entry)}
                    </SiteLink>
                  ) : (
                    <span className={part("gf-collection-nav-link", "block py-1 pl-4 text-muted-foreground")}>
                      {entryTitle(entry)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Links to every item in a collection, grouped by one of its choice fields,
 * such as a documentation site's sidebar. The current page's item stands out.
 */
export const CollectionNav: ComponentConfig<CollectionNavProps> = withParts(
  {
    label: "Collection navigation",
    fields: {
      collection: { type: "select", label: "Collection", options: [] },
      groupBy: { type: "select", label: "Group by", options: [] },
      heading: { type: "text", label: "Heading" },
      className: classNameField,
    },
    defaultProps: { collection: "", groupBy: "", heading: "", className: "" },
    resolveFields: ({ props }, { fields, metadata }) => {
      const collections = (metadata.collections as Collection[] | undefined) ?? [];
      const collection = chosenCollection(props.collection, collections, metadata.collection as Collection | undefined);
      const choices = selectChoices(collection);
      return {
        ...fields,
        collection: { type: "select", label: "Collection", options: collectionChoices(collections) },
        groupBy: { type: "select", label: "Group by", options: [{ label: "Nothing", value: "" }, ...choices] },
      } as Fields<CollectionNavProps>;
    },
    render: (props) => <CollectionNavView {...props} />,
  },
  COLLECTION_NAV_PARTS,
);

export interface EntryPagerProps {
  groupBy: string;
  previousLabel: string;
  nextLabel: string;
  className: string;
}

function EntryPagerView({ groupBy, previousLabel, nextLabel, className }: EntryPagerProps) {
  const { collection, entry } = useSite();
  const part = useParts();
  if (!collection || !entry) return null;
  // In the order Collection navigation lists them, so reading on follows the sidebar.
  const linked = navGroups(collection, groupBy)
    .flatMap((group) => group.entries)
    .filter((candidate) => candidate.path);
  const index = linked.findIndex((candidate) => candidate.slug === entry.slug);
  if (index === -1) return null;
  const previous = linked[index - 1];
  const next = linked[index + 1];
  if (!previous && !next) return null;
  const card = part(
    "gf-entry-pager-link",
    "flex flex-col gap-1 rounded-lg border border-border p-4 hover:border-primary",
  );
  const label = part("gf-entry-pager-label", "text-sm text-muted-foreground");
  const title = part("gf-entry-pager-title", "font-medium");
  return (
    <nav
      aria-label={`${previousLabel}, ${nextLabel}`}
      className={part("gf-entry-pager", "grid gap-4 sm:grid-cols-2", className)}
    >
      {previous?.path ? (
        <SiteLink href={previous.path} rel="prev" className={card}>
          <span className={label}>{previousLabel}</span>
          <span className={title}>{entryTitle(previous)}</span>
        </SiteLink>
      ) : (
        <span />
      )}
      {next?.path && (
        <SiteLink
          href={next.path}
          rel="next"
          className={part(
            "gf-entry-pager-link",
            "flex flex-col gap-1 rounded-lg border border-border p-4 hover:border-primary",
            "sm:text-right",
          )}
        >
          <span className={label}>{nextLabel}</span>
          <span className={title}>{entryTitle(next)}</span>
        </SiteLink>
      )}
    </nav>
  );
}

const entryPager: ComponentConfig<EntryPagerProps> = {
  label: "Previous and next",
  fields: {
    groupBy: { type: "select", label: "Group by, as in Collection navigation", options: [] },
    previousLabel: { type: "text", label: "Word for the previous item" },
    nextLabel: { type: "text", label: "Word for the next item" },
    className: classNameField,
  },
  defaultProps: { groupBy: "", previousLabel: "Previous", nextLabel: "Next", className: "" },
  resolveFields: (_data, { fields, metadata }) => ({
    ...fields,
    groupBy: {
      type: "select",
      label: "Group by, as in Collection navigation",
      options: [{ label: "Nothing", value: "" }, ...selectChoices(metadata.collection as Collection | undefined)],
    },
  }),
  render: (props) => <EntryPagerView {...props} />,
};

/** Links to the items before and after this one, in the collection's order. Only offered in collection templates. */
export const EntryPager = templateOnly(withParts(entryPager, ENTRY_PAGER_PARTS));

type Depth = "2" | "3";

export interface OnThisPageProps {
  heading: string;
  depth: Depth;
  className: string;
}

function OnThisPageView({ heading, depth, className }: OnThisPageProps) {
  const { collection, entry } = useSite();
  const part = useParts();
  const body = collection?.settings.markdown?.body;
  const markdown = body ? entry?.content.fields[body] : undefined;
  if (typeof markdown !== "string") return null;
  const headings = markdownHeadings(markdown).filter((item) => item.depth >= 2 && item.depth <= Number(depth));
  if (headings.length === 0) return null;
  return (
    <nav aria-label={heading} className={part("gf-on-this-page", "flex flex-col gap-2 text-sm", className)}>
      {heading && <p className={part("gf-on-this-page-heading", "font-semibold")}>{heading}</p>}
      <ul className={part("gf-on-this-page-links", "flex flex-col gap-1")}>
        {headings.map((item) => (
          <li key={item.id} className={item.depth === 3 ? "pl-4" : undefined}>
            <SiteLink
              href={`#${item.id}`}
              className={part("gf-on-this-page-link", "block py-0.5 text-muted-foreground hover:text-foreground")}
            >
              {item.text}
            </SiteLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const onThisPage: ComponentConfig<OnThisPageProps> = {
  label: "On this page",
  fields: {
    heading: { type: "text", label: "Heading" },
    depth: {
      type: "radio",
      label: "Headings to list",
      options: options({ "2": "Main headings", "3": "And the ones under them" }),
    },
    className: classNameField,
  },
  defaultProps: { heading: "On this page", depth: "3", className: "" },
  render: (props) => <OnThisPageView {...props} />,
};

/**
 * Lists the headings of the item's text, linking to each, for items stored as
 * Markdown files. Only offered in collection templates.
 */
export const OnThisPage = templateOnly(withParts(onThisPage, ON_THIS_PAGE_PARTS));
