// react-native-webview for tests, which run React Native's parts through react-native-web: a plain box.
import { createElement } from "react";

export function WebView(props: { source?: { uri?: string } }) {
  return createElement("div", { "data-webview": props.source?.uri ?? "html" });
}

export default WebView;
