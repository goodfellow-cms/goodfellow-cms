/**
 * Installing plugins from the admin panel: finding them on npm, reading what
 * each says it does from its `goodfellow-plugin.json`, and planning the
 * changes that install, update or remove one. An install adds the package to
 * `package.json` at an exact release and records what the owner approved in
 * `plugins/installed/`, whose `index.ts` the config imports; the site's own
 * workflow then writes the lockfile, running none of the package's code, and
 * the site rebuilds with it. A plugin that asks for more than was approved
 * stops the site from loading (`installedPlugin()`). Nothing here runs a
 * plugin's code.
 */
import { z } from "zod";
import { INSTALLED_PLUGINS_FILE, INSTALLED_PLUGINS_INDEX } from "./content/paths.js";
import { serializeContent } from "./content/serialize.js";
import type { FileChange } from "./content/store.js";
import {
  getPackageText,
  PackageError,
  type PackageFetchOptions,
  type PackageListing,
  type PackageRelease,
  packageFetch,
  packageFileUrl,
  packageReleases,
  searchPackages,
} from "./npm-packages.js";
import {
  type GoodfellowPlugin,
  isPluginName,
  PLUGIN_KEYWORD,
  PluginError,
  type PluginPermissions,
  pluginProblems,
} from "./plugins.js";
import { inRange } from "./updates.js";

/** The site's config, which an install changes only to list installed plugins, for sites made before it did. */
export const CONFIG_FILE = "goodfellow.config.tsx";

/** The file at the root of a plugin's package that says what it does, which owners approve before installing it. */
export const PLUGIN_MANIFEST = "goodfellow-plugin.json";
/** At most this many plugins are listed for a search. */
export const MAX_PLUGINS = 50;

const PERMISSION_KEYS = ["connect", "files", "secrets", "read", "write"] as const;

const permissionsSchema = z
  .object(Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.array(z.string()).optional()])))
  .strict() as z.ZodType<PluginPermissions>;

/** What a plugin says it does: what `pluginManifest()` writes, and what the admin panel shows before installing it. */
export const pluginManifestSchema = z
  .object({
    version: z.literal(1),
    title: z.string().trim().min(1),
    description: z.string().optional(),
    permissions: permissionsSchema.default({}),
    /** The blocks it adds, by name. */
    blocks: z.array(z.string()).optional(),
    /** Whether it has an admin module, which runs in the admin panel in a sandboxed frame. */
    admin: z.boolean().optional(),
    screens: z.array(z.object({ id: z.string(), title: z.string() }).strict()).optional(),
    build: z.array(z.object({ id: z.string(), title: z.string().optional() }).strict()).optional(),
    /** Whether it answers requests on full-stack sites' servers. */
    server: z.boolean().optional(),
  })
  .strict();

export type PluginManifest = z.output<typeof pluginManifestSchema>;

/** A plugin's `goodfellow-plugin.json`, for its package: what it does, as `pluginManifestSchema` describes it. */
export function pluginManifest(plugin: GoodfellowPlugin): PluginManifest {
  const permissions: PluginPermissions = {};
  for (const key of PERMISSION_KEYS) {
    const values = plugin.permissions?.[key];
    if (values?.length) permissions[key] = [...values];
  }
  return {
    version: 1,
    title: plugin.title,
    ...(plugin.description && { description: plugin.description }),
    permissions,
    ...(plugin.blocks && Object.keys(plugin.blocks).length > 0 && { blocks: Object.keys(plugin.blocks) }),
    ...(plugin.admin && { admin: true }),
    ...(plugin.screens?.length && { screens: plugin.screens.map(({ id, title }) => ({ id, title })) }),
    ...(plugin.build?.length && { build: plugin.build.map(({ id, title }) => ({ id, ...(title && { title }) })) }),
    ...(plugin.server && { server: true }),
  };
}

/** What an installed plugin was approved to do: its name, release and manifest, as `plugins/installed/index.ts` passes them. */
export interface ApprovedPlugin extends PluginManifest {
  name: string;
  release: string;
}

/**
 * What a plugin has that it wasn't approved for: permissions, blocks, screens
 * and build steps beyond its approval, an admin module or server module it
 * wasn't approved with, or another name.
 */
