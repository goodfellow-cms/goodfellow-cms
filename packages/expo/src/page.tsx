import type { ApiPageFile } from "@goodfellow-cms/core/content-api";
import { type ComponentRef, type ReactNode, useMemo, useRef } from "react";
import { ActivityIndicator, ScrollView, type StyleProp, View, type ViewStyle } from "react-native";
import { Blocks, NativeLink, SiteText } from "./kit.js";
import { type Anchors, NativeSiteProvider, useNativeSiteValue, usePage, useSiteRoot } from "./site.js";
import { TEXT } from "./theme.js";

/** The photos' credits a page lists at its end, which their licenses ask for. */
function Credits({ page }: { page: ApiPageFile }) {
  if (!page.credits || page.credits.length === 0) return null;
  return (
    <View style={{ gap: 4, paddingHorizontal: 16, paddingVertical: 24 }}>
      {page.credits.map((credit) => {
        const words = [credit.title, credit.creator && `by ${credit.creator}`, credit.license]
          .filter(Boolean)
          .join(", ");
        const link = credit.sourceUrl ?? credit.licenseUrl;
        return link ? (
          <NativeLink key={credit.url} href={link}>
            <SiteText muted style={{ fontSize: TEXT.xs }}>
              {words}
            </SiteText>
          </NativeLink>
        ) : (
          <SiteText key={credit.url} muted style={{ fontSize: TEXT.xs }}>
            {words}
          </SiteText>
        );
      })}
    </View>
  );
}

export interface GoodfellowPageProps {
  /** The page's address on the site, such as `/` or `/about`. */
  path: string;
  /** Whether to show the site's header and footer around the page, as the website does. On unless turned off. */
  layout?: boolean;
  /** What shows while the page loads. */
  loading?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * One of the site's pages, drawn with the app's blocks, with the header and
 * footer around it, scrolling. Addresses the site doesn't have show its
 * "Page not found".
 */
export function GoodfellowPage({ path, layout = true, loading, style }: GoodfellowPageProps) {
  const root = useSiteRoot();
  const { page } = usePage(path);
  const scrollView = useRef<ComponentRef<typeof ScrollView>>(null);
  const offset = useRef(0);
  const top = useRef(0);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const scroll = useMemo(
    () => ({
      anchors: new Map() as Anchors,
      // Anchors measure where they are on the screen; the page scrolls by that much more than it has.
      scrollTo: (y: number) => scrollView.current?.scrollTo({ y: Math.max(0, y - top.current + offset.current - 16) }),
    }),
    [],
  );
  const files = root.state.files;
  const value = useNativeSiteValue(page, files ? [files.header, files.footer] : [], scroll);
  if (!value || !page || !files) {
    return (
      <View style={[{ flex: 1, alignItems: "center", justifyContent: "center" }, style]}>
        {loading ?? <ActivityIndicator />}
      </View>
    );
  }
  const { colors } = value.theme;
  return (
    <NativeSiteProvider value={value}>
      <View
        ref={frame}
        style={[{ flex: 1, backgroundColor: colors.background }, style]}
        onLayout={() => {
          frame.current?.measureInWindow((_x, y) => {
            top.current = y;
          });
        }}
      >
        <ScrollView
          ref={scrollView}
          scrollEventThrottle={64}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y;
          }}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          {layout && <Blocks items={files.header.data.content} gap={0} />}
          <View style={{ flexGrow: 1 }}>
            <Blocks items={page.data.content} gap={0} />
          </View>
          <Credits page={page} />
          {layout && <Blocks items={files.footer.data.content} gap={0} />}
        </ScrollView>
      </View>
    </NativeSiteProvider>
  );
}
