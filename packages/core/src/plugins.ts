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
 * - its build steps and tasks each run in a process of their own, with only
 *   the environment variables it declared (`secrets`) and Node's permission
 *   model limiting the files they read and write (`read`, `write`);
 * - its server module answers requests on full-stack sites with everything
 *   the server has, which only a review can back.
 *
 * Its admin, build and server parts are named by module, never imported
 * here, since the config is loaded in the browser too: each runtime loads
 * only its own part.
 */
import type { ComponentConfig, Config, Data } from "@puckeditor/core";
import type { PageLink } from "./content/page-links.js";
import type { SiteSettings } from "./content/schemas.js";
import type { BlockDescription } from "./site-description.js";

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
   * Work its admin module asks the site's CI to do (`api.task()`), with the
   * secrets only CI holds, such as signing uploads with a storage service's
   * keys. Each takes about a minute, since CI starts a job for it.
   */
  tasks?: PluginTask[];
  /**
   * The module answering requests to `/__goodfellow/api/plugins/<id>/…` on
   * full-stack Next.js sites: its default export is a `PluginServer` (from
   * `@goodfellow-cms/core/node`). Ignored
   * on static sites, which have no server.
   */
  server?: string;
  /**
   * Whether it keeps the site's media outside the repository, such as in S3
   * storage: its admin module's `media` uploads and removes files, usually
   * through a task, and the admin panel lists them in
   * `content/media-storage.json`, which builds read to show them from the
   * storage's address.
   */
  mediaStorage?: PluginMediaStorageOptions;
  /**
   * Whether its admin module draws a page editor (its `editor`), which each
   * person editing the site can choose in place of Puck, for the kinds of
   * page it lists. It's given what's edited and hands it back; the admin panel
   * checks what comes back against the blocks' fields before publishing.
   */
  editor?: PluginEditorOptions;
  /**
   * What a developer chose for it in the site's config, as JSON, which its
   * admin module reads (`api.plugin.options`), such as more services for it
   * to offer. At most `MAX_PLUGIN_OPTIONS` characters, and never secret:
   * builds publish it with the site's description.
   */
  options?: PluginOptions;
}

/** What an editor plugin edits, and what people choosing it see. */
export interface PluginEditorOptions {
  /** What the editor is called where people choose it, such as "Gutenberg". */
  title: string;
  /** What it can edit: pages unless it says more. Items' fields stay in Puck's item editor. */
  kinds?: PluginEditorKind[];
}

/** What an editor plugin can edit: pages, the header and footer, or collections' templates. */
export type PluginEditorKind = "page" | "header" | "footer" | "template";

/** Every kind of page an editor plugin may say it edits. */
export const PLUGIN_EDITOR_KINDS: readonly PluginEditorKind[] = ["page", "header", "footer", "template"];

/** The kinds an editor plugin edits: pages, unless it lists others. */
export function pluginEditorKinds(editor: Pick<PluginEditorOptions, "kinds">): PluginEditorKind[] {
  return editor.kinds?.length ? [...editor.kinds] : ["page"];
}

export interface PluginMediaStorageOptions {
  /** The largest file it takes, in bytes. The admin panel's own limit, 25 MB, applies without it. */
  maxBytes?: number;
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
  /** Environment variables its build steps and tasks get, such as `S3_SECRET_KEY`. They get no others. */
  secrets?: string[];
  /**
   * Files and folders its build steps and tasks may read, from the site's
   * root, besides the built site, their own package and `node_modules`, such
   * as `content/`.
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

export interface PluginTask {
  /** Its name in `api.task()`, lowercase letters, digits and dashes. */
  id: string;
  /** The module whose default export is a `PluginTaskRun`, as for `admin`. */
  module: string;
  /** What CI's output calls it. */
  title?: string;
}

/** What a task gets besides its input: the site's root, and the secrets it declared. */
export interface PluginTaskContext {
  /** The site's root. Only the folders the plugin declared in `read` can be read there. */
  root: string;
  /** The environment variables it declared, those that are set. */
  secrets: Record<string, string>;
}

