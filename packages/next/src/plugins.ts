/**
 * Plugins on Next.js sites: their admin frames, bundled with Rolldown as
 * `next dev` bundles the editor's frames, and their build steps, both run by
 * `goodfellow-next finish` from the site's config, which Next.js alone
 * bundles otherwise. Node only.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type CollectionSource,
  type CollectionSources,
  EDITOR_PRELUDE,
  framedPlugins,
  type GoodfellowConfig,
  type GoodfellowPlugin,
  INSTALLED_PLUGINS_INDEX,
  loadSiteContent,
  PLUGINS_PATH,
  pluginFrameEntry,
  pluginFramePage,
  pluginId,
  type SiteContent,
} from "@goodfellow-cms/core";
import {
  builtSiteSource,
  LICENSES_FILE,
  licensesPlugin,
  loadSourceModules,
  mediaStorageOrigins,
  siteModulePath,
} from "@goodfellow-cms/core/node";

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
 * Modules kept by site and input (`loadKeptSiteModule()`): one for each, the latest, so an older one, and the source
 * `keptCollectionSources()` made from it, can be let go once the code changes. With it, the hash of its bundled code,
 * and when each file bundled into it had last changed as it was read.
 */
const keptModules = new Map<
  string,
  { hash: string; files: Map<string, number> | undefined; module: Promise<Record<string, unknown>> }
>();

/** When `path` last changed, or `undefined` where it's gone. */
async function changedAt(path: string): Promise<number | undefined> {
  return stat(path).then(
    (info) => info.mtimeMs,
    () => undefined,
  );
}

/** Whether no file of `files` has changed since it was bundled. */
async function unchanged(files: Map<string, number> | undefined): Promise<boolean> {
  if (!files || files.size === 0) return false;
  const times = await Promise.all([...files.keys()].map(changedAt));
  return [...files.values()].every((time, index) => times[index] === time);
}

/**
 * `loadSiteModule()`, for collections' sources and the config naming them, which `next dev` reads on every request:
 * bundled again only once a file bundled into it has changed, and the same module again while its bundled code is
 * the same, so `keptCollectionSources()` makes each source once until its code changes.
 */
export async function loadKeptSiteModule(
  root: string,
  input: string,
  // Tests count the bundles it starts with their own.
  load: typeof loadSiteModule = loadSiteModule,
): Promise<Record<string, unknown>> {
  const key = JSON.stringify([root, input]);
  const kept = keptModules.get(key);
  if (kept && (await unchanged(kept.files))) return kept.module;
  // Requests that arrive together, as a page's feed and calendar do, wait on the one bundle, so they get one module,
  // and one source is made from it, not one each.
  const pending = bundling.get(key);
  if (pending) return pending;
  const loading = load(root, input, { keep: true });
  bundling.set(key, loading);
  try {
    return await loading;
  } finally {
    if (bundling.get(key) === loading) bundling.delete(key);
  }
}

/** The bundles `loadKeptSiteModule()` is making, by the same key as `keptModules`. */
const bundling = new Map<string, Promise<Record<string, unknown>>>();

export async function loadSiteModule(
  root: string,
  input: string,
  { keep = false }: { keep?: boolean } = {},
): Promise<Record<string, unknown>> {
  const { build } = await import("rolldown");
  const outDir = join(root, "node_modules/.goodfellow");
  await mkdir(outDir, { recursive: true });
  // Each call a file of its own, since several can start in the same millisecond.
  const file = join(outDir, `module-${process.pid}-${Date.now()}-${randomUUID()}.mjs`);
  // Every file the bundle reads, which its output doesn't list where a module's code was inlined into another's, with
  // when it last changed, as it's read: a file changed later, even while this bundles, is then bundled again.
  const read = new Map<string, Promise<number | undefined>>();
  await build({
    input,
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
        load: async (id) => {
          // Only for a module that's kept, which is the only one asked later whether its files changed.
          if (keep && isAbsolute(id)) {
            read.set(id, changedAt(id));
            await read.get(id);
          }
          return id.endsWith(".css") ? { code: "", moduleType: "js" } : undefined;
        },
      },
    ],
    onLog(level, log, handler) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level, log);
    },
    output: { file, format: "esm", codeSplitting: false },
  });
  try {
    if (!keep) return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    // By the site too: the bundle's packages are found from its own folder, so two sites' same code isn't one module.
    const key = JSON.stringify([root, input]);
    const hash = createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
    // The site's own files bundled into it, and when each had changed as it was read.
    const files = new Map<string, number>();
    for (const [id, time] of read) {
      const at = await time;
      if (at !== undefined) files.set(id, at);
    }
    const kept = keptModules.get(key);
    if (kept?.hash === hash) {
      kept.files = files;
      return await kept.module;
    }
    const module = import(pathToFileURL(file).href) as Promise<Record<string, unknown>>;
    const entry = { hash, files, module };
    // Replacing the one kept before, so it's let go.
    keptModules.set(key, entry);
    module.catch(() => {
      if (keptModules.get(key) === entry) keptModules.delete(key);
    });
    return await module;
  } finally {
    await rm(file, { force: true });
  }
}