export function unapproved(approved: ApprovedPlugin, plugin: GoodfellowPlugin): string[] {
  const found: string[] = [];
  if (plugin.name !== approved.name) found.push(`its name, ${plugin.name}`);
  for (const key of PERMISSION_KEYS) {
    const allowed = new Set(approved.permissions[key] ?? []);
    for (const value of plugin.permissions?.[key] ?? []) {
      if (!allowed.has(value)) found.push(`${key} "${value}"`);
    }
  }
  const blocks = new Set(approved.blocks ?? []);
  for (const block of Object.keys(plugin.blocks ?? {})) if (!blocks.has(block)) found.push(`the block "${block}"`);
  const screens = new Set((approved.screens ?? []).map((screen) => screen.id));
  for (const screen of plugin.screens ?? []) if (!screens.has(screen.id)) found.push(`the screen "${screen.id}"`);
  const steps = new Set((approved.build ?? []).map((step) => step.id));
  for (const step of plugin.build ?? []) if (!steps.has(step.id)) found.push(`the build step "${step.id}"`);
  if (plugin.admin && !approved.admin) found.push("an admin module");
  if (plugin.server && !approved.server) found.push("a server module");
  return found;
}

/**
 * A plugin installed from the admin panel, as `plugins/installed/index.ts`
 * lists it: its package's default export, checked against what the owner
 * approved. One that asks for more throws a `PluginError`, which stops the
 * site from loading wherever its config does, builds included.
 */
export function installedPlugin(plugin: unknown, approved: ApprovedPlugin): GoodfellowPlugin {
  const problem = (message: string): never => {
    throw new PluginError([{ plugin: approved.name, code: "not-approved", message }]);
  };
  if (plugin === null || typeof plugin !== "object" || typeof (plugin as GoodfellowPlugin).name !== "string") {
    return problem(`${approved.name}'s package doesn't export a plugin as its default.`);
  }
  const found = unapproved(approved, plugin as GoodfellowPlugin);
  if (found.length > 0) {
    problem(
      `${approved.name} ${approved.release} asks for more than its owner approved: ${found.join(", ")}. Install it again from the admin panel's Plugins screen to approve it.`,
    );
  }
  return plugin as GoodfellowPlugin;
}

/** One plugin in `plugins/installed/installed.json`. */
export const installedPluginSchema = z.object({
  /** Its exact release, as `package.json` has it. */
  release: z.string(),
  /** When it was installed or last updated, `YYYY-MM-DD`. */
  installed: z.string(),
  /** Its `peerDependencies` range on `@goodfellow-cms/core`, which updates are checked against. */
  goodfellow: z.string().optional(),
  /** What the owner approved. */
  manifest: pluginManifestSchema,
});

/** The record of plugins installed from the admin panel, by package name. */
export const installedPluginsSchema = z.object({
  version: z.literal(1),
  plugins: z.record(z.string(), installedPluginSchema),
});

export type InstalledPlugin = z.output<typeof installedPluginSchema>;
export type InstalledPlugins = z.output<typeof installedPluginsSchema>;

export const NO_INSTALLED_PLUGINS: InstalledPlugins = { version: 1, plugins: {} };

/** The record from `plugins/installed/installed.json`'s text; none when the site has no such file. Throws when it can't be read. */
export function parseInstalledPlugins(text: string | undefined): InstalledPlugins {
  if (text === undefined) return NO_INSTALLED_PLUGINS;
  return installedPluginsSchema.parse(JSON.parse(text));
}

/** `plugins/installed/index.ts` for a record: each plugin's package imported and checked against its approval. */
export function installedPluginsIndex(record: InstalledPlugins): string {
  const names = Object.keys(record.plugins).sort();
  const header = "// Written by the admin panel when plugins are installed or removed. Don't edit it by hand.";
  if (names.length === 0) {
    return [
      header,
      'import type { GoodfellowPlugin } from "@goodfellow-cms/core";',
      "",
      "export const installedPlugins: GoodfellowPlugin[] = [];",
      "",
    ].join("\n");
  }
  const entries = names.map((name, index) => {
    const entry = record.plugins[name] as InstalledPlugin;
    const approved: ApprovedPlugin = { name, release: entry.release, ...entry.manifest };
    return `  installedPlugin(plugin${index}, ${JSON.stringify(approved)}),`;
  });
  return [
    header,
    'import { type GoodfellowPlugin, installedPlugin } from "@goodfellow-cms/core";',
    ...names.map((name, index) => `import plugin${index} from ${JSON.stringify(name)};`),
    "",
    `export const installedPlugins: GoodfellowPlugin[] = [\n${entries.join("\n")}\n];`,
    "",
  ].join("\n");
}

const PLUGINS_IMPORT = 'import { installedPlugins } from "./plugins/installed";';

