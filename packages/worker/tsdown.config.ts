import { defineConfig } from "tsdown";

export default defineConfig({
  // `seal`, `github` and `setup` are shared with the Claude connector (`packages/connector`).
  entry: ["src/index.ts", "src/testing.ts", "src/setup.ts", "src/seal.ts", "src/github.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
