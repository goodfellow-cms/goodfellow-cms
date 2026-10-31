import {
  type Collection,
  type CollectionField,
  codeStyle,
  type Entry,
  entryTitle,
  type FieldType,
  formatFieldValue,
  type GroupField,
  groupRows,
  imagesOf,
  isDateValue,
  isEmptyValue,
  isEventLike,
  linkedItem,
  linkedItems,
  type MarkdownOptions,
  type MarkdownPart,
  markdownParts,
  markdownText,
  type SiteSettings,
  shownOccurrence,
  todayIn,
  withPages,
} from "@goodfellow-cms/core";
import {
  classNameField,
  cx,
  SiteImage,
  SiteLink,
  templateOnly,
  useParts,
  useSite,
  withParts,
} from "@goodfellow-cms/react";
import type { ComponentConfig, Fields, RichText } from "@puckeditor/core";
import type { ReactNode } from "react";
import { CodeView } from "./code.js";
import { highlightCode, loadHighlighter } from "./highlight.js";
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
  selectedEntries,
} from "./listing.js";
import { options } from "./options.js";
import { COLLECTION_LIST_PARTS, ENTRY_FIELD_PARTS } from "./parts.js";

type FieldChoice = { label: string; value: string };

function fieldChoices(collection: Collection | undefined, types?: FieldType[]): FieldChoice[] {
  return (collection?.settings.fields ?? [])
    .filter((field) => !types || types.includes(field.type))
    .map((field) => ({ label: field.label, value: field.name }));
}

const NONE: FieldChoice = { label: "None", value: "" };

type Style = "text" | "title" | "heading" | "small";

const styleClasses: Record<Style, string> = {
  text: "",
  title: "text-4xl md:text-5xl font-bold tracking-tight text-balance",
  heading: "text-3xl md:text-4xl font-bold tracking-tight text-balance",
  small: "text-sm text-muted-foreground",
};

export interface EntryFieldProps {
  field: string;
  style: Style;
  /** The field's rich text, filled in when an entry's page is built. */
  value?: RichText;
  /** In a collection of Markdown files, the body rendered from its Markdown, filled in when the page is built. */
  markdown?: MarkdownPart[];
  /** The label of code blocks' copy buttons in Markdown, or empty for none. */
  copyLabel: string;
  className: string;
}

/** Markdown rendered by `markdownParts()`, which escapes HTML and leaves out unsafe addresses. */
function MarkdownBody({
  parts,
  copyLabel,
  className,
}: {
  parts: MarkdownPart[];
  copyLabel: string;
  className: string;
}) {
  const part = useParts();
  return (
    <div className={part("gf-entry-field", "gf-prose", className)}>
      {parts.map((piece, index) =>
        piece.kind === "code" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no ids, and only change all together
          <CodeView key={index} html={piece.html} copyLabel={copyLabel || undefined} />
        ) : (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            key={index}
            className="contents"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markdownParts() escapes HTML and leaves out unsafe addresses
            dangerouslySetInnerHTML={{ __html: piece.html }}
          />
        ),
      )}
    </div>
  );
}

