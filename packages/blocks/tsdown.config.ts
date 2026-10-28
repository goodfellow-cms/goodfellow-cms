import { defineConfig } from "tsdown";

export default defineConfig({
  // Client Components are entries of their own, so their "use client" directive is kept.
  entry: [
    "src/index.ts",
    // The blocks for apps, which import none of the web's code.
    "src/native.ts",
    "src/copy-button.tsx",
    "src/search-box.tsx",
    "src/dark-mode-switch-client.tsx",
    "src/language-switch-client.tsx",
    // Shared by the Language switch and its Client Component, which has to stay in a file of its own.
    "src/language-switch-view.tsx",
  ],
  format: "esm",
  dts: true,
  platform: "neutral",
  inputOptions: {
    onLog(level, log, handler) {
      if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
    },
  },
});
