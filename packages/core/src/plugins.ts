/**
 * Plugins add to a site what blocks can't: code in the admin panel, screens
 * of their own, steps in the build and routes on full-stack sites' servers,
 * as well as blocks. A developer adds one in the site's config
 * (`plugins: [s3({ … })]`). Each part runs where Goodfellow can hold it to
 * the permissions the plugin declares:
 * - its blocks run in the editor's sandboxed frames, like any block;
 * - its admin module runs in a sandboxed frame of its own, whose Content
 *   Security Policy reaches only the addresses it declared (`connect`), and
 *   whose screens read and publish only the files it declared (`files`);
 * - its build steps each run in a process of their own, with only the
 *   environment variables it declared (`secrets`) and Node's permission model
 *   limiting the files they read and write (`read`, `write`);
 * - its server module answers requests on full-stack sites with everything
 *   the server has, which only a review can back.
 *
 * Its admin, build and server parts are named by module, never imported
 * here, since the config is loaded in the browser too: each runtime loads
 * only its own part.
 */
import type { ComponentConfig, Config } from "@puckeditor/core";

/** The npm keyword, and the GitHub and GitLab topic, plugins are found by. */
export const PLUGIN_KEYWORD = "goodfellow-plugin";

/** Where builds put each plugin's admin frame, from the site's base. */
export const PLUGINS_PATH = "admin/plugins/";

export interface GoodfellowPlugin {
  /** Its npm package's name: `goodfellow-plugin-<name>` or `@scope/goodfellow-plugin-<name>`. */
  name: string;
  /** What owners call it, such as "S3 storage". */
  title: string;
  /** Its package's version, shown in the admin panel. */
  version?: string;
  /** One sentence on what it does. */
  description?: string;
  /** What it may do. Leave out what it doesn't need: it gets nothing it doesn't declare. */
  permissions?: PluginPermissions;
  /** Blocks it adds, by the name content refers to them by, which no other block may have. */
  // biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
  blocks?: Record<string, ComponentConfig<any>>;
  /** Groups for its blocks in the editor's block list. */
  categories?: Config["categories"];
  /**
   * The module run in the admin panel, in a sandboxed frame of its own, such
   * as `"goodfellow-plugin-s3/admin"`, or a path from the site's root: its
   * default export is a `PluginAdmin`, made with `definePluginAdmin()`.
   */
  admin?: string;
  /** Screens its admin module draws, listed in Site Settings. */
  screens?: PluginScreen[];
  /** Steps run after the site is built, in order. */
  build?: PluginBuildStep[];
  /**
   * The module answering requests to `/__goodfellow/api/plugins/<id>/…` on
   * full-stack Next.js sites: its default export is a `PluginServer` (from
   * `@goodfellow-cms/core/node`). Ignored
   * on static sites, which have no server.
   */
  server?: string;
}

export interface PluginPermissions {
  /**
   * Addresses its admin module may request, as origins: `https://api.example.com`,
   * or `https://*.example.com` for every address under it. `http://` only for
   * `localhost` and `127.0.0.1`, for development. The services must allow
   * requests from any origin (`Access-Control-Allow-Origin: *`), since the
   * plugin's frame has none of its own.
   */
  connect?: string[];
  /**
   * Content files and media its screens may read and publish: a file such as
   * `content/media.json`, or a folder ending in `/`, under `content/` or
   * `public/media/`, but never the site's own code in `content/code/`.
   */
  files?: string[];
  /** Environment variables its build steps get, such as `S3_SECRET_KEY`. They get no others. */
  secrets?: string[];
  /**
   * Files and folders its build steps may read, from the site's root, besides
   * the built site, their own package and `node_modules`, such as `content/`.
   */
  read?: string[];
  /** Files and folders in the built site its build steps may write, such as `media/`. */
  write?: string[];
}

export interface PluginScreen {
  /** Its name in the screen's address, lowercase letters, digits and dashes. */
  id: string;
  /** What Site Settings calls it. */
  title: string;
}

