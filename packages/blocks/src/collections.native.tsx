import {
  entryTitle,
  formatFieldValue,
  isDateValue,
  isEmptyValue,
  isEventLike,
  richTextToPlainText,
  shownOccurrence,
  todayIn,
} from "@goodfellow-cms/core";
import {
  Columns,
  NativeImage,
  NativeLink,
  RichText,
  SiteText,
  TEXT,
  useNativeSite,
  useWide,
} from "@goodfellow-cms/expo";
import { View } from "react-native";
import type { CollectionListProps, EntryFieldProps } from "./collections.js";
import { ChoiceLinks, PageLinks } from "./listing.native.js";
import { currentListing, fieldOf } from "./listing-data.js";

const STYLES = {
  text: {},
  title: { fontSize: TEXT["4xl"], lineHeight: 44, fontWeight: "700" },
  heading: { fontSize: TEXT["3xl"], lineHeight: 36, fontWeight: "700" },
  small: { fontSize: TEXT.sm },
} as const;

/** One field of the item whose page this is, its rich text and Markdown from the content API's structure of them. */
export function EntryField({ id, field, style }: EntryFieldProps & { id?: string }) {
  const site = useNativeSite();
  const { collection, entry, settings } = site;
  if (!collection || !entry) return null;
  const definition = fieldOf(collection, field);
  const raw = entry.content.fields[field];
  if (!definition || isEmptyValue(raw)) return null;
  const isMarkdown = collection.settings.markdown?.body === field;
  if (isMarkdown || definition.type === "richtext") {
    const nodes =
      (id && (site.richText(id, "markdown") ?? site.richText(id, "value"))) || collection.richText[entry.slug]?.[field];
    return <RichText nodes={nodes} />;
  }
  switch (definition.type) {
    case "image":
      return <NativeImage src={String(raw)} alt={entryTitle(entry)} aspect="auto" />;
    case "link":
      return (
        <NativeLink href={String(raw)}>
          <SiteText style={{ color: site.theme.colors.primary, textDecorationLine: "underline" }}>
            {String(raw)}
          </SiteText>
        </NativeLink>
      );
    default: {
      const text =
        definition.type === "textarea"
          ? String(raw)
          : formatFieldValue(definition, raw, settings.language, settings.timeZone);
      const level = style === "title" ? 1 : style === "heading" ? 2 : undefined;
      return (
        <SiteText muted={style === "small"} {...(level && { heading: level })} style={STYLES[style] ?? {}}>
          {text}
        </SiteText>
      );
    }
  }
}

const CARD_COLUMNS = {
  "2": { base: 1, sm: 2 },
  "3": { base: 1, sm: 2, lg: 3 },
  "4": { base: 1, sm: 2, lg: 4 },
} as const;

/** A collection's items, as cards or a list, linking to each item's page where the collection gives them pages. */
export function CollectionList({
  heading,
  moreLabel,
  moreHref,
  layout,
  columns,
  imageField,
  summaryField,
  emptyText,
  ...props
}: CollectionListProps & { id?: string }) {
  const site = useNativeSite();
  const wide = useWide("sm");
  const { settings, theme } = site;
  const listing = currentListing(props, site);
  if (!listing) return null;
  const { collection, entries } = listing;
  const { dateField } = props;
  const cards = layout === "cards";
  const today = todayIn(settings.timeZone);

  const items = entries.map((entry) => {
    const values = entry.content.fields;
    const image = imageField && !isEmptyValue(values[imageField]) ? String(values[imageField]) : undefined;
    const dateValue = dateField ? values[dateField] : undefined;
    const shown = isEventLike(dateValue) ? shownOccurrence(dateValue, today) : undefined;
    const dated = shown !== undefined || isDateValue(dateValue);
    const summaryValue = summaryField ? values[summaryField] : undefined;
    const summaryType = summaryField ? fieldOf(collection, summaryField)?.type : undefined;
    // Rich text and Markdown bodies arrive as HTML; summaries show their words.
    const summary = !summaryField
      ? ""
      : typeof summaryValue === "string" &&
          (summaryType === "richtext" || collection.settings.markdown?.body === summaryField)
        ? richTextToPlainText(summaryValue)
        : formatFieldValue(fieldOf(collection, summaryField), summaryValue, settings.language);
    const title = entryTitle(entry);
    const body = (
      <View key="body" style={[{ gap: 4 }, cards ? { padding: 16 } : { flex: 1 }]}>
        {dated ? (
          <SiteText muted style={{ fontSize: TEXT.sm }}>
            {formatFieldValue(fieldOf(collection, dateField), dateValue, settings.language, settings.timeZone)}
          </SiteText>
        ) : null}
        <SiteText
          heading={heading ? 3 : 2}
          style={{ fontFamily: theme.fonts.heading, fontSize: TEXT.lg, fontWeight: "600" }}
        >
          {title}
        </SiteText>
        {summary ? (
          <SiteText muted numberOfLines={3}>
            {summary}
          </SiteText>
        ) : null}
      </View>
    );
    const picture = image ? (
      <NativeImage
        key="picture"
        src={image}
        alt=""
        aspect="wide"
        rounded={!cards}
        style={cards ? undefined : { width: 128 }}
      />
    ) : null;
    const style = cards
      ? {
          overflow: "hidden" as const,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius,
          height: "100%" as const,
        }
      : { flexDirection: "row" as const, gap: 16, alignItems: "flex-start" as const, paddingVertical: 16 };
    const inside = (
      <>
        {picture}
        {body}
      </>
    );
    return entry.path ? (
      <NativeLink key={entry.slug} href={entry.path} label={title} style={style}>
        {inside}
      </NativeLink>
    ) : (
      <View key={entry.slug} style={style}>
        {inside}
      </View>
    );
  });

  const list =
    entries.length === 0 ? (
      emptyText ? (
        <SiteText muted>{emptyText}</SiteText>
      ) : null
    ) : cards ? (
      <Columns columns={CARD_COLUMNS[columns] ?? CARD_COLUMNS["3"]} gap={24}>
        {items}
      </Columns>
    ) : (
      <View>
        {items.map((item, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: the items have their own keys inside
            key={index}
            style={index > 0 ? { borderTopWidth: 1, borderColor: theme.colors.border } : undefined}
          >
            {item}
          </View>
        ))}
      </View>
    );

  return (
    <View style={{ gap: 24 }}>
      {heading || (moreLabel && moreHref) ? (
        <View
          style={{
            flexDirection: wide ? "row" : "column",
            justifyContent: "space-between",
            alignItems: wide ? "baseline" : "flex-start",
            gap: 8,
          }}
        >
          {heading ? (
            <SiteText heading={2} style={{ fontFamily: theme.fonts.heading, fontSize: TEXT["2xl"], fontWeight: "700" }}>
              {heading}
            </SiteText>
          ) : null}
          {moreLabel && moreHref ? (
            <NativeLink href={moreHref}>
              <SiteText style={{ color: theme.colors.primary }}>{moreLabel} →</SiteText>
            </NativeLink>
          ) : null}
        </View>
      ) : null}
      <ChoiceLinks listing={listing} props={props} />
      {list}
      <PageLinks listing={listing} props={props} />
    </View>
  );
}
