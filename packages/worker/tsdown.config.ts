import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/testing.ts", "src/setup.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
