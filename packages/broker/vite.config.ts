import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";

const OUT_DIR = "site";

/**
 * Lists the built files in `site/files.json`, so the admin panel and
 * `goodfellow broker add` can copy a release from jsDelivr file by file.
 */
function listFiles(): Plugin {
  return {
    name: "goodfellow-broker-files",
    apply: "build",
    closeBundle() {
      const root = resolve(OUT_DIR);
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? walk(path) : [relative(root, path).split(sep).join("/")];
        });
      const files = walk(root)
        .filter((file) => file !== "files.json")
        .sort();
      writeFileSync(join(root, "files.json"), `${JSON.stringify({ files }, null, 2)}\n`);
    },
  };
}

// The broker is static files: index.html, its script and styles, deployed on an address of its own.
export default defineConfig({
  base: "./",
  plugins: [listFiles()],
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    // No inline scripts, so the page's Content Security Policy can allow its own files only.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
});