export interface PluginBuildStep {
  /** Its name in the build's output, lowercase letters, digits and dashes. */
  id: string;
  /** The module whose default export is a `PluginBuildStepRun`, as for `admin`. */
  module: string;
  /** What the build's output calls it. */
  title?: string;
}

/** What a build step gets: where the built site is, and the secrets it declared. */
export interface PluginBuildContext {
  /** The site's root. Only the folders the plugin declared in `read` can be read there. */
  root: string;
  /** The built site, which the step may read, and write where it declared. */
  outDir: string;
  /** The site's base path, such as `/` or `/docs/`. */
  base: string;
  /** The environment variables it declared, those that are set. */
  secrets: Record<string, string>;
}

export type PluginBuildStepRun = (context: PluginBuildContext) => void | Promise<void>;

/** Who's asking a plugin's server module, as the full-stack site's sign-in says. */
export interface PluginServerEditor {
  login: string;
  name?: string;
  email?: string;
  role: "owner" | "editor";
}

/** What a plugin's screens and services can ask the admin panel for. */
export interface PluginAdminApi {
  /** The plugin's own description, as the admin panel knows it. */
  plugin: PluginDescription;
  /** The live site's address. */
  siteUrl: string;
  /** Reads files the plugin declared in `files`, as text: missing files are `null`. */
  read(paths: string[]): Promise<Record<string, string | null>>;
  /** Reads a file the plugin declared, as bytes, such as a picture in the media library. */
  readBytes(path: string): Promise<Uint8Array | null>;
  /** Lists the files the plugin declared that exist, under a folder such as `public/media/`. */
  list(folder: string): Promise<string[]>;
  /**
   * Publishes changes to files the plugin declared, in one publish, as an
   * editor would, after the admin panel's checks. Anything else is refused.
   */
  publish(changes: PluginFileChange[], message: string): Promise<{ published: boolean }>;
  /**
   * Asks the plugin's server module, on full-stack sites, through the admin
   * panel's page, signed in. On static sites it throws.
   */
  server(
    path: string,
    init?: { method?: string; body?: string; headers?: Record<string, string> },
  ): Promise<{
    status: number;
    body: string;
  }>;
  /** Opens one of the admin panel's screens, such as `#/media`, asking first about unpublished changes. */
  navigate(href: string): void;
}

/** One file to write or delete. */
export type PluginFileChange =
  | { path: string; text: string }
  | { path: string; bytes: Uint8Array }
  | { path: string; delete: true };

/**
 * A screen's code: draws into `element`, and may return a function, or a
 * promise of one, that cleans up when the screen closes.
 */
export type PluginScreenMount = (element: HTMLElementLike, api: PluginAdminApi) => unknown;

/** The element a screen draws into: a DOM element, named loosely so core needs no DOM types. */
export type HTMLElementLike = { ownerDocument: unknown };

/** The default export of a plugin's admin module. */
export interface PluginAdmin {
  /**
   * What its blocks in the editor, or other plugins' code there, may ask it
   * for, by name: each gets the arguments the caller passed (anything a
   * structured clone keeps) and the admin panel's API.
   */
  services?: Record<string, (args: unknown[], api: PluginAdminApi) => unknown>;
  /** Each of the plugin's screens, by the id it declared. */
  screens?: Record<string, PluginScreenMount>;
}

/** Declares a plugin with full type checking. Returns it unchanged. */
export function definePlugin<const T extends GoodfellowPlugin>(plugin: T): T {
  return plugin;
}

/** Declares a plugin's admin module with full type checking. Returns it unchanged. */
export function definePluginAdmin(admin: PluginAdmin): PluginAdmin {
  return admin;
}

/** A plugin as the admin panel and tools know it, without its code, in the site's description. */
export interface PluginDescription {
  name: string;
  title: string;
  version?: string;
  description?: string;
  permissions: PluginPermissions;
  /** Its id in addresses (`pluginId()`). */
  id: string;
  /** Whether it has an admin module. */
  admin?: boolean;
  screens?: PluginScreen[];
  /** Its build steps' names. */
  build?: { id: string; title?: string }[];
  /** Whether it answers requests on full-stack sites. */
  server?: boolean;
}