/**
 * A task's code: given what the plugin's admin module passed (as the admin
 * module may have been told anything by whoever used the admin panel, check
 * it), it answers with anything JSON keeps, which the admin module gets.
 * Throwing an `Error` answers with its message.
 */
export type PluginTaskRun = (input: unknown, context: PluginTaskContext) => unknown;

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
  /**
   * Runs one of the plugin's tasks in the site's CI, with its secrets,
   * answering with what the task returned. It takes about a minute. Throws
   * where the site's setup can't run tasks, or the task failed, with its
   * message.
   */
  task(id: string, input?: unknown): Promise<unknown>;
  /**
   * How the site's owner adds the secrets the plugin declared, for this site
   * as it's set up, in the admin panel's words: the first is where its tasks
   * get them, and a full-stack site's server comes with the CI as a second.
   * Empty where tasks can't run.
   */
  secretsHelp(): Promise<PluginSecretsHelp[]>;
  /**
   * Opens one of the links `secretsHelp()` gave in a new tab, which a
   * plugin's frame can't do itself. Call it as the person clicks.
   */
  openSecretsLink(url: string): void;
}

/**
 * How to add the secrets a plugin declared, in the admin panel's words, for
 * a plugin's screen to show as they are.
 */
export interface PluginSecretsHelp {
  /** Where they go: the development server's `.env.local`, a full-stack site's server, or GitHub's or GitLab's CI. */
  where: "development" | "server" | "github" | "gitlab" | "bitbucket";
  /** A heading for these steps, such as "On GitHub". */
  title: string;
  /** The page the secrets are added on, where there is one, and what to call the link. */
  link?: { url: string; label: string };
  /** What to do, in order; a step may come with something to type or paste, such as a line of a file. */
  steps: { text: string; code?: string }[];
  /** Anything else worth knowing, such as who can open the page. */
  notes: string[];
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

/** A file's contents as the admin panel hands it over: a browser's `Blob`, named loosely so core needs no DOM types. */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A file for media storage to keep, with its contents. */
export interface PluginMediaFile {
  /** The address content will use, such as `/media/sermon.mp4`, which `isStorableAddress()` accepts. */
  address: string;
  /** Its media type, such as `video/mp4`. */
  type: string;
  size: number;
  data: BlobLike;
}

/** Whether media storage can take files now, or what needs doing first, in the plugin's words. */
export type PluginMediaReady = { ready: true } | { ready: false; message: string; screen?: string };

/** What a plugin that keeps media (`mediaStorage`) does in the admin panel. */
export interface PluginMediaStorage {
  /** Whether it can take files now, such as once it's set up. */
  ready(api: PluginAdminApi): Promise<PluginMediaReady>;
  /**
   * Keeps files at their addresses, replacing any there, all together, since
   * each batch may wait for a task. Throws, with what went wrong, when it
   * can't keep them all.
   */
  upload(files: PluginMediaFile[], api: PluginAdminApi): Promise<void>;
  /** Removes files it keeps, by address, once the site no longer lists them. */
  remove(addresses: string[], api: PluginAdminApi): Promise<void>;
}

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
  /** Where it keeps media, for a plugin that says it does (`mediaStorage`). */
  media?: PluginMediaStorage;
  /** The page editor it draws, for a plugin that says it has one (`editor`). */
  editor?: PluginEditor;
}

/** A page's data as Puck keeps it: its settings (`root.props`) and its blocks, with blocks inside blocks in their slots. */
export type PluginEditorData = Data;

/** One block of what's edited, as `PluginEditorData` holds it. */
export type PluginEditorBlock = Data["content"][number];

/**
 * The element `draw()` leaves in each of a block's slots, empty, with the
 * slot's name: `<gf-slot data-slot="content"></gf-slot>`.
 */
export const DRAWN_SLOT_ELEMENT = "gf-slot";

