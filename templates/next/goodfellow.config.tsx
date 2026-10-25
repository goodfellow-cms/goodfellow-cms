import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
// import { github } from "@goodfellow-cms/github";
// import { gitlab } from "@goodfellow-cms/gitlab";
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

  // Where the site is stored. Once this is set, builds include the admin panel at /admin.
  // See README.md for how to set up sign-in.
  // backend: github({ repo: "your-name/your-site" }),
  // backend: gitlab({ project: "your-name/your-site", clientId: "your-application-id" }),
});