/** Whether a package's name is a plugin's: `goodfellow-plugin-<name>` or `@scope/goodfellow-plugin-<name>`. */
export function isPluginName(name: string): boolean {
  return /^(@[a-z0-9][a-z0-9._-]*\/)?goodfellow-plugin-[a-z0-9][a-z0-9._-]*$/.test(name);
}

/** A plugin's name in addresses, such as its frame's: `@acme/goodfellow-plugin-s3` is `acme--goodfellow-plugin-s3`. */
export function pluginId(name: string): string {
  return name.replace(/^@/, "").replace("/", "--");
}

/** Why a plugin can't be used. */
export interface PluginProblem {
  plugin: string;
  code:
    | "bad-name"
    | "duplicate"
    | "no-title"
    | "bad-connect"
    | "bad-file"
    | "bad-secret"
    | "bad-read"
    | "bad-write"
    | "bad-screen"
    | "bad-step"
    | "no-admin"
    | "block-clash"
    | "not-approved";
  /** What's wrong, for the developer. */
  message: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;
const SECRET = /^[A-Z_][A-Z0-9_]*$/;
/**
 * Environment variables no build step gets, whatever it declares: tokens that
 * can publish to the repository, and variables that change how Node runs.
 */
const RESERVED_SECRETS = /^(GITHUB_TOKEN|GH_TOKEN|CI_JOB_TOKEN|GOODFELLOW_GIT_TOKEN|ACTIONS_.*|NODE_.*|NPM_.*|npm_.*)$/;

/** Whether an origin is one a plugin may declare in `connect`. */
export function isPluginOrigin(origin: string): boolean {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin)) return true;
  return /^https:\/\/(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(:\d{1,5})?$/.test(origin);
}

/** A path relative to somewhere, with no way out of it. */
function isRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !/^[a-zA-Z]:/.test(path) &&
    path
      .split("/")
      .every((part, index, parts) => part !== ".." && part !== "." && (part !== "" || index === parts.length - 1))
  );
}

/** Whether a plugin may declare a file or folder in `files`. */
export function isPluginFile(path: string): boolean {
  return (
    isRelativePath(path) &&
    (path.startsWith("content/") || path.startsWith("public/media/")) &&
    path !== "content/" &&
    !path.startsWith("content/code/") &&
    path !== "content/code"
  );
}

