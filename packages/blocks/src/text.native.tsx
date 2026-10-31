import { richTextToPlainText, tableCells } from "@goodfellow-cms/core";
import { Blocks, Disclosure, RichText, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { ScrollView, StyleSheet, View } from "react-native";
import type {
  DetailsProps,
  PreformattedProps,
  PullquoteProps,
  SeparatorProps,
  TableProps,
  VerseProps,
} from "./text.js";

/** A line between parts of the page. */
export function Separator({ style = "default" }: SeparatorProps) {
  const { colors } = useNativeSite().theme;
  if (style === "dots") {
    return (
      <View accessible={false} style={{ flexDirection: "row", justifyContent: "center", gap: 20, marginVertical: 32 }}>
        {[0, 1, 2].map((dot) => (
          <View key={dot} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedForeground }} />
        ))}
      </View>
    );
  }
  return (
    <View
      accessibilityRole="none"
      style={{
        alignSelf: style === "wide" ? "stretch" : "center",
        width: style === "wide" ? undefined : 96,
        height: style === "wide" ? StyleSheet.hairlineWidth : 2,
        backgroundColor: colors.border,
        marginVertical: 32,
      }}
    />
  );
}

/** A quote shown large, with who said it. */
export function Pullquote({ quote, citation, align }: PullquoteProps) {
  const site = useNativeSite();
  const textAlign = align === "center" ? "center" : "left";
  return (
    <View
      style={{
        borderTopWidth: 4,
        borderBottomWidth: 4,
        borderColor: site.theme.colors.primary,
        paddingVertical: 32,
        marginVertical: 32,
        gap: 16,
      }}
    >
      <SiteText
        style={{
          fontFamily: site.theme.fonts.heading,
          fontSize: TEXT["2xl"],
          lineHeight: 32,
          textAlign,
        }}
      >
        {quote}
      </SiteText>
      {citation ? (
        <SiteText muted style={{ fontSize: TEXT.sm, textTransform: "uppercase", textAlign }}>
          {citation}
        </SiteText>
      ) : null}
    </View>
  );
}

/** Text exactly as it's typed, in a fixed-width font, scrolling sideways where it's wide. */
export function Preformatted({ text }: PreformattedProps) {
  const site = useNativeSite();
  if (!text) return null;
  return (
    <ScrollView
      horizontal
      style={{ backgroundColor: site.theme.colors.muted, borderRadius: site.theme.radius }}
      contentContainerStyle={{ padding: 16 }}
    >
      <SiteText selectable style={{ fontFamily: site.theme.fonts.mono ?? "monospace", fontSize: TEXT.sm }}>
        {text}
      </SiteText>
    </ScrollView>
  );
}

/** Poetry or lyrics: the lines and spaces as they're typed. */
export function Verse({ text }: VerseProps) {
  if (!text) return null;
  return <SiteText selectable>{text}</SiteText>;
}

/** A summary that opens to show more. */
export function Details({ summary, open, content }: DetailsProps) {
  return (
    <Disclosure summary={summary} open={open} style={{ marginVertical: 16 }}>
      <Blocks items={content} />
    </Disclosure>
  );
}

/** A table of text, which scrolls sideways where it's wider than the screen. */
export function Table({ id, cells, header, footer, caption, striped }: TableProps & { id?: string }) {
  const site = useNativeSite();
  const { colors } = site.theme;
  const rows = tableCells(cells);
  const head = header && rows.length > 1 ? rows[0] : undefined;
  const foot = footer && rows.length > (head ? 2 : 1) ? rows[rows.length - 1] : undefined;
  const body = rows.slice(head ? 1 : 0, foot ? -1 : undefined);
  const cell = { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 8, minWidth: 96, flex: 1 };
  // Each cell's formatting, as the content API gives it by the cell's row and column in the table.
  const formatted = (r: number, c: number) => (id ? site.richText(id, `cells.${r}.${c}`) : undefined);
  const row = (values: string[], r: number, bold: boolean, shaded: boolean) => (
    <View key={r} style={[{ flexDirection: "row" }, shaded && { backgroundColor: colors.muted }]}>
      {values.map((value, c) => {
        const nodes = formatted(r, c);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids
          <View key={c} style={cell}>
            {nodes ? (
              <RichText nodes={nodes} />
            ) : (
              <SiteText style={{ fontSize: TEXT.sm, ...(bold && { fontWeight: "600" }) }}>
                {richTextToPlainText(value)}
              </SiteText>
            )}
          </View>
        );
      })}
    </View>
  );
  const first = head ? 1 : 0;
  return (
    <View style={{ marginVertical: 24, gap: 8 }}>
      <ScrollView horizontal>
        <View accessibilityRole="grid" style={{ flexGrow: 1 }}>
          {head && row(head, 0, true, true)}
          {body.map((values, index) => row(values, first + index, false, striped && index % 2 === 1))}
          {foot && row(foot, rows.length - 1, true, false)}
        </View>
      </ScrollView>
      {caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {caption}
        </SiteText>
      ) : null}
    </View>
  );
}
