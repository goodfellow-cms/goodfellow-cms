import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/sync.ts", "src/file-system.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
  // One file per module, so an app's bundler takes only what it uses.
  unbundle: true,
});