/** Finds what's wrong with a site's plugins, and with their blocks beside the site's own. */
export function pluginProblems(
  plugins: readonly GoodfellowPlugin[],
  // biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
  siteBlocks: Record<string, ComponentConfig<any>> = {},
): PluginProblem[] {
  const problems: PluginProblem[] = [];
  const seen = new Set<string>();
  const blockOwners = new Map<string, string>(Object.keys(siteBlocks).map((name) => [name, "the site"]));
  for (const plugin of plugins) {
    const name = typeof plugin?.name === "string" ? plugin.name : String(plugin?.name);
    const problem = (code: PluginProblem["code"], message: string) => problems.push({ plugin: name, code, message });
    if (!isPluginName(name)) {
      problem("bad-name", `"${name}" isn't a plugin's name: plugins are called goodfellow-plugin-<name>.`);
    }
    if (seen.has(pluginId(name))) problem("duplicate", `${name} is listed twice.`);
    seen.add(pluginId(name));
    if (typeof plugin.title !== "string" || !plugin.title.trim()) problem("no-title", `${name} has no title.`);
    const permissions = plugin.permissions ?? {};
    for (const origin of permissions.connect ?? []) {
      if (!isPluginOrigin(origin)) {
        problem("bad-connect", `${name} asks to reach "${origin}", which isn't an https:// origin.`);
      }
    }
    for (const path of permissions.files ?? []) {
      if (!isPluginFile(path)) {
        problem(
          "bad-file",
          `${name} asks for "${path}": plugins may have files under content/ or public/media/ only, never content/code/.`,
        );
      }
    }
    for (const secret of permissions.secrets ?? []) {
      if (!SECRET.test(secret) || RESERVED_SECRETS.test(secret)) {
        problem("bad-secret", `${name} asks for the environment variable "${secret}", which build steps can't have.`);
      }
    }
    for (const path of permissions.read ?? []) {
      if (!isRelativePath(path) || path.split("/")[0] === ".git") {
        problem("bad-read", `${name} asks to read "${path}", which isn't a path in the site.`);
      }
    }
    for (const path of permissions.write ?? []) {
      if (!isRelativePath(path))
        problem("bad-write", `${name} asks to write "${path}", which isn't a path in the built site.`);
    }
    const screenIds = new Set<string>();
    for (const screen of plugin.screens ?? []) {
      if (!ID.test(screen?.id ?? "") || screenIds.has(screen.id) || !screen.title?.trim()) {
        problem(
          "bad-screen",
          `${name} has a screen without a title or an id of lowercase letters, digits and dashes of its own.`,
        );
      }
      screenIds.add(screen?.id);
    }
    if ((plugin.screens?.length ?? 0) > 0 && !plugin.admin) {
      problem("no-admin", `${name} has screens but no admin module to draw them.`);
    }
    const stepIds = new Set<string>();
    for (const step of plugin.build ?? []) {
      if (!ID.test(step?.id ?? "") || stepIds.has(step.id) || typeof step.module !== "string" || !step.module) {
        problem(
          "bad-step",
          `${name} has a build step without a module or an id of lowercase letters, digits and dashes of its own.`,
        );
      }
      stepIds.add(step?.id);
    }
    for (const block of Object.keys(plugin.blocks ?? {})) {
      const owner = blockOwners.get(block);
      if (owner) problem("block-clash", `${name}'s block "${block}" has the same name as one of ${owner}'s.`);
      else blockOwners.set(block, name);
    }
  }
  return problems;
}

/** A site's plugins can't be used: the config names a plugin wrongly, or two blocks share a name. */
export class PluginError extends Error {
  override name = "PluginError";
  constructor(readonly problems: PluginProblem[]) {
    super(problems.map((problem) => problem.message).join("\n"));
  }
}

interface WithPlugins {
  // biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
  blocks: Record<string, ComponentConfig<any>>;
  categories?: Config["categories"];
  plugins?: readonly GoodfellowPlugin[];
}

/**
 * The config with its plugins' blocks and categories added to its own, so
 * everything that reads the config's blocks sees them. `defineConfig()` does
 * it, so a plugin named wrongly, or a block's name taken twice, stops the
 * site from loading at all. Throws a `PluginError`.
 */
export function withPlugins<T extends WithPlugins>(config: T): T {
  const plugins = config.plugins ?? [];
  if (plugins.length === 0) return config;
  const problems = pluginProblems(plugins, config.blocks);
  if (problems.length > 0) throw new PluginError(problems);
  return {
    ...config,
    blocks: Object.assign({}, config.blocks, ...plugins.map((plugin) => plugin.blocks ?? {})),
    ...(plugins.some((plugin) => plugin.categories) && {
      categories: Object.assign({}, config.categories, ...plugins.map((plugin) => plugin.categories ?? {})),
    }),
  };
}

/** A plugin as the site's description lists it. */
export function describePlugin(plugin: GoodfellowPlugin): PluginDescription {
  return {
    name: plugin.name,
    title: plugin.title,
    ...(plugin.version && { version: plugin.version }),
    ...(plugin.description && { description: plugin.description }),
    permissions: {
      ...(plugin.permissions?.connect?.length && { connect: [...plugin.permissions.connect] }),
      ...(plugin.permissions?.files?.length && { files: [...plugin.permissions.files] }),
      ...(plugin.permissions?.secrets?.length && { secrets: [...plugin.permissions.secrets] }),
      ...(plugin.permissions?.read?.length && { read: [...plugin.permissions.read] }),
      ...(plugin.permissions?.write?.length && { write: [...plugin.permissions.write] }),
    },
    id: pluginId(plugin.name),
    ...(plugin.admin && { admin: true }),
    ...(plugin.screens?.length && { screens: plugin.screens.map(({ id, title }) => ({ id, title })) }),
    ...(plugin.build?.length && { build: plugin.build.map(({ id, title }) => ({ id, ...(title && { title }) })) }),
    ...(plugin.server && { server: true }),
  };
}

