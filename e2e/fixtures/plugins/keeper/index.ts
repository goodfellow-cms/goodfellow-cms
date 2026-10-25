import { definePlugin } from "@goodfellow-cms/core";

/**
 * A plugin for the end-to-end tests that keeps media, as S3 storage does:
 * its `sign` task signs each request with `KEEPER_KEY`, a secret the browser
 * never sees, and its admin module puts files at `https://storage.example`,
 * which the tests answer, checking the signature.
 */
export const keeper = definePlugin({
  name: "goodfellow-plugin-keeper",
  title: "Keeper",
  version: "1.0.0",
  permissions: {
    connect: ["https://storage.example"],
    files: ["content/media-storage.json"],
    secrets: ["KEEPER_KEY"],
  },
  admin: "./plugins/keeper/admin.ts",
  screens: [{ id: "settings", title: "Keeper" }],
  tasks: [{ id: "sign", module: "./plugins/keeper/sign.mjs" }],
  mediaStorage: { maxBytes: 100 * 1024 * 1024 },
});
