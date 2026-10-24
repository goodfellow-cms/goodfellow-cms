import { defineConfig } from "vite";

// The broker is static files: index.html, its script and styles, deployed on an address of its own.
export default defineConfig({
  base: "./",
  build: {
    outDir: "site",
    emptyOutDir: true,
    // No inline scripts, so the page's Content Security Policy can allow its own files only.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