/** The site's config, loaded in Node with `loadSiteModule()`. Only what plugins and checks need is read from it. */
export async function loadSiteConfig(root: string): Promise<GoodfellowConfig> {
  const configFile = findConfigFile(root);
  if (!configFile) throw new Error(`No goodfellow.config.tsx in ${root}.`);
  return (await loadSiteModule(root, configFile)).default as GoodfellowConfig;
}

/**
 * The sources the site's config names for its collections, each module loaded
 * in Node with `loadSiteModule()`: a path from the site's root, or a package's
 * export. None where the site has no config, or its config names none. It
 * reads the config whatever its text says, since a config can name its
 * collections in any way JavaScript allows; `goodfellow-next finish` loads it
 * for the content API anyway.
 */
export async function readCollectionSources(root: string): Promise<CollectionSources> {
  const dir = resolve(root);
  const configFile = findConfigFile(dir);
  if (!configFile) return {};
  // Kept as the sources' modules are, so a request bundles nothing while nothing has changed.
  const { collections } = (await loadKeptSiteModule(dir, configFile)).default as GoodfellowConfig;
  // Each module kept too, and made into a source once for the same modules, since `next dev` reads the sources again
  // on every request.
  return loadSourceModules(dir, collections, (path) => loadSourceModule(dir, path));
}

/**
 * One source's module: the site's own files bundled (`loadKeptSiteModule()`),
 * and a package's export (`goodfellow-plugin-airtable/source`) imported by
 * Node from the site's packages, as everything a bundle imports from packages
 * is: a bundle of a package's name alone reads none of the site's files, so
 * it would be bundled again on every request. Node keeps it once imported, so
 * it's the same module, and the same source, every request.
 */
export async function loadSourceModule(
  root: string,
  path: string,
  // Tests count the bundles it starts with their own.
  bundle: typeof loadKeptSiteModule = loadKeptSiteModule,
): Promise<Record<string, unknown>> {
  if (isAbsolute(path) || path.startsWith("@/")) return bundle(root, path);
  // A file in the site's own packages' folder, so Node finds the package from the site, named by the package's name.
  const dir = join(root, "node_modules/.goodfellow");
  const file = join(dir, `source-${createHash("sha256").update(path).digest("hex").slice(0, 16)}.mjs`);
  if (!existsSync(file)) {
    await mkdir(dir, { recursive: true });
    await writeFile(file, `export * as module from ${JSON.stringify(path)};\n`);
  }
  return ((await import(pathToFileURL(file).href)) as { module: Record<string, unknown> }).module;
}

const sourcedIds = new Map<string, Promise<string[]>>();

/**
 * The collections the site's config names sources for, once a process, read
 * from the config without making any source: what loading the site's files
 * leaves out the item files of (`LoadOptions.sourced`), since a source's items
 * replace them, wherever a step reads only the files.
 */
export function sourcedCollectionIds(root: string): Promise<string[]> {
  const dir = resolve(root);
  let ids = sourcedIds.get(dir);
  if (!ids) {
    ids = findConfigFile(dir)
      ? loadSiteConfig(dir).then((config) => Object.keys(config.collections ?? {}))
      : Promise.resolve([]);
    sourcedIds.set(dir, ids);
  }
  return ids;
}

/** The site's files as builds read them, leaving out sourced collections' item files (`sourcedCollectionIds()`). */
export async function loadSiteFiles(root: string): Promise<SiteContent> {
  const dir = resolve(root);
  return loadSiteContent(builtSiteSource(dir), { sourced: await sourcedCollectionIds(dir) });
}

const loadedSources = new Map<string, Promise<CollectionSources>>();

/**
 * `readCollectionSources()`, once a process, for the steps of `goodfellow-next
 * finish`, which each read the site: each source's items are read once too,
 * so its feeds, calendars, content API, redirects, and checks all show the same
 * items, however the source changes while they're written.
 */
export function loadCollectionSources(root: string): Promise<CollectionSources> {
  const dir = resolve(root);
  let loaded = loadedSources.get(dir);
  if (!loaded) {
    loaded = readCollectionSources(dir).then((sources) =>
      Object.fromEntries(
        Object.entries(sources).map(([id, source]): [string, CollectionSource] => {
          let items: ReturnType<CollectionSource["items"]> | undefined;
          const changed = source.changed?.bind(source);
          // A read that fails is forgotten, so the next step asks the source again rather than fail the same way.
          const read = () =>
            (items ??= Promise.resolve()
              .then(() => source.items())
              .catch((error: unknown) => {
                items = undefined;
                throw error;
              }));
          return [id, { items: read, ...(changed && { changed }) }];
        }),
      ),
    );
    loadedSources.set(dir, loaded);
  }
  return loaded;
}

/** A plugin's admin module as the bundler imports it: a package's export, or a path from the site's root. */
const adminModule = siteModulePath;

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
        // Where the site keeps media outside the repository, as the page is written, for its editor to show.
        ...(plugin.editor && { media: await mediaStorageOrigins(root) }),
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
