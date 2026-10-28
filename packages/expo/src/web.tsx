import type { ComponentProps } from "react";
import { type StyleProp, View, type ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import { useNativeSite } from "./site.js";

/** An HTML attribute's value, escaped. */
function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

type LoadRequest = Parameters<NonNullable<ComponentProps<typeof WebView>["onShouldStartLoadWithRequest"]>>[0];

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/**
 * Another site's page in a frame of the app's own, such as a video player or a
 * Google form, as tall as `height` or as wide as `aspect` says. It stays on
 * that site: links elsewhere open in the phone's browser.
 */
export function WebFrame({
  uri,
  title,
  aspect,
  height,
  style,
}: {
  uri: string;
  title: string;
  /** Width over height, such as 16 / 9; or `height`. */
  aspect?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const site = useNativeSite();
  const host = hostOf(uri);
  const stay = (request: LoadRequest) => {
    if (!request.isTopFrame || hostOf(request.url) === host) return true;
    site.open(request.url);
    return false;
  };
  return (
    <View
      accessibilityLabel={title}
      style={[
        {
          width: "100%",
          overflow: "hidden",
          borderRadius: site.theme.radius,
          backgroundColor: site.theme.colors.muted,
        },
        height ? { height } : { aspectRatio: aspect ?? 16 / 9 },
        style,
      ]}
    >
      <WebView
        source={{ uri }}
        originWhitelist={["https://*"]}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={stay}
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}

/**
 * An uploaded video or sound file, with the phone's own player, from the
 * site's address: apps keep pictures, but leave larger files to the site.
 */
export function MediaPlayer({
  src,
  kind,
  title,
  poster,
  captions,
  language,
  loop,
  autoplay,
  muted,
  aspect,
  style,
}: {
  src: string;
  kind: "video" | "audio";
  title?: string;
  poster?: string;
  /** A WebVTT file of the video's captions. */
  captions?: string;
  language?: string;
  loop?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  /** Width over height for a video; a sound file's player is one line tall. */
  aspect?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const site = useNativeSite();
  const address = site.address(src);
  const flags = [
    "controls",
    loop && "loop",
    autoplay && "autoplay",
    (muted || autoplay) && "muted",
    kind === "video" && "playsinline",
  ]
    .filter(Boolean)
    .join(" ");
  const track = captions
    ? `<track kind="captions" default src="${attribute(site.address(captions))}" srclang="${attribute(language ?? "en")}">`
    : "";
  const media =
    kind === "video"
      ? `<video ${flags} preload="metadata" src="${attribute(address)}"${poster ? ` poster="${attribute(site.media(poster))}"` : ""}${title ? ` aria-label="${attribute(title)}"` : ""}>${track}</video>`
      : `<audio ${flags} preload="metadata" src="${attribute(address)}"${title ? ` aria-label="${attribute(title)}"` : ""}></audio>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:transparent}video,audio{display:block;width:100%;height:100%}</style></head><body>${media}</body></html>`;
  return (
    <View
      style={[
        { width: "100%", overflow: "hidden", borderRadius: kind === "video" ? site.theme.radius : 0 },
        kind === "video" ? { aspectRatio: aspect ?? 16 / 9, backgroundColor: "#000" } : { height: 56 },
        style,
      ]}
    >
      <WebView
        source={{ html, baseUrl: site.address("/") }}
        javaScriptEnabled={false}
        originWhitelist={["https://*", "http://*"]}
        allowsFullscreenVideo
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={!autoplay}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) =>
          request.url === "about:blank" || request.url.startsWith(site.address("/"))
        }
        style={{ flex: 1, backgroundColor: "transparent" }}
      />
    </View>
  );
}