function EntryFieldView({ field, style, value, markdown, copyLabel, className }: EntryFieldProps) {
  const { collection, entry, settings } = useSite();
  const part = useParts();
  const definition: CollectionField | undefined = collection?.settings.fields.find(
    (candidate) => candidate.name === field,
  );

  // Templates are edited without an entry, so show which field goes here.
  if (!entry) {
    return (
      <div
        className={cx(
          "rounded-md border border-dashed border-border px-3 py-2 text-muted-foreground",
          styleClasses[style],
          className,
        )}
      >
        {definition?.label ?? field}
      </div>
    );
  }

  const raw = entry.content.fields[field];
  if (!definition || isEmptyValue(raw)) return null;

  if (markdown) return <MarkdownBody parts={markdown} copyLabel={copyLabel} className={className} />;

  switch (definition.type) {
    case "richtext":
      return <div className={part("gf-entry-field", "gf-prose", className)}>{value}</div>;
    case "image":
      return (
        <SiteImage
          src={String(raw)}
          alt={entryTitle(entry)}
          className={part("gf-entry-field", "w-full rounded-lg", className)}
        />
      );
    case "link":
      return (
        <p className={part("gf-entry-field", styleClasses[style], className)}>
          <SiteLink
            href={String(raw)}
            className={part("gf-entry-field-link", "text-primary underline underline-offset-2")}
          >
            {String(raw)}
          </SiteLink>
        </p>
      );
    case "textarea":
      return (
        <p className={part("gf-entry-field", ["whitespace-pre-line", styleClasses[style]], className)}>{String(raw)}</p>
      );
    case "file":
      return (
        <p className={part("gf-entry-field", styleClasses[style], className)}>
          <SiteLink
            href={String(raw)}
            download
            className={part("gf-entry-field-link", "text-primary underline underline-offset-2")}
          >
            {fileName(String(raw))}
          </SiteLink>
        </p>
      );
    case "images":
      return (
        <div className={part("gf-entry-field", "grid grid-cols-2 gap-3 sm:grid-cols-3", className)}>
          {imagesOf(raw).map((src) => (
            <SiteImage
              key={src}
              src={src}
              alt=""
              className={part("gf-entry-field-image", "aspect-square w-full rounded-lg object-cover")}
            />
          ))}
        </div>
      );
    case "item":
      return <ItemLinks field={definition} value={raw} style={style} className={className} />;
    case "group":
      return <GroupRows fields={definition.fields ?? []} value={raw} className={className} />;
    default: {
      const text = formatFieldValue(definition, raw, settings.language, settings.timeZone);
      let content: ReactNode = text;
      if (definition.type === "date") content = <time dateTime={String(raw)}>{text}</time>;
      if (definition.type === "event" && isEventLike(raw)) {
        const shown = shownOccurrence(raw, todayIn(settings.timeZone));
        content = <time dateTime={shown?.start ?? raw.start}>{text}</time>;
      }
      const Tag = style === "title" ? "h1" : style === "heading" ? "h2" : "p";
      return <Tag className={part("gf-entry-field", styleClasses[style], className)}>{content}</Tag>;
    }
  }
}

/** A file's name from its address, as people would know it. */
function fileName(address: string): string {
  const name = address.slice(address.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name) || address;
  } catch {
    return name || address;
  }
}

/** The items a field links to, by their titles, linked to their pages where they have them. */
function ItemLinks({
  field,
  value,
  style,
  className,
}: {
  field: CollectionField;
  value: unknown;
  style: Style;
  className: string;
}) {
  const { collections } = useSite();
  const part = useParts();
  const target = collections.find((candidate) => candidate.id === field.collection);
  const items = linkedItems(field, value).flatMap((slug) => {
    const item = linkedItem(target, slug);
    return item ? [item] : [];
  });
  if (items.length === 0) return null;
  const Tag = style === "title" ? "h1" : style === "heading" ? "h2" : "p";
  return (
    <Tag className={part("gf-entry-field", styleClasses[style], className)}>
      {items.map((item, index) => (
        <span key={item.slug}>
          {index > 0 && ", "}
          {item.path ? (
            <SiteLink
              href={item.path}
              className={part("gf-entry-field-link", "text-primary underline underline-offset-2")}
            >
              {entryTitle(item)}
            </SiteLink>
          ) : (
            entryTitle(item)
          )}
        </span>
      ))}
    </Tag>
  );
}