/** Whether a plugin declared a file, itself or a folder it's in, for its screens to read and publish. */
export function pluginMayUse(permissions: PluginPermissions, path: string): boolean {
  if (!isRelativePath(path) || path.endsWith("/") || !isPluginFile(path)) return false;
  return (permissions.files ?? []).some((declared) =>
    declared.endsWith("/") ? path.startsWith(declared) : path === declared,
  );
}

/** Whether a folder is one a plugin may list: a folder it declared, or one inside it. */
export function pluginMayList(permissions: PluginPermissions, folder: string): boolean {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  if (!isRelativePath(prefix)) return false;
  return (permissions.files ?? []).some((declared) =>
    declared.endsWith("/") ? prefix.startsWith(declared) || declared.startsWith(prefix) : declared.startsWith(prefix),
  );
}

/**
 * Where a plugin's admin frame is, beside the editor's frames, such as
 * `/admin/plugins/goodfellow-plugin-s3/index.html`: the page itself, since
 * servers such as `next start` serve public files only at their own address.
 */
export function pluginFrameUrl(editorUrl: string, id: string): string {
  const base = editorUrl.endsWith("/") ? editorUrl : `${editorUrl}/`;
  return `${base.replace(/[^/]+\/$/, "")}plugins/${encodeURIComponent(id)}/index.html`;
}

/**
 * The Content Security Policy of a plugin's admin frame: it runs only its
 * own script, and requests only the addresses the plugin declared. Like the
 * editor's frames, it's sandboxed without `allow-same-origin`, so it never
 * reaches the admin panel's sign-in, and can still leave for another address,
 * so the policy limits what it can send while it's there without sealing it.
 */
export function pluginPolicy(permissions: PluginPermissions): string {
  const connect = (permissions.connect ?? []).filter(isPluginOrigin);
  const reach = connect.length > 0 ? ` ${connect.join(" ")}` : "";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src 'self' data: blob:${reach}`,
    `media-src 'self' blob:${reach}`,
    `connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The page of a plugin's admin frame, as every build and development server
 * writes it: its policy first, then its stylesheets and its one classic
 * script, which starts with `EDITOR_PRELUDE`, so it runs only sandboxed.
 */
export function pluginFramePage(options: {
  permissions: PluginPermissions;
  scripts: readonly string[];
  stylesheets: readonly string[];
}): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    `    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(pluginPolicy(options.permissions))}" />`,
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="robots" content="noindex" />',
    ...options.stylesheets.map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}" />`),
    "  </head>",
    '  <body class="gfa-plugin-frame">',
    '    <div id="goodfellow-plugin"></div>',
    ...options.scripts.map((src) => `    <script src="${escapeAttribute(src)}"></script>`),
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * The entry module that bundles a plugin's admin module into its frame: the
 * frame's runtime from `@goodfellow-cms/admin/plugin`, given the module's
 * default export, with the admin panel's stylesheet for its look.
 */
export function pluginFrameEntry(adminModule: string): string {
  return [
    `import admin from ${JSON.stringify(adminModule)};`,
    `import { mountPluginFrame } from "@goodfellow-cms/admin/plugin";`,
    `import "@goodfellow-cms/admin/plugin.css";`,
    "mountPluginFrame(admin);",
  ].join("\n");
}

/** The plugins that have an admin frame to build. */
export function framedPlugins(plugins: readonly GoodfellowPlugin[] | undefined): GoodfellowPlugin[] {
  return (plugins ?? []).filter((plugin) => typeof plugin.admin === "string" && plugin.admin.length > 0);
}
