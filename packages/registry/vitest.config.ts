import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.ts";

export default mergeConfig(
  shared,
  defineConfig({
    // As in a site, `@/` is the site's root, where blocks find the shadcn components they use.
    // With forward slashes: on Windows, Vite doesn't resolve a replacement that mixes `\` and `/`.
    resolve: { alias: { "@/": fileURLToPath(new URL("./site/", import.meta.url)).replaceAll("\\", "/") } },
  }),
);