/** Whether a site's config lists the plugins installed from the admin panel. */
export function configUsesInstalledPlugins(source: string): boolean {
  return (
    /\bfrom\s+["']\.\/plugins\/installed(?:\/index(?:\.[jt]sx?)?)?["']/.test(source) &&
    /\binstalledPlugins\b/.test(source)
  );
}

/**
 * The config with the plugins installed from the admin panel listed, for
 * sites made before it listed them: an import, and `plugins: installedPlugins`
 * just inside `defineConfig({`. `undefined` where the config lists plugins of
 * its own already, or can't be read that way, which a developer then changes.
 */
export function withInstalledPluginsConfig(source: string): string | undefined {
  if (configUsesInstalledPlugins(source)) return source;
  if (/\bplugins\s*:/.test(source)) return undefined;
  const opening = /defineConfig\(\{[ \t]*\n/.exec(source);
  const imports = [...source.matchAll(/^import\b[^;]*;[ \t]*$/gm)];
  const last = imports[imports.length - 1];
  if (!opening || !last || last.index > opening.index) return undefined;
  const afterImports = last.index + last[0].length;
  const at = opening.index + opening[0].length;
  return `${source.slice(0, afterImports)}\n${PLUGINS_IMPORT}${source.slice(afterImports, at)}  // Plugins installed from the admin panel's Plugins screen.\n  plugins: installedPlugins,\n${source.slice(at)}`;
}

/** `package.json`'s text with a dependency at an exact release, or without it. */
export function withDependency(packageJson: string, name: string, release: string | undefined): string {
  const site = JSON.parse(packageJson) as Record<string, unknown> & { dependencies?: Record<string, string> };
  const dependencies = { ...(site.dependencies ?? {}) };
  if (release) dependencies[name] = release;
  else delete dependencies[name];
  const sorted = Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ ...site, dependencies: sorted }, null, 2)}\n`;
}

/** Plugins on npm, newest-looking first, optionally matching words. Only packages named as plugins are listed. */
export function searchPlugins(words = "", options: PackageFetchOptions = {}): Promise<PackageListing[]> {
  return searchPackages(PLUGIN_KEYWORD, isPluginName, words, { ...options, size: MAX_PLUGINS });
}

/** A plugin's releases on npm, oldest first. */
export async function pluginReleases(name: string, options: PackageFetchOptions = {}): Promise<PackageRelease[]> {
  if (!isPluginName(name)) throw new PackageError("not-a-plugin", `${name} isn't named as a plugin.`);
  return packageReleases(name, options);
}

/** A plugin's release, with what it says it does. */
export interface PluginPackage {
  name: string;
  release: PackageRelease;
  manifest: PluginManifest;
}

/**
 * Reads a plugin's release's `goodfellow-plugin.json` from jsDelivr, checked
 * as a site would check the plugin. Throws a `PackageError` when it can't be
 * read or isn't a plugin's.
 */
export async function fetchPluginPackage(
  name: string,
  release: PackageRelease,
  options: PackageFetchOptions = {},
): Promise<PluginPackage> {
  let raw: unknown;
  try {
    raw = JSON.parse(
      await getPackageText(
        packageFileUrl(name, release.version, PLUGIN_MANIFEST),
        PLUGIN_MANIFEST,
        packageFetch(options),
      ),
    );
  } catch (error) {
    if (error instanceof PackageError) {
      throw error.code === "bad-file" ? new PackageError("not-a-plugin", `${name} has no ${PLUGIN_MANIFEST}.`) : error;
    }
    throw new PackageError("bad-file", `${PLUGIN_MANIFEST} isn't valid JSON.`, PLUGIN_MANIFEST);
  }
  const parsed = pluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PackageError(
      "bad-file",
      `${PLUGIN_MANIFEST}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
      PLUGIN_MANIFEST,
    );
  }
  const manifest = parsed.data;
  const problems = pluginProblems([
    {
      name,
      title: manifest.title,
      permissions: manifest.permissions,
      ...(manifest.admin && { admin: PLUGIN_MANIFEST }),
      ...(manifest.screens && { screens: manifest.screens }),
      ...(manifest.build && { build: manifest.build.map((step) => ({ ...step, module: PLUGIN_MANIFEST })) }),
    },
  ]);
  if (problems.length > 0) throw new PackageError("bad-file", problems[0]?.message ?? "", PLUGIN_MANIFEST);
  return { name, release, manifest };
}

/** A permission a plugin's new release asks for that its installed one didn't, or the other way round. */
export interface PermissionChange {
  key: (typeof PERMISSION_KEYS)[number];
  value: string;
  change: "added" | "removed";
}

/** How a plugin's permissions change from one manifest to another. */
export function permissionChanges(from: PluginManifest, to: PluginManifest): PermissionChange[] {
  const changes: PermissionChange[] = [];
  for (const key of PERMISSION_KEYS) {
    const before = new Set(from.permissions[key] ?? []);
    const after = new Set(to.permissions[key] ?? []);
    for (const value of after) if (!before.has(value)) changes.push({ key, value, change: "added" });
    for (const value of before) if (!after.has(value)) changes.push({ key, value, change: "removed" });
  }
  return changes;
}

/** Why a plugin can't be installed, updated or removed from the admin panel. */
export type PluginInstallProblem =
  /** The config lists plugins of its own, so a developer adds `installedPlugins` to them. */
  | { code: "config" }
  /** A developer added it in code. */
  | { code: "in-code" }
  /** Its blocks' names are taken. */
  | { code: "block-clash"; blocks: string[] }
  /** It isn't installed from the admin panel. */
  | { code: "not-installed" };

export class PluginInstallError extends Error {
  override name = "PluginInstallError";
  constructor(readonly problem: PluginInstallProblem) {
    super(`The plugin can't be changed from the admin panel (${problem.code}).`);
  }
}

