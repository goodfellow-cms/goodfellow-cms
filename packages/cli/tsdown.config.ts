import { defineConfig } from "tsdown";

export default defineConfig({
  // The task's config loader is an entry of its own, which `goodfellow task` imports in a process of its own.
  // Islands' React where they run with Preact are entries too, since the build points Vite at their files.
  entry: [
    "src/index.ts",
    "src/cli.ts",
    "src/task-config.ts",
    "src/preact/react.ts",
    "src/preact/react-dom-client.ts",
    "src/preact/render.ts",
  ],
  format: "esm",
  dts: true,
  platform: "node",
  fixedExtension: false,
});
