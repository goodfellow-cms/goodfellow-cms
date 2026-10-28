import { SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { ScrollView, Text, View } from "react-native";
import type { CodeProps } from "./code.js";
import { highlightedCode } from "./code-data.js";

/**
 * Code with the colors its build gave it, read from the highlighted HTML
 * (never shown as HTML), or plain where it has none. It can be selected to copy.
 */
export function Code({ code, html, title }: CodeProps) {
  const site = useNativeSite();
  const { colors, radius, dark, fonts } = site.theme;
  const colored = highlightedCode(html);
  const background = (dark ? colored?.darkBackground : undefined) ?? colored?.background ?? colors.muted;
  const color = (dark ? colored?.darkColor : undefined) ?? colored?.color ?? colors.foreground;
  const font = { fontFamily: fonts.mono ?? "monospace", fontSize: TEXT.sm, lineHeight: 20 };
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius,
        overflow: "hidden",
        marginVertical: 24,
      }}
    >
      {title ? (
        <View
          style={{
            backgroundColor: colors.muted,
            borderBottomWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          <SiteText muted style={font}>
            {title}
          </SiteText>
        </View>
      ) : null}
      <ScrollView horizontal style={{ backgroundColor: background }} contentContainerStyle={{ padding: 16 }}>
        <Text selectable style={[font, { color }]}>
          {colored
            ? colored.lines.map((line, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lines have no ids
                <Text key={index}>
                  {index > 0 ? "\n" : ""}
                  {line.map((token, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above
                    <Text key={at} style={{ color: (dark ? token.darkColor : undefined) ?? token.color ?? color }}>
                      {token.text}
                    </Text>
                  ))}
                </Text>
              ))
            : code}
        </Text>
      </ScrollView>
    </View>
  );
}
