import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig([
  {
    entry: ["src/index.ts", "src/testing.ts", "src/wordpress.ts", "src/content-api.ts"],
    format: "esm",
    dts: true,
    platform: "neutral",
    // One file per module, so bundles for the browser only include what they use, such as `withBase()` without the content schemas.
    unbundle: true,
    define: { __GOODFELLOW_VERSION__: JSON.stringify(version) },
  },
  {
    // Node only: reads and writes the site's files on disk, and (each on its own, since they run Pagefind,
    // axe-core and TypeScript) indexes built sites, checks their pages and makes blocks of shadcn components.
    entry: ["src/node.ts", "src/node-search.ts", "src/node-accessibility.ts", "src/node-shadcn.ts"],
    format: "esm",
    dts: true,
    platform: "node",
    fixedExtension: false,
    clean: false,
    tsconfig: "tsconfig.node.json",
    // Shares the main entry rather than bundling a second copy, so `instanceof ConflictError` works across both.
    deps: { neverBundle: [/^\.\/index\.js$/, /^\.\/wordpress\.js$/, /^\.\/content-api\.js$/] },
  },
]);
