import { defineConfig } from "tsdown";

export default defineConfig({
  // Client Components are entries of their own, so their "use client" directive is kept.
  entry: ["src/index.ts", "src/copy-button.tsx", "src/search-box.tsx", "src/dark-mode-switch-client.tsx"],
  format: "esm",
  dts: true,
  platform: "neutral",
  inputOptions: {
    onLog(level, log, handler) {
      if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
    },
  },
});
