import { createRequire } from "node:module";
import { defineConfig } from "tsdown";

/** The release of Goodfellow's block registry this admin panel installs blocks from. */
const registryVersion: string = createRequire(import.meta.url)("@goodfellow-cms/registry/package.json").version;

export default defineConfig({
  entry: ["src/index.ts", "src/dev.ts", "src/editor.ts", "src/plugin.ts", "src/text.ts"],
  format: "esm",
  dts: true,
  platform: "browser",
  fixedExtension: false,
  define: { __GOODFELLOW_REGISTRY_VERSION__: JSON.stringify(registryVersion) },
});
