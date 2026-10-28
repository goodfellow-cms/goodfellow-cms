import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The native blocks' tests draw React Native's parts in a browser's DOM with react-native-web.
    alias: {
      "react-native-webview": fileURLToPath(new URL("./test/webview.tsx", import.meta.url)),
      "react-native": "react-native-web",
    },
  },
});
