import { blocks, categories } from "@goodfellow-cms/blocks";
import { defineConfig } from "@goodfellow-cms/core";
import { DocsLayout } from "./blocks/docs-layout";
import { SiteSetup } from "./blocks/site-setup";
import { SoftwareDetails } from "./blocks/software-details";
import { Sponsors } from "./blocks/sponsors";

export default defineConfig({
  // The built-in blocks, this site's own layout for documentation pages, the setup page's form, what the home
  // page tells search engines about Goodfellow, and its sponsors.
  // Never rename a key: pages refer to blocks by it.
  blocks: { ...blocks, DocsLayout, SiteSetup, SoftwareDetails, Sponsors },
  categories: {
    ...categories,
    docs: { title: "Documentation", components: ["DocsLayout", "SiteSetup", "SoftwareDetails", "Sponsors"] },
  },
  // No `backend`, so builds have no admin panel: .github/workflows/docs.yml publishes the site to GitHub Pages,
  // passing its subfolder as the base path.
});
