import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
// import { github } from "@goodfellow-cms/github";
// import { gitlab } from "@goodfellow-cms/gitlab";
// import { bitbucket } from "@goodfellow-cms/bitbucket";
import { installedBlocks, installedCategories } from "./blocks/installed";
import { MassTimes } from "./blocks/mass-times";
import { Notice } from "./blocks/notice";
import { Scripture } from "./blocks/scripture";
import { installedPlugins } from "./plugins/installed";

export default defineConfig({
  // The built-in blocks, those installed from the admin panel's Blocks screen, and this site's own.
  // Never rename a key: pages refer to blocks by it.
  blocks: { ...blocks, ...installedBlocks, MassTimes, Scripture, Notice },
  categories: {
    ...categories,
    ...installedCategories,
    parish: { title: "Parish", components: ["MassTimes", "Scripture", "Notice"] },
  },

  // Plugins installed from the admin panel's Plugins screen. Add your own here too,
  // e.g. `plugins: [...installedPlugins, storage]`.
  plugins: installedPlugins,

  // Where the site is stored. Once this is set, builds include the admin panel at /admin.
  // See README.md for how to set up sign-in.
  // backend: github({ repo: "your-name/your-site" }),
  // backend: gitlab({ project: "your-name/your-site", clientId: "your-application-id" }),
  // backend: bitbucket({ repo: "your-workspace/your-site", clientId: "your-consumer-key" }),
});
