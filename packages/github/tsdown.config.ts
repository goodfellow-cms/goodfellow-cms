import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/app.ts", "src/testing.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