/** A repeating group's rows, each its values one after another. */
function GroupRows({ fields, value, className }: { fields: GroupField[]; value: unknown; className: string }) {
  const { settings } = useSite();
  const part = useParts();
  const rows = groupRows(value);
  return (
    <ul className={part("gf-entry-field", "divide-y divide-border", className)}>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids, and only change all together
        <li key={index} className={part("gf-entry-field-row", "flex flex-wrap items-center gap-x-3 gap-y-1 py-2")}>
          {fields.map((sub) => {
            const item = row[sub.name];
            if (isEmptyValue(item)) return null;
            if (sub.type === "image") {
              return (
                <SiteImage key={sub.name} src={String(item)} alt="" className="h-12 w-12 rounded-md object-cover" />
              );
            }
            if (sub.type === "link") {
              return (
                <SiteLink
                  key={sub.name}
                  href={String(item)}
                  className={part("gf-entry-field-link", "text-primary underline underline-offset-2")}
                >
                  {sub.label}
                </SiteLink>
              );
            }
            const text = formatFieldValue(sub, item, settings.language, settings.timeZone);
            return sub.type === "date" ? (
              <time key={sub.name} dateTime={String(item)}>
                {text}
              </time>
            ) : (
              <span key={sub.name} className={sub.type === "textarea" ? "whitespace-pre-line" : undefined}>
                {text}
              </span>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

const entryField: ComponentConfig<EntryFieldProps> = {
  label: "Entry field",
  fields: {
    field: { type: "select", label: "Field", options: [] },
    style: {
      type: "select",
      label: "Show as",
      options: options({ text: "Text", title: "Page title", heading: "Heading", small: "Small text" }),
    },
    // Filled in from the entry, so Puck renders it like any rich text: sanitized.
    value: { type: "richtext", visible: false },
    copyLabel: { type: "text", label: "Copy button's label, for code in Markdown (leave empty for none)" },
    className: classNameField,
  },
  defaultProps: { field: "title", style: "text", copyLabel: "Copy code", className: "" },
  resolveFields: (_data, { fields, metadata }) => {
    const choices = fieldChoices(metadata.collection as Collection | undefined);
    return { ...fields, field: { type: "select", label: "Field", options: choices } };
  },
  resolveData: async ({ props }, { metadata }) => {
    const collection = metadata.collection as Collection | undefined;
    const entry = metadata.entry as Entry | undefined;
    const definition = collection?.settings.fields.find((candidate) => candidate.name === props.field);
    const raw = entry?.content.fields[props.field];
    // A Markdown file's body isn't HTML, so it's rendered here, with its code highlighted, rather than by Puck.
    if (collection?.settings.markdown?.body === props.field && typeof raw === "string") {
      const settings = metadata.site as SiteSettings | undefined;
      const style = codeStyle(settings?.theme);
      const shiki = /^ {0,3}(```|~~~)/m.test(raw) ? await loadHighlighter(style) : undefined;
      const markdownOptions: MarkdownOptions = {
        externalLinks: { newTab: settings?.externalLinksInNewTab === true, siteUrl: settings?.url },
      };
      if (shiki) markdownOptions.highlight = (code, language) => highlightCode(shiki, code, language, "page", style);
      const markdown = markdownParts(raw, markdownOptions);
      return { props: { ...props, value: undefined, markdown } };
    }
    return {
      props: {
        ...props,
        value: definition?.type === "richtext" && typeof raw === "string" ? raw : undefined,
        markdown: undefined,
      },
    };
  },
  render: (props) => <EntryFieldView {...props} />,
};

/** Shows one field of the entry whose page is being built. Only offered in collection templates. */
export const EntryField = templateOnly(withParts(entryField, ENTRY_FIELD_PARTS));

type Layout = "list" | "cards";
type Columns = "2" | "3" | "4";

export interface CollectionListProps extends ListingProps {
  /** A heading above the list, and a link beside it, such as "See all" to a page with every item. */
  heading: string;
  moreLabel: string;
  moreHref: string;
  layout: Layout;
  columns: Columns;
  imageField: string;
  summaryField: string;
  emptyText: string;
  className: string;
}

const columnClasses: Record<Columns, string> = {
  "2": "sm:grid-cols-2",
  "3": "sm:grid-cols-2 lg:grid-cols-3",
  "4": "sm:grid-cols-2 lg:grid-cols-4",
};

/** The entries a list shows, in order. `now` is today's date: pages are rebuilt nightly to keep it current. */
export function listedEntries(
  collection: Collection,
  props: Pick<ListingProps, "dateField" | "order" | "show" | "limit"> & Partial<ListingProps>,
  now = todayIn(undefined),
): Entry[] {
  const entries = selectedEntries(collection, { ...listingDefaults, ...props }, now);
  return props.limit > 0 ? entries.slice(0, props.limit) : entries;
}

/** The names of a list's items' parts, as cards or as rows. */
const ITEM_PARTS = {
  cards: {
    item: "gf-card",
    image: "gf-card-image",
    body: "gf-card-body",
    date: "gf-card-date",
    title: "gf-card-title",
    summary: "gf-card-summary",
  },
  list: {
    item: "gf-list-item",
    image: "gf-list-item-image",
    body: "gf-list-item-body",
    date: "gf-list-item-date",
    title: "gf-list-item-title",
    summary: "gf-list-item-summary",
  },
} as const;

function CollectionListView({
  heading,
  moreLabel,
  moreHref,
  layout,
  columns,
  imageField,
  summaryField,
  emptyText,
  className,
  isEditing,
  ...props
}: CollectionListProps & { id?: string; isEditing: boolean }) {
  const site = useSite();
  const part = useParts();
  const { settings } = site;
  const listing = currentListing(props, site);
  if (!listing) {
    return isEditing ? (
      <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>
        Choose a collection to list.
      </p>
    ) : null;
  }

  const { collection, entries } = listing;
  const { dateField } = props;
  const fieldOf = (name: string) => collection.settings.fields.find((field) => field.name === name);
  const cards = layout === "cards";
  const names = ITEM_PARTS[cards ? "cards" : "list"];

  // A list on its own is just the list; with a heading or links to its other pages, they go around it.
  const top = heading || (moreLabel && moreHref);
  // Items' titles go under the list's heading, or, without one, are headings of their own on the page.
  const ItemTitle = heading ? "h3" : "h2";
  const alone = !top && !props.choicePages && listing.pages <= 1;
  const own = alone ? className : "";
  const list =
    entries.length === 0 ? (
      emptyText ? (
        <p className={part("gf-collection-list-empty", "text-muted-foreground", own)}>{emptyText}</p>
      ) : null
    ) : (
      <ul
        className={part(
          "gf-collection-list-items",
          cards ? "grid gap-6" : "flex flex-col divide-y divide-border",
          cards && columnClasses[columns],
          own,
        )}
      >
        {entries.map((entry) => {
          const values = entry.content.fields;
          const image = imageField && !isEmptyValue(values[imageField]) ? String(values[imageField]) : undefined;
          const dateValue = dateField ? values[dateField] : undefined;
          const shown = isEventLike(dateValue) ? shownOccurrence(dateValue, todayIn(settings.timeZone)) : undefined;
          const date = shown ? shown.start : isDateValue(dateValue) ? dateValue : undefined;
          const summaryValue = summaryField ? values[summaryField] : undefined;
          const summary = !summaryField
            ? ""
            : collection.settings.markdown?.body === summaryField && typeof summaryValue === "string"
              ? markdownText(summaryValue)
              : formatFieldValue(fieldOf(summaryField), summaryValue, settings.language);
          const title = entryTitle(entry);

          return (
            <li key={entry.slug} className={cards ? "flex" : "py-4 first:pt-0 last:pb-0"}>
              <article
                className={part(names.item, [
                  "relative flex",
                  cards ? "w-full flex-col overflow-hidden rounded-lg border border-border" : "items-start gap-4",
                ])}
              >
                {image && (
                  <SiteImage
                    src={image}
                    alt=""
                    // Each item's title says what it is; its picture adds nothing for people who can't see it.
                    aria-hidden
                    loading="lazy"
                    className={part(
                      names.image,
                      cards ? "aspect-video w-full object-cover" : "aspect-video w-32 shrink-0 rounded-md object-cover",
                    )}
                  />
                )}
                <div className={part(names.body, ["flex flex-col gap-1", cards && "p-4"])}>
                  {date && (
                    <time dateTime={date} className={part(names.date, "text-sm text-muted-foreground")}>
                      {formatFieldValue(fieldOf(dateField), dateValue, settings.language, settings.timeZone)}
                    </time>
                  )}
                  <ItemTitle className={part(names.title, "font-heading text-lg font-semibold")}>
                    {entry.path ? (
                      <SiteLink href={entry.path} className="after:absolute after:inset-0 hover:underline">
                        {title}
                      </SiteLink>
                    ) : (
                      title
                    )}
                  </ItemTitle>
                  {summary && <p className={part(names.summary, "line-clamp-3 text-muted-foreground")}>{summary}</p>}
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    );

  if (alone) return list;
  return (
    <section className={part("gf-collection-list", "flex flex-col gap-6", className)}>
      {top && (
        <div
          className={part("gf-collection-list-header", "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2")}
        >
          {heading && (
            <h2 className={part("gf-collection-list-heading", "font-heading text-2xl font-bold tracking-tight")}>
              {heading}
            </h2>
          )}
          {moreLabel && moreHref && (
            <SiteLink href={moreHref} className={part("gf-collection-list-more", "text-primary hover:underline")}>
              {moreLabel} →
            </SiteLink>
          )}
        </div>
      )}
      {isEditing && <PagesNotice listing={listing} props={props} />}
      <ChoiceLinks listing={listing} props={props} />
      {list}
      <PageLinks listing={listing} props={props} />
    </section>
  );
}

const listFields: Fields<CollectionListProps> = {
  heading: { type: "text", label: "Heading (leave empty for none)" },
  moreLabel: { type: "text", label: 'Link beside the heading, such as "See all" (leave empty for none)' },
  moreHref: { type: "text", label: "Where the link goes, such as /news" },
  ...listingFields,
  layout: { type: "radio", label: "Layout", options: options({ list: "List", cards: "Cards" }) },
  columns: { type: "radio", label: "Cards per row", options: options({ "2": "2", "3": "3", "4": "4" }) },
  imageField: { type: "select", label: "Picture", options: [NONE] },
  summaryField: { type: "select", label: "Summary", options: [NONE] },
  emptyText: { type: "text", label: "Text when there's nothing to show" },
  className: classNameField,
};

const collectionList: ComponentConfig<CollectionListProps> = {
  label: "Collection list",
  fields: listFields,
  defaultProps: {
    heading: "",
    moreLabel: "",
    moreHref: "",
    ...listingDefaults,
    layout: "cards",
    columns: "3",
    imageField: "",
    summaryField: "",
    emptyText: "",
    className: "",
  },
  resolveFields: ({ props }, { fields, metadata }) => {
    const collections = (metadata.collections as Collection[] | undefined) ?? [];
    const collection = collections.find((candidate) => candidate.id === props.collection);
    const choose = (types: FieldType[]) => [NONE, ...fieldChoices(collection, types)];
    const resolved: Partial<Fields<CollectionListProps>> = {
      ...resolveListingFields(fields, props, collections, metadata.collection as Collection | undefined),
      imageField: { type: "select", label: "Picture", options: choose(["image"]) },
      summaryField: { type: "select", label: "Summary", options: choose(["text", "textarea", "richtext"]) },
    };
    if (props.layout !== "cards") delete resolved.columns;
    if (!props.moreLabel) delete resolved.moreHref;
    return resolved as Fields<CollectionListProps>;
  },
  render: ({ puck, ...props }) => <CollectionListView {...props} isEditing={puck.isEditing} />,
};

/**
 * Lists a collection's entries, such as the latest videos or upcoming events,
 * linking to each entry's page if the collection has them. Long lists can go
 * on several pages, and a choice field can give each of its choices a page
 * (see `withPages`).
 */
export const CollectionList = withPages(withParts(collectionList, COLLECTION_LIST_PARTS), listingPages);