/** What's open in an editor plugin, and what it can ask the admin panel for while it's open. */
export interface PluginEditorSession {
  /** What's edited: a page, the header or footer, or a collection's template. */
  kind: PluginEditorKind;
  /** The page's address, or the language's home for the header and footer. */
  path: string;
  /** What the admin panel calls it, such as the page's title. */
  title: string;
  /** The language of what's edited, on a site in several languages. */
  language?: string;
  /** What's edited as it is now, which may have changes not yet published. */
  data: PluginEditorData;
  /**
   * The blocks it may use, by the name content refers to them by, with their
   * fields as JSON (as the site's description has them): only these, with
   * values that fit their fields, can be published.
   */
  blocks: Record<string, BlockDescription>;
  /** The page settings' fields, such as its title; the header and footer have none. */
  root: { fields: Record<string, unknown> };
  /** For a collection's template: the collection, whose fields `{name}` placeholders in text fill in. */
  collection?: { id: string; name: string; fields: { name: string; label: string; type: string }[] };
  /** Site Settings, such as the theme's colors and fonts. */
  settings: SiteSettings;
  /** The site's pages in the language edited, for links. */
  pages: PageLink[];
  /**
   * The admin panel shows the site's media in the frame's page itself, as in
   * Puck's: `/media/…` addresses in images, links, posters and inline styles,
   * as drawn blocks have them, are shown from where each file is now (the
   * site's folder on a site in one, the browser's memory for an upload not
   * yet published, or the storage a plugin keeps media in), except in text
   * edited in place (`contenteditable`), so what's read back from it stays as
   * content has it. Leave the addresses as they are. Releases before this one
   * leave it out, and change nothing.
   */
  showsMedia?: true;
  /**
   * Tells the admin panel what's edited now, whenever it changes, so it knows
   * there's something to publish: with whether there's something to undo and
   * redo, and the block selected, by its id, for the AI assistant.
   */
  change(data: PluginEditorData, state?: PluginEditorState): void;
  /** Opens the media library to choose a file of a kind, answering with its address, or `null`. */
  chooseMedia(kind: "image" | "video" | "audio" | "file", value?: string): Promise<string | null>;
  /** How a link to the page looks when it's shared, from its settings or else Site Settings'. */
  sharePreview(root: PluginEditorData["root"]): Promise<PluginSharePreview>;
  /**
   * One block drawn as the site draws it, as HTML, by the site's own code in
   * a frame of the admin panel's, so an editor needs none of the blocks' code:
   * in the page edited, with each of its slots left as an empty
   * `DRAWN_SLOT_ELEMENT` for the editor to put the slot's blocks in. The
   * blocks in its slots aren't drawn, and nothing in it runs: it's the
   * HTML the site's pages have, before their scripts start.
   */
  draw(block: PluginEditorBlock): Promise<string>;
  /**
   * The block's settings as its props now make them, as JSON like `blocks`'
   * fields: for blocks whose description says `resolvesFields`, which choose
   * them in the site's code, such as the Comments block offering Giscus's
   * settings only for Giscus. Other blocks' are `blocks`' own. Admin panels
   * from before it have none, so call it as `session.fields?.(block)`.
   */
  fields?(block: PluginEditorBlock): Promise<Record<string, unknown>>;
  /** The site's styles, for drawn blocks to look as they do on the site. */
  styles(): Promise<PluginEditorStyles>;
}

/** The site's styles, for an editor plugin to show drawn blocks with. */
export interface PluginEditorStyles {
  /**
   * The site's stylesheets as CSS text, as its last build compiled them, with
   * the theme's colors and fonts as they are now.
   */
  stylesheets: string[];
  /**
   * Tailwind's source for the site, to compile with `@tailwindcss/browser`
   * (in a `<style type="text/tailwindcss">`) where blocks may have classes
   * the last build hasn't seen yet, such as ones an editor just chose: the
   * theme's classes and the custom CSS as it is now. The admin panel's own
   * previews do the same.
   */
  tailwind: string;
  /**
   * The theme's Google Fonts stylesheet (`googleFontsUrl()`), if it uses any,
   * to load with a `<link rel="stylesheet">` where blocks are shown: the
   * stylesheets name the fonts but don't load them. An editor plugin's frame
   * may load it, and the fonts it names.
   */
  fonts?: string;
}

