import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EDITOR_PRELUDE, editorPage } from "@goodfellow-cms/core";
import type { BuildOptions } from "rolldown";
import { EDITOR_FRAMES_PATH } from "./editor-frames-path.js";

const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];
const ENTRY = "\0goodfellow:next-editor";
const TAILWIND_BROWSER = "tailwind-browser.js";

/** The site's `goodfellow.config.tsx`, or whichever of its names it has. */
export function siteConfigFile(root: string): string {
  const file = CONFIG_FILES.map((name) => join(root, name)).find((path) => existsSync(path));
  if (!file) throw new Error(`No goodfellow.config.tsx in ${root}.`);
  return file;
}

/**
 * How the editor's frames are bundled: the site's config, Puck and every
 * block as one classic script, `editor.js`, with `EDITOR_PRELUDE` first, as
 * `goodfellow build` bundles them. The frames are sandboxed with
 * `allow-scripts` alone, so their origin is `null`, which Next.js refuses its
 * own files to, and their page runs no inline scripts, so its Content
 * Security Policy (`editorPolicy()`) is known before anything is built.
 * Stylesheets the editor's modules import are collected in `stylesheets`, for
 * `writeEditorFramesPage()`.
 */
export function editorFramesOptions(
  root: string,
  outDir: string,
  { development, stylesheets }: { development: boolean; stylesheets: Set<string> },
): BuildOptions {
  const configFile = siteConfigFile(root);
  return {
    input: { editor: ENTRY },
    cwd: root,
    platform: "browser",
    // The site's own paths, such as `@/components/ui/button`.
    tsconfig: existsSync(join(root, "tsconfig.json")) ? join(root, "tsconfig.json") : false,
    transform: {
      jsx: { runtime: "automatic" },
      define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
    },
    plugins: [
      {
        name: "goodfellow:next-editor",
        resolveId: (id) => (id === ENTRY ? id : undefined),
        load(id) {
          if (id === ENTRY) {
            return [
              `import config from ${JSON.stringify(configFile)};`,
              `import { mountEditorFrame } from "@goodfellow-cms/admin/editor";`,
              `import "@puckeditor/core/puck.css";`,
              `import "@goodfellow-cms/admin/styles.css";`,
              `mountEditorFrame(config, undefined, { tailwindBrowserUrl: ${JSON.stringify(TAILWIND_BROWSER)} });`,
            ].join("\n");
          }
          if (id.endsWith(".css")) {
            stylesheets.add(id);
            return { code: "", moduleType: "js" };
          }
          return undefined;
        },
      },
    ],
    onLog(level, log, handler) {
      // React libraries mark modules "use client", which only matters to server-component bundlers.
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level, log);
    },
    output: {
      dir: outDir,
      format: "iife",
      codeSplitting: false,
      entryFileNames: "editor.js",
      banner: EDITOR_PRELUDE,
      ...(development ? { sourcemap: true } : { minify: true }),
    },
  };
}

/** Writes the frames' page beside `editor.js`: `index.html`, `editor.css` with `stylesheets`, and Tailwind for the browser. */
export async function writeEditorFramesPage(outDir: string, stylesheets: Iterable<string>): Promise<void> {
  const { default: tailwindBrowser } = await import("./generated/tailwind-browser.js");
  const css = await Promise.all([...stylesheets].map((file) => readFile(file, "utf8")));
  await writeFile(join(outDir, TAILWIND_BROWSER), tailwindBrowser);
  await writeFile(join(outDir, "editor.css"), css.join("\n"));
  await writeFile(join(outDir, "index.html"), editorPage({ scripts: ["editor.js"], stylesheets: ["editor.css"] }));
}

/**
 * Bundles a full-stack site's editor frames into `<outDir>/admin/editor/frames/`,
 * such as its `public/`, from the site's code alone, so it needs nothing
 * `next build` writes and runs before it or after it, on any host.
 */
export async function writeEditorFrames(outDir: string, root = process.cwd()): Promise<string> {
  const site = resolve(root);
  const dir = join(resolve(site, outDir), EDITOR_FRAMES_PATH);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const stylesheets = new Set<string>();
  // Loaded only here, so Next.js's own builds never load the bundler.
  const { build } = await import("rolldown");
  await build(editorFramesOptions(site, dir, { development: false, stylesheets }));
  await writeEditorFramesPage(dir, stylesheets);
  return dir;
}
