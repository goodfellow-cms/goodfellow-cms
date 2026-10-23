import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EDITOR_PRELUDE, editorPage } from "@goodfellow-cms/core";
import { type InlineConfig, type Plugin, type Rolldown, build as viteBuild } from "vite";
import { EDITOR_ENTRY, EDITOR_PATH } from "./admin-entry.js";
import { cssFiles, findEntry, type Manifest } from "./manifest.js";

const MANIFEST = "editor-manifest.json";

export interface EditorBundleOptions {
  base: string;
  outDir: string;
  /**
   * Rebuilds when the site's code changes, as `goodfellow dev` does, calling
   * `onBuilt` after each build with what went wrong, if anything.
   */
  watch?: { onBuilt: (error?: Error) => void };
}

export interface EditorBundle {
  /** The frames' page. */
  url: string;
  /** Stops rebuilding. */
  close(): Promise<void>;
}

/**
 * The editor's frames' bundle: the site's config, Puck and every block, as
 * one classic script, with WebRTC removed first. The frames are sandboxed
 * with `allow-scripts` alone, so their origin is `null`, and module scripts
 * would need the server to let every website's sandboxed frames read its
 * files. Writes the frames' page, with `editorPolicy()`, beside it.
 */
export async function buildEditor(
  viteConfig: InlineConfig,
  entries: Plugin,
  { base, outDir, watch }: EditorBundleOptions,
): Promise<EditorBundle> {
  const writePage = async () => {
    const manifestPath = join(outDir, MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (!watch) await rm(manifestPath);
    const editor = findEntry(manifest, "editor");
    if (!editor) throw new Error("The editor's bundle is missing from the build.");
    const html = editorPage({
      scripts: [`${base}${editor.file}`],
      stylesheets: cssFiles(manifest, "editor").map((file) => `${base}${file}`),
    });
    await mkdir(join(outDir, EDITOR_PATH), { recursive: true });
    await writeFile(join(outDir, EDITOR_PATH, "index.html"), html);
  };

  const output = await viteBuild({
    ...viteConfig,
    plugins: [...(viteConfig.plugins ?? []), entries],
    base,
    // Development builds keep React's warnings and skip minifying, so rebuilds are quick.
    ...(watch && { mode: "development" }),
    build: {
      outDir,
      emptyOutDir: Boolean(watch),
      copyPublicDir: false,
      assetsDir: EDITOR_PATH.slice(0, -1),
      manifest: MANIFEST,
      chunkSizeWarningLimit: 16384,
      cssCodeSplit: false,
      ...(watch && { watch: {}, minify: false, sourcemap: true }),
      rolldownOptions: {
        input: { editor: EDITOR_ENTRY },
        // One script: Vite turns code splitting off for `iife`, so dynamic imports are bundled in.
        output: { format: "iife", banner: EDITOR_PRELUDE },
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          // Vite's helper for loading chunks, which a single script never calls.
          if (log.code === "EMPTY_IMPORT_META" && log.id?.includes("vite/preload-helper")) return;
          handler(level, log);
        },
      },
    },
  });

  const url = `${base}${EDITOR_PATH}`;
  if (!watch) {
    await writePage();
    return { url, close: async () => {} };
  }
  const watcher = output as Rolldown.RolldownWatcher;
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") {
      void event.result.close();
      writePage().then(
        () => watch.onBuilt(),
        (error: Error) => watch.onBuilt(error),
      );
    } else if (event.code === "ERROR") {
      void event.result?.close();
      watch.onBuilt(event.error);
    }
  });
  return { url, close: () => watcher.close() };
}