/** What an editor plugin says about itself as it changes. */
export interface PluginEditorState {
  past?: boolean;
  future?: boolean;
  /** The selected block's id, or `null`. */
  selected?: string | null;
}

/** How a link to a page looks when it's shared, as `getPageHead()` works it out. */
export interface PluginSharePreview {
  title: string;
  description?: string;
  /** The picture's address, such as `/media/church.jpg`. */
  image?: string;
  /** The site's domain, without a Site address none. */
  host?: string;
  /** Whether the page is hidden from search engines. */
  noIndex: boolean;
}

/** What an editor plugin's `mount` may give back, for the admin panel's header to use. */
export interface PluginEditorControls {
  /** What's edited now, which Publish publishes. Without it, the last `change()`. */
  data?(): PluginEditorData | Promise<PluginEditorData>;
  /** Replaces what's edited, such as with the AI assistant's changes; without it, the AI assistant isn't offered. */
  set?(data: PluginEditorData): void | Promise<void>;
  /** Undo and Redo, which the admin panel's header offers when it has both. */
  undo?(): void;
  redo?(): void;
  /** Cleans up when the editor closes. */
  destroy?(): void;
}

/** The page editor an editor plugin's admin module draws. */
export interface PluginEditor {
  /** Draws the editor into `element`, for what `session` says is open. */
  mount(
    element: HTMLElementLike,
    session: PluginEditorSession,
    api: PluginAdminApi,
  ): PluginEditorControls | undefined | Promise<PluginEditorControls | undefined>;
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
  /** Its tasks' names. */
  tasks?: { id: string; title?: string }[];
  /** Whether it answers requests on full-stack sites. */
  server?: boolean;
  /** Whether it keeps media, and the largest file it takes. */
  mediaStorage?: PluginMediaStorageOptions;
  /** The page editor it draws, and what it edits. */
  editor?: { title: string; kinds: PluginEditorKind[] };
  /** What the site's config chose for it, for its admin module. */
  options?: PluginOptions;
}

/** A plugin's options in the site's config: anything JSON keeps. */
export type PluginOptions = { [key: string]: unknown };

/** How long a plugin's options may be, as JSON. */
export const MAX_PLUGIN_OPTIONS = 16_000;

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
    | "bad-task"
    | "no-admin"
    | "block-clash"
    | "bad-storage"
    | "bad-editor"
    | "bad-options"
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
/**
 * Variables no plugin may ask for: the git hosts' and CI services' own
 * credentials and settings (GitHub's, GitLab's `CI_*`, such as
 * `CI_REGISTRY_PASSWORD` and `CI_JOB_JWT`, Bitbucket's, such as
 * `BITBUCKET_STEP_OIDC_TOKEN`, the runners'), the hosts' that deploy sites,
 * Goodfellow's own git token, and Node's and npm's, which change what runs.
 */
