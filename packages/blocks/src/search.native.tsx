import { entryTitle } from "@goodfellow-cms/core";
import { type SiteSearch, type SiteSearchResult, siteSearch } from "@goodfellow-cms/core/site-search";
import { NativeLink, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
import { useEffect, useMemo, useState } from "react";
import { TextInput, View } from "react-native";
import type { SearchProps } from "./search.js";

/** At most this many results show at once where the app searches titles alone. */
const MAX_RESULTS = 20;

/**
 * A search box for the site, which works offline too. Where the site searches
 * with MiniSearch in apps (`content/site.json`'s `search.engine`), it searches
 * the index the build wrote from the pages' text with `siteSearch()`, as the
 * website's Search box does where it searches with MiniSearch too, so both
 * find the same. Otherwise the app has no index of pages' text, so it finds
 * pages by their titles and items by their values (`TitleResults`).
 */
export function Search(props: SearchProps) {
  const site = useNativeSite();
  const key = site.searchIndex?.key;
  const read = site.searchIndex?.read;
  // `search` is left out where the index couldn't be read, which finds by titles rather than not at all.
  const [loaded, setLoaded] = useState<{ key: string; search?: SiteSearch }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: read is made again with the site; key names the file it reads.
  useEffect(() => {
    if (!key || !read) return;
    let current = true;
    read()
      .catch(() => undefined)
      .then((file) => {
        if (current) setLoaded(file ? { key, search: siteSearch(file) } : { key });
      });
    return () => {
      current = false;
    };
  }, [key]);
  const index = key === undefined ? "none" : !loaded || loaded.key !== key ? "loading" : (loaded.search ?? "none");
  return <SearchBox {...props} index={index} />;
}

function SearchBox({ label, placeholder, noResults, index }: SearchProps & { index: SiteSearch | "loading" | "none" }) {
  const site = useNativeSite();
  const { colors, radius } = site.theme;
  const [query, setQuery] = useState("");
  const indexed = useMemo(() => (typeof index === "object" ? index.search(query) : undefined), [index, query]);
  const titles = useTitleResults(query, index === "none");
  const found: SiteSearchResult[] = indexed ?? titles;
  // Nothing is said while the index loads, which takes a moment.
  const searched = index !== "loading" && query.split(/\s+/).some(Boolean);
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
      {searched && found.length === 0 ? <SiteText muted>{noResults.replace("{query}", query.trim())}</SiteText> : null}
      {found.map((item) => (
        <NativeLink key={item.path} href={item.path}>
          <SiteText style={{ color: colors.primary }}>{item.title}</SiteText>
          {item.excerpt.length > 0 ? (
            <SiteText muted>
              {item.excerpt.map((part, index) =>
                part.match ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: an excerpt's parts are in order and never move.
                  <SiteText key={index} muted style={{ fontWeight: "700" }}>
                    {part.text}
                  </SiteText>
                ) : (
                  part.text
                ),
              )}
            </SiteText>
          ) : null}
        </NativeLink>
      ))}
    </View>
  );
}

/**
 * The pages whose titles, and the items whose values, have every word typed,
 * for a site with no index of pages' text in apps; nothing while `on` is off.
 */
function useTitleResults(query: string, on: boolean): SiteSearchResult[] {
  const site = useNativeSite();
  const all = useMemo(
    () =>
      on
        ? [
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
          ]
        : [],
    [on, site.pages, site.collections],
  );
  const words = query.toLocaleLowerCase(site.settings.language).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return all
    .filter((item) => {
      const text = `${item.title} ${item.text}`.toLocaleLowerCase(site.settings.language);
      return words.every((word) => text.includes(word));
    })
    .slice(0, MAX_RESULTS)
    .map((item) => ({ path: item.path, title: item.title, excerpt: [] }));
}
