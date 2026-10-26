/**
 * Plugins on Next.js sites: their admin frames, bundled with Rolldown as
 * `next dev` bundles the editor's frames, and their build steps, both run by
 * `goodfellow-next finish` from the site's config, which Next.js alone
 * bundles otherwise. Node only.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  EDITOR_PRELUDE,
  framedPlugins,
  type GoodfellowConfig,
  type GoodfellowPlugin,
  INSTALLED_PLUGINS_INDEX,
  PLUGINS_PATH,
  pluginFrameEntry,
  pluginFramePage,
  pluginId,
} from "@goodfellow-cms/core";
import { LICENSES_FILE, licensesPlugin } from "@goodfellow-cms/core/node";

const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];
const FRAME_ENTRY = "\0goodfellow:plugin-frame";

export function findConfigFile(root: string): string | undefined {
  return CONFIG_FILES.map((name) => join(root, name)).find((file) => existsSync(file));
}

/**
 * Whether the site's config lists plugins, read from its text, so builds of
 * sites without any never load the config outside Next.js: plugins of its
 * own, or any installed from the admin panel, which `plugins/installed/`
 * lists.
 */
export async function configHasPlugins(root: string): Promise<boolean> {
  const file = findConfigFile(root);
  const listed = file && /\bplugins\s*:\s*([^\n]*)/.exec(await readFile(file, "utf8"))?.[1];
  if (!listed) return false;
  if (!/^installedPlugins\s*,?$/.test(listed.trim())) return true;
  const index = join(root, INSTALLED_PLUGINS_INDEX);
  return existsSync(index) && /\binstalledPlugin\(/.test(await readFile(index, "utf8"));
}

/**
 * The site's config, loaded in Node: bundled with Rolldown, with the
 * packages it imports left for Node to load and stylesheets left out, then
 * imported. Only what plugins need is read from it.
 */
export async function loadSiteConfig(root: string): Promise<GoodfellowConfig> {
  const configFile = findConfigFile(root);
  if (!configFile) throw new Error(`No goodfellow.config.tsx in ${root}.`);
  const { build } = await import("rolldown");
  const outDir = join(root, "node_modules/.goodfellow");
  await mkdir(outDir, { recursive: true });
  const file = join(outDir, `config-${process.pid}-${Date.now()}.mjs`);
  await build({
    input: configFile,
    cwd: root,
    platform: "node",
    tsconfig: existsSync(join(root, "tsconfig.json")) ? join(root, "tsconfig.json") : false,
    transform: { jsx: { runtime: "automatic" } },
    // Packages are Node's to load; only the site's own files are bundled.
    external: (id, _importer, resolved) =>
      resolved ? /[\\/]node_modules[\\/]/.test(id) : !id.startsWith(".") && !isAbsolute(id) && !id.startsWith("@/"),
    plugins: [
      {
        name: "goodfellow:no-styles",
        load: (id) => (id.endsWith(".css") ? { code: "", moduleType: "js" } : undefined),
      },
    ],
    onLog(level, log, handler) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level, log);
    },
    output: { file, format: "esm", codeSplitting: false },
  });
  try {
    return (await import(pathToFileURL(file).href)).default as GoodfellowConfig;
  } finally {
    await rm(file, { force: true });
  }
}

/** A plugin's admin module as the bundler imports it: a package's export, or a path from the site's root. */
function adminModule(root: string, specifier: string): string {
  return specifier.startsWith("./") || specifier.startsWith("../") ? resolve(root, specifier) : specifier;
}

export interface PluginFrameBuild {
  root: string;
  /**
   * The folder the frame's files go in: `admin/plugins/<id>/` in the export
   * or `public/`, or `next dev`'s own. Its page names its script and
   * stylesheet relative to itself, so it works under any base path.
   */
  dir: string;
  /** Development builds, rebuilt as the plugin's code changes, calling `onBuilt` after each. */
  watch?: { onBuilt: (error?: Error) => void };
}

/**
 * Bundles a plugin's admin module into its frame, at `admin/plugins/<id>/`
 * under `outDir`: one classic script starting with `EDITOR_PRELUDE`, its
 * stylesheets in one file, `pluginFramePage()`, whose Content Security
 * Policy reaches only the addresses the plugin declared, and the notices of
 * what it bundles (`LICENSES_FILE`). Answers a function that stops rebuilding.
 */
export async function buildPluginFrame(
  plugin: GoodfellowPlugin,
  { root, dir, watch }: PluginFrameBuild,
): Promise<() => Promise<void>> {
  if (!plugin.admin) throw new Error(`${plugin.name} has no admin module.`);
  const rolldown = await import("rolldown");
  await mkdir(dir, { recursive: true });
  const stylesheets = new Set<string>();
  const writePage = async () => {
    const css = await Promise.all([...stylesheets].map((file) => readFile(file, "utf8")));
    await writeFile(join(dir, "plugin.css"), css.join("\n"));
    await writeFile(
      join(dir, "index.html"),
      pluginFramePage({
        permissions: plugin.permissions ?? {},
        scripts: ["plugin.js"],
        stylesheets: ["plugin.css"],
        licenses: LICENSES_FILE,
        editor: Boolean(plugin.editor),
      }),
    );
  };
  const options = {
    input: { plugin: FRAME_ENTRY },
    cwd: root,
    platform: "browser" as const,
    tsconfig: existsSync(join(root, "tsconfig.json")) ? join(root, "tsconfig.json") : false,
    transform: {
      jsx: { runtime: "automatic" as const },
      define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
    },
    plugins: [
      {
        name: "goodfellow:plugin-frame",
        resolveId: (id: string) => (id === FRAME_ENTRY ? id : undefined),
        load(id: string) {
          if (id === FRAME_ENTRY) return pluginFrameEntry(adminModule(root, plugin.admin ?? ""));
          if (id.endsWith(".css")) {
            stylesheets.add(id);
            return { code: "", moduleType: "js" as const };
          }
          return undefined;
        },
      },
      licensesPlugin(plugin.title, LICENSES_FILE),
    ],
    onLog(level: string, log: { code?: string }, handler: (level: never, log: never) => void) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level as never, log as never);
    },
    output: {
      dir,
      format: "iife" as const,
      codeSplitting: false,
      entryFileNames: "plugin.js",
      banner: EDITOR_PRELUDE,
      ...(watch ? { sourcemap: true } : { minify: true }),
    },
  };
  if (!watch) {
    await rolldown.build(options);
    await writePage();
    return async () => {};
  }
  const watcher = rolldown.watch(options);
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
  return () => watcher.close();
}

/** Builds every plugin's admin frame into `admin/plugins/<id>/` in `outDir`. Answers the plugins' names. */
export async function buildPluginFrames(
  plugins: readonly GoodfellowPlugin[] | undefined,
  { root, outDir }: { root: string; outDir: string },
): Promise<string[]> {
  const built: string[] = [];
  for (const plugin of framedPlugins(plugins)) {
    await buildPluginFrame(plugin, { root, dir: join(outDir, PLUGINS_PATH, pluginId(plugin.name)) });
    built.push(plugin.name);
  }
  return built;
}