/** The site's files an install changes, as they are now. */
export interface PluginInstallSite {
  packageJson: string;
  /** The config's text, at `CONFIG_FILE`. */
  config: string;
  /** `plugins/installed/installed.json`'s text, if the site has one. */
  record?: string;
  /** The site's blocks' names, plugins' included. */
  blocks: readonly string[];
  /** The plugins the site has, installed from the admin panel or added in code, by name. */
  plugins: readonly string[];
}

export interface PluginPlan {
  changes: FileChange[];
  record: InstalledPlugins;
  /** Whether the config is changed to list installed plugins, for sites made before it did. */
  configChanged: boolean;
}

function recordChanges(record: InstalledPlugins): FileChange[] {
  return [
    { path: INSTALLED_PLUGINS_FILE, content: serializeContent(record) },
    { path: INSTALLED_PLUGINS_INDEX, content: installedPluginsIndex(record) },
  ];
}

/**
 * The changes that install a plugin's release, or update an installed one to
 * it: `package.json` names it at that release, the record says what was
 * approved, and the config lists installed plugins if it didn't. Throws a
 * `PluginInstallError`.
 */
export function planPluginInstall(
  site: PluginInstallSite,
  plugin: PluginPackage,
  options: { today: string },
): PluginPlan {
  const record = parseInstalledPlugins(site.record);
  const before = record.plugins[plugin.name];
  if (!before && site.plugins.includes(plugin.name)) throw new PluginInstallError({ code: "in-code" });
  const own = new Set(before?.manifest.blocks ?? []);
  const clashes = (plugin.manifest.blocks ?? []).filter((block) => site.blocks.includes(block) && !own.has(block));
  if (clashes.length > 0) throw new PluginInstallError({ code: "block-clash", blocks: clashes });
  const config = withInstalledPluginsConfig(site.config);
  if (config === undefined) throw new PluginInstallError({ code: "config" });
  const next: InstalledPlugins = {
    version: 1,
    plugins: {
      ...record.plugins,
      [plugin.name]: {
        release: plugin.release.version,
        installed: options.today,
        ...(plugin.release.goodfellow && { goodfellow: plugin.release.goodfellow }),
        manifest: plugin.manifest,
      },
    },
  };
  const configChanged = config !== site.config;
  return {
    changes: [
      { path: "package.json", content: withDependency(site.packageJson, plugin.name, plugin.release.version) },
      ...recordChanges(next),
      ...(configChanged ? [{ path: CONFIG_FILE, content: config }] : []),
    ],
    record: next,
    configChanged,
  };
}

/** The changes that remove a plugin installed from the admin panel. Throws a `PluginInstallError`. */
export function planPluginRemove(site: Pick<PluginInstallSite, "packageJson" | "record">, name: string): PluginPlan {
  const record = parseInstalledPlugins(site.record);
  if (!record.plugins[name]) throw new PluginInstallError({ code: "not-installed" });
  const { [name]: _removed, ...rest } = record.plugins;
  const next: InstalledPlugins = { version: 1, plugins: rest };
  return {
    changes: [
      { path: "package.json", content: withDependency(site.packageJson, name, undefined) },
      ...recordChanges(next),
    ],
    record: next,
    configChanged: false,
  };
}

/** The installed plugins whose `peerDependencies` range leaves out a Goodfellow release, which updating to it would break. */
export function pluginsOutOfRange(
  record: InstalledPlugins,
  release: string,
): { name: string; title: string; range: string }[] {
  return Object.entries(record.plugins).flatMap(([name, plugin]) =>
    plugin.goodfellow && !inRange(release, plugin.goodfellow)
      ? [{ name, title: plugin.manifest.title, range: plugin.goodfellow }]
      : [],
  );
}

/**
 * Whether the site's setup writes the lockfile when `package.json` names
 * packages it doesn't have, as the starters' do since plugins could be
 * installed from the admin panel; without that, installing one would stop the
 * site building. `files` are its setup files' texts.
 */
export function writesLockfile(files: Iterable<string | undefined>): boolean {
  for (const text of files) if (text?.includes("--package-lock-only")) return true;
  return false;
}
