import { defineConfig } from "tsdown";

export default defineConfig({
  // The task's config loader is an entry of its own, which `goodfellow task` imports in a process of its own.
  entry: ["src/index.ts", "src/cli.ts", "src/task-config.ts"],
  format: "esm",
  dts: true,
  platform: "node",
  fixedExtension: false,
});
