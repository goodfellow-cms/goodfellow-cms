import { definePlugin } from "@goodfellow-cms/core";

/**
 * A plugin for the end-to-end tests: a page editor of its own, a plain
 * outline of the page's blocks, which people can choose in place of Puck.
 */
export const outline = definePlugin({
  name: "goodfellow-plugin-outline",
  title: "Outline",
  version: "1.0.0",
  admin: "./plugins/outline/admin.ts",
  editor: { title: "Outline editor", kinds: ["page", "header", "footer"] },
});