const RESERVED_SECRETS =
  /^(GH_TOKEN|GITHUB_.*|ACTIONS_.*|RUNNER_.*|CI|CI_.*|GITLAB_.*|BITBUCKET_.*|VERCEL|VERCEL_.*|CF_.*|CLOUDFLARE_.*|GOODFELLOW_GIT_TOKEN|NODE_.*|NPM_.*)$/;

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
    if (plugin.mediaStorage) {
      const { maxBytes } = plugin.mediaStorage;
      if (!plugin.admin) problem("no-admin", `${name} keeps media but has no admin module to upload it.`);
      if (maxBytes !== undefined && !(Number.isSafeInteger(maxBytes) && maxBytes > 0)) {
        problem("bad-storage", `${name}'s largest file for media storage isn't a number of bytes.`);
      }
    }
    if (plugin.editor) {
      const { title, kinds } = plugin.editor;
      if (!plugin.admin) problem("no-admin", `${name} has a page editor but no admin module to draw it.`);
      const known = (kinds ?? []).every((kind) => PLUGIN_EDITOR_KINDS.includes(kind));
      if (typeof title !== "string" || !title.trim() || (kinds !== undefined && !Array.isArray(kinds)) || !known) {
        problem("bad-editor", `${name}'s page editor needs a title, and edits only ${PLUGIN_EDITOR_KINDS.join(", ")}.`);
      }
    }
    if (plugin.options !== undefined) {
      let json: string | undefined;
      try {
        json = JSON.stringify(plugin.options);
      } catch {
        json = undefined;
      }
      const plain = json !== undefined && typeof plugin.options === "object" && !Array.isArray(plugin.options);
      if (!plain || json === undefined || json.length > MAX_PLUGIN_OPTIONS) {
        problem(
          "bad-options",
          `${name}'s options aren't an object of at most ${MAX_PLUGIN_OPTIONS} characters of JSON.`,
        );
      }
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
    const taskIds = new Set<string>();
    for (const task of plugin.tasks ?? []) {
      if (!ID.test(task?.id ?? "") || taskIds.has(task.id) || typeof task.module !== "string" || !task.module) {
        problem(
          "bad-task",
          `${name} has a task without a module or an id of lowercase letters, digits and dashes of its own.`,
        );
      }
      taskIds.add(task?.id);
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
    ...(plugin.tasks?.length && { tasks: plugin.tasks.map(({ id, title }) => ({ id, ...(title && { title }) })) }),
    ...(plugin.server && { server: true }),
    ...(plugin.mediaStorage && {
      mediaStorage: plugin.mediaStorage.maxBytes ? { maxBytes: plugin.mediaStorage.maxBytes } : {},
    }),
    ...(plugin.editor && { editor: { title: plugin.editor.title, kinds: pluginEditorKinds(plugin.editor) } }),
    // A copy through JSON, so what the admin module gets is exactly what's published.
    ...(plugin.options && { options: JSON.parse(JSON.stringify(plugin.options)) as PluginOptions }),
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
 * An editor plugin's frame may also load the theme's Google Fonts, as the
 * editor's frames do, to show the site's blocks in them
 * (`PluginEditorStyles.fonts`), and show images, video and sound from
 * `media`, the origins the site keeps media at outside the repository
 * (`mediaStorageOrigins()` in `@goodfellow-cms/core/node`), as its pages do.
 */
export function pluginPolicy(
  permissions: PluginPermissions,
  options: { editor?: boolean; media?: readonly string[] } = {},
): string {
  const connect = (permissions.connect ?? []).filter(isPluginOrigin);
  const reach = connect.length > 0 ? ` ${connect.join(" ")}` : "";
  const fonts = options.editor
    ? { style: " https://fonts.googleapis.com", font: " https://fonts.gstatic.com" }
    : undefined;
  const media = options.editor
    ? (options.media ?? []).filter(isPluginOrigin).filter((origin) => !connect.includes(origin))
    : [];
  const shown = `${reach}${media.length > 0 ? ` ${media.join(" ")}` : ""}`;
  return [
    "default-src 'none'",
    "script-src 'self'",
    `style-src 'self' 'unsafe-inline'${fonts?.style ?? ""}`,
    `font-src 'self'${fonts?.font ?? ""} data:`,
    `img-src 'self' data: blob:${shown}`,
    `media-src 'self' blob:${shown}`,
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
  /** The notices of what its script bundles (`LICENSES_FILE` in `@goodfellow-cms/core/node`). */
  licenses?: string;
  /** Whether the plugin draws a page editor (`editor`), whose frame may load the theme's fonts. */
  editor?: boolean;
  /** For an editor plugin: the origins the site keeps media at outside the repository, whose files its frame shows. */
  media?: readonly string[];
}): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    `    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(pluginPolicy(options.permissions, { editor: options.editor, media: options.media }))}" />`,
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="robots" content="noindex" />',
    ...options.stylesheets.map((href) => `    <link rel="stylesheet" href="${escapeAttribute(href)}" />`),
    ...(options.licenses ? [`    <link rel="license" href="${escapeAttribute(options.licenses)}" />`] : []),
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
