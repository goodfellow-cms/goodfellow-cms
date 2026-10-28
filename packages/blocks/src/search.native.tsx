import { entryTitle } from "@goodfellow-cms/core";
import { NativeLink, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import type { SearchProps } from "./search.js";

/** At most this many results show at once. */
const MAX_RESULTS = 20;

/**
 * A search box for the site's pages and items, by their titles and
 * summaries, which the app has with it, so it works offline too. The
 * website's search reads pages' text, which the app doesn't keep for every page.
 */
export function Search({ label, placeholder, noResults }: SearchProps) {
  const site = useNativeSite();
  const { colors, radius } = site.theme;
  const [query, setQuery] = useState("");
  const all = useMemo(
    () => [
      ...site.pages.map((page) => ({ path: page.path, title: page.title, text: page.title })),
      ...site.collections.flatMap((collection) =>
        collection.entries.flatMap((entry) =>
          entry.path
            ? [
                {
                  path: entry.path,
                  title: entryTitle(entry),
                  text: Object.values(entry.content.fields)
                    .filter((value): value is string => typeof value === "string")
                    .join(" "),
                },
              ]
            : [],
        ),
      ),
    ],
    [site.pages, site.collections],
  );
  const words = query.toLocaleLowerCase(site.settings.language).split(/\s+/).filter(Boolean);
  const found =
    words.length === 0
      ? []
      : all
          .filter((item) => {
            const text = `${item.title} ${item.text}`.toLocaleLowerCase(site.settings.language);
            return words.every((word) => text.includes(word));
          })
          .slice(0, MAX_RESULTS);
  return (
    <View style={{ gap: 12, width: "100%", maxWidth: 384 }}>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius,
          paddingHorizontal: 12,
          paddingVertical: 8,
          color: colors.foreground,
          backgroundColor: colors.background,
          fontSize: TEXT.base,
        }}
      />
      {words.length > 0 && found.length === 0 ? (
        <SiteText muted>{noResults.replace("{query}", query.trim())}</SiteText>
      ) : null}
      {found.map((item) => (
        <NativeLink key={item.path} href={item.path}>
          <SiteText style={{ color: colors.primary }}>{item.title}</SiteText>
        </NativeLink>
      ))}
    </View>
  );
}
