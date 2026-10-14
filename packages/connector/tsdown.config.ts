import { defineConfig } from "tsdown";

export default defineConfig({
  // Only the setup script's helpers: Wrangler bundles the connector itself from `src/index.ts`.
  entry: ["src/setup.ts"],
  format: "esm",
  dts: false,
  platform: "node",
});
