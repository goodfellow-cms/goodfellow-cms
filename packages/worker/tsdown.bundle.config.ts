import { defineConfig } from "tsdown";

// The worker as one file with its dependencies, for the copy Cloudflare's Deploy to Cloudflare button deploys
// (`deploy/`, which create-goodfellow's build bundles as `templates/sign-in/` with this file beside it).
export default defineConfig({
  entry: { worker: "src/index.ts" },
  outDir: "dist/bundle",
  format: "esm",
  dts: false,
  clean: false,
  platform: "neutral",
  noExternal: [/.*/],
});
