import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  EDITOR_PRELUDE,
  type GoodfellowPlugin,
  PLUGINS_PATH,
  pluginFrameEntry,
  pluginFramePage,
  pluginId,
} from "@goodfellow-cms/core";
import { LICENSES_FILE, licensesPlugin, mediaStorageOrigins } from "@goodfellow-cms/core/node";
import { type Plugin, type Rolldown, build as viteBuild } from "vite";
import { findEntry, type Manifest } from "./manifest.js";

const ENTRY = "virtual:goodfellow/plugin-frame";
const RESOLVED_ENTRY = `\0${ENTRY}`;

export interface PluginFrameOptions {
  root: string;
  base: string;
  outDir: string;
  /** Rebuilds as the plugin's code changes, as `goodfellow dev` does, calling `onBuilt` after each build. */
  watch?: { onBuilt: (error?: Error) => void };
}

/** A plugin's admin module as the bundler imports it: a package's export, or a path from the site's root. */
function adminModule(root: string, specifier: string): string {
  return specifier.startsWith("./") || specifier.startsWith("../") ? resolve(root, specifier) : specifier;
}

/**
 * Bundles a plugin's admin module into its frame: one classic script, like
 * the editor's frames, starting with `EDITOR_PRELUDE`, so it runs only
 * sandboxed, with the page `pluginFramePage()` writes beside it, whose Content
 * Security Policy reaches only the addresses the plugin declared, and the
 * notices of what it bundles (`LICENSES_FILE`), since serving it distributes
 * them. Built on its own, without the site's Vite plugins, since a plugin's
 * frame has nothing of the site's.
 */
export async function buildPluginFrame(
  plugin: GoodfellowPlugin,
  { root, base, outDir, watch }: PluginFrameOptions,
): Promise<{ url: string; close(): Promise<void> }> {
  if (!plugin.admin) throw new Error(`${plugin.name} has no admin module.`);
  const id = pluginId(plugin.name);
  const dir = `${PLUGINS_PATH}${id}/`;
  const manifestName = `${dir}manifest.json`;
  const entry: Plugin = {
    name: "goodfellow:plugin-frame",
    resolveId: (source) => (source === ENTRY ? RESOLVED_ENTRY : undefined),
    load: (source) => (source === RESOLVED_ENTRY ? pluginFrameEntry(adminModule(root, plugin.admin ?? "")) : undefined),
  };
  const writePage = async () => {
    const manifestPath = join(outDir, manifestName);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    if (!watch) await rm(manifestPath);
    const script = findEntry(manifest, "plugin");
    if (!script) throw new Error(`${plugin.title}'s admin frame is missing from the build.`);
    const stylesheets = Object.values(manifest)
      .map((chunk) => chunk.file)
      .filter((file) => file.endsWith(".css"));
    await mkdir(join(outDir, dir), { recursive: true });
    await writeFile(
      join(outDir, dir, "index.html"),
      pluginFramePage({
        permissions: plugin.permissions ?? {},
        scripts: [`${base}${script.file}`],
        stylesheets: stylesheets.map((file) => `${base}${file}`),
        licenses: `${base}${dir}${LICENSES_FILE}`,
        editor: Boolean(plugin.editor),
        // Where the site keeps media outside the repository, as the page is written, for its editor to show.
        ...(plugin.editor && { media: await mediaStorageOrigins(root) }),
      }),
    );
  };

  const output = await viteBuild({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [entry, licensesPlugin(plugin.title, `${dir}${LICENSES_FILE}`)],
    base,
    ...(watch && { mode: "development" }),
    build: {
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      assetsDir: dir.slice(0, -1),
      manifest: manifestName,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 4096,
      ...(watch && { watch: {}, minify: false, sourcemap: true }),
      rolldownOptions: {
        input: { plugin: ENTRY },
        output: { format: "iife", banner: EDITOR_PRELUDE },
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          if (log.code === "EMPTY_IMPORT_META" && log.id?.includes("vite/preload-helper")) return;
          handler(level, log);
        },
      },
    },
  });

  const url = `${base}${dir}`;
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

/**
 * Plugins' frames in `goodfellow dev`, each built the first time it's asked
 * for, from the config as it is then, and rebuilt as its code changes.
 */
export function devPluginFrames(options: {
  root: string;
  outDir: string;
  plugins: () => Promise<readonly GoodfellowPlugin[]>;
  onError: (message: string) => void;
}) {
  const started = new Map<string, Promise<void>>();
  const closers: Array<() => Promise<void>> = [];
  return {
    /** Builds a plugin's frame, by its id, if the config has it and it isn't built yet. Answers whether there is one. */
    async ensure(id: string): Promise<boolean> {
      let ready = started.get(id);
      if (!ready) {
        const plugin = (await options.plugins()).find(
          (candidate) => pluginId(candidate.name) === id && candidate.admin,
        );
        if (!plugin) return false;
        ready = new Promise<void>((done) => {
          buildPluginFrame(plugin, {
            root: options.root,
            base: "/",
            outDir: options.outDir,
            watch: {
              onBuilt(error) {
                if (error) options.onError(`${plugin.title}'s admin frame couldn't be built: ${error.message}`);
                done();
              },
            },
          }).then(
            (frame) => closers.push(frame.close),
            (error: Error) => {
              options.onError(`${plugin.title}'s admin frame couldn't be built: ${error.message}`);
              done();
            },
          );
        });
        started.set(id, ready);
      }
      await ready;
      return true;
    },
    async close() {
      await Promise.all(closers.map((close) => close()));
    },
  };
}
