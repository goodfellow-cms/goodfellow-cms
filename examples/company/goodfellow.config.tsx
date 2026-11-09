import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { installedBlocks, installedCategories } from "./blocks/installed";
import { installedPlugins } from "./plugins/installed";

export default defineConfig({
  // The built-in blocks, and those installed from the admin panel's Blocks screen.
  // Add your own here too, e.g. `blocks: { ...blocks, ...installedBlocks, MassTimes }`.
  blocks: { ...blocks, ...installedBlocks },
  categories: { ...categories, ...installedCategories },

  // Plugins installed from the admin panel's Plugins screen. Add your own here too,
  // e.g. `plugins: [...installedPlugins, storage]`.
  plugins: installedPlugins,

  // Where the content is stored: a repository of its own, so the server's token can change the content but never
  // the code it runs. Editors sign in with the site's own accounts (lib/auth.ts), and the server publishes for them.
  backend: github({ repo: "your-name/your-site-content", contentOnly: true }),
});
