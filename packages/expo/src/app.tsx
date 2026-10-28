import { type MutableRefObject, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, View } from "react-native";
import { GoodfellowPage } from "./page.js";
import { GoodfellowSite, type GoodfellowSiteProps, pagePath, useSiteRoot, useSiteStatus } from "./site.js";

export interface GoodfellowAppProps extends Omit<GoodfellowSiteProps, "onNavigate" | "children"> {
  /** The page it opens on: the home page unless given. */
  start?: string;
  /** What shows before the app has a copy of the site, such as a splash screen. */
  loading?: ReactNode;
  /** What shows when it has none and can't reach the site, or the site is newer than the app reads. */
  unavailable?: ReactNode;
}

function Pages({
  start,
  loading,
  unavailable,
  opener,
}: Pick<GoodfellowAppProps, "start" | "loading" | "unavailable"> & {
  opener: MutableRefObject<((path: string) => void) | undefined>;
}) {
  const root = useSiteRoot();
  const status = useSiteStatus();
  const [history, setHistory] = useState<string[]>([start ?? "/"]);
  const path = history.at(-1) ?? "/";
  const back = useCallback(() => {
    if (history.length <= 1) return false;
    setHistory((current) => current.slice(0, -1));
    return true;
  }, [history.length]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", back);
    return () => subscription.remove();
  }, [back]);
  useEffect(() => {
    // The page opened is the one the site's links go to; the page shown follows the manifest's spelling.
    opener.current = (next: string) => setHistory((current) => [...current, pagePath(root.state.manifest, next)]);
  }, [root.state.manifest, opener]);
  if (!root.state.files) {
    return <View style={{ flex: 1 }}>{status === "loading" ? loading : (unavailable ?? loading)}</View>;
  }
  return <GoodfellowPage path={path} loading={loading} />;
}

/**
 * A whole app for the site: its pages, one at a time, with the header and
 * footer, opening the site's links in the app and going back with Android's
 * back button. Apps with Expo Router use `<GoodfellowSite>` and
 * `<GoodfellowPage>` in their own screens instead.
 */
export function GoodfellowApp({ start, loading, unavailable, ...site }: GoodfellowAppProps) {
  // The site's links open pages in the history `<Pages>` keeps.
  const opener = useRef<(path: string) => void>(undefined);
  return (
    <GoodfellowSite {...site} onNavigate={(path) => opener.current?.(path)}>
      <Pages start={start} loading={loading} unavailable={unavailable} opener={opener} />
    </GoodfellowSite>
  );
}
