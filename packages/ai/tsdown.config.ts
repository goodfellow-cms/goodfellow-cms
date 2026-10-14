import { defineConfig } from "tsdown";

export default defineConfig({
  // `schema` on its own too, for servers that only check answers, such as the Claude connector.
  entry: ["src/index.ts", "src/schema.ts", "src/testing.ts"],
  format: "esm",
  dts: true,
  platform: "neutral",
});
