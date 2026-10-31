import { entryTitle } from "@goodfellow-cms/core";
import type { RichTextBlock } from "@goodfellow-cms/core/content-api";
import { NativeLink, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { View } from "react-native";
import type { CollectionNavProps, EntryPagerProps, OnThisPageProps } from "./docs.js";
import { chosenCollection, listedHeadings, navGroups } from "./docs-data.js";

/** Links to every item in a collection, grouped by one of its choice fields. The current page's item stands out. */
export function CollectionNav({ collection: id, groupBy, heading }: CollectionNavProps) {
  const { collections, collection: own, path, theme } = useNativeSite();
  const collection = chosenCollection(id, collections, own);
  if (!collection) return null;
  return (
    <View accessibilityLabel={heading || collection.settings.name} style={{ gap: 24 }}>
      {heading ? <SiteText style={{ fontFamily: theme.fonts.heading, fontWeight: "600" }}>{heading}</SiteText> : null}
      {navGroups(collection, groupBy).map((group) => (
        <View key={group.label || "rest"} style={{ gap: 8 }}>
          {group.label ? <SiteText style={{ fontWeight: "600" }}>{group.label}</SiteText> : null}
          <View style={{ borderLeftWidth: 1, borderColor: theme.colors.border }}>
            {group.entries.map((entry) => {
              const current = entry.path === path;
              const text = (
                <SiteText
                  key="title"
                  muted={!current}
                  style={{ fontSize: TEXT.sm, ...(current && { color: theme.colors.primary, fontWeight: "500" }) }}
                >
                  {entryTitle(entry)}
                </SiteText>
              );
              const style = {
                paddingVertical: 4,
                paddingLeft: 16,
                marginLeft: -1,
                borderLeftWidth: 1,
                borderColor: current ? theme.colors.primary : "transparent",
              };
              return entry.path ? (
                <NativeLink key={entry.slug} href={entry.path} style={style}>
                  {text}
                </NativeLink>
              ) : (
                <View key={entry.slug} style={style}>
                  {text}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Links to the items before and after this one, in the collection's order. */
export function EntryPager({ groupBy, previousLabel, nextLabel }: EntryPagerProps) {
  const { collection, entry, theme } = useNativeSite();
  if (!collection || !entry) return null;
  const linked = navGroups(collection, groupBy)
    .flatMap((group) => group.entries)
    .filter((candidate) => candidate.path);
  const index = linked.findIndex((candidate) => candidate.slug === entry.slug);
  if (index === -1) return null;
  const previous = linked[index - 1];
  const next = linked[index + 1];
  if (!previous && !next) return null;
  const card = (label: string, item: typeof previous, end: boolean) =>
    item?.path ? (
      <NativeLink
        href={item.path}
        style={{
          flex: 1,
          gap: 4,
          padding: 16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: theme.radius,
        }}
      >
        <SiteText muted style={{ fontSize: TEXT.sm, textAlign: end ? "right" : "left" }}>
          {label}
        </SiteText>
        <SiteText style={{ fontWeight: "500", textAlign: end ? "right" : "left" }}>{entryTitle(item)}</SiteText>
      </NativeLink>
    ) : (
      <View style={{ flex: 1 }} />
    );
  return (
    <View style={{ flexDirection: "row", gap: 16 }}>
      {card(previousLabel, previous, false)}
      {card(nextLabel, next, true)}
    </View>
  );
}

/** Headings, with their levels and ids, from rich text. */
function headingsOf(nodes: RichTextBlock[]): Array<{ id: string; level: number; text: string }> {
  return nodes.flatMap((node) => {
    if (node.type === "heading" && node.id) {
      const text = node.children.map((part) => ("text" in part ? part.text : "")).join("");
      return [{ id: node.id, level: node.level, text }];
    }
    return node.type === "quote" ? headingsOf(node.children) : [];
  });
}

/** Links to the page's headings: its Heading blocks, or the headings of an item's text stored as Markdown. */
export function OnThisPage({ heading, depth }: OnThisPageProps) {
  const site = useNativeSite();
  const { collection, entry } = site;
  const body = collection?.settings.markdown?.body;
  const nodes = body && entry ? collection.richText[entry.slug]?.[body] : undefined;
  const all = nodes
    ? headingsOf(nodes)
    : listedHeadings(undefined, undefined, site.headings, Number(depth)).map((item) => ({ ...item }));
  const headings = all.filter((item) => item.level >= 2 && item.level <= Number(depth));
  if (headings.length === 0) return null;
  return (
    <View accessibilityLabel={heading} style={{ gap: 8 }}>
      {heading ? <SiteText style={{ fontWeight: "600" }}>{heading}</SiteText> : null}
      {headings.map((item) => (
        <NativeLink key={item.id} href={`#${item.id}`} style={item.level === 3 ? { paddingLeft: 16 } : undefined}>
          <SiteText muted style={{ fontSize: TEXT.sm }}>
            {item.text}
          </SiteText>
        </NativeLink>
      ))}
    </View>
  );
}
