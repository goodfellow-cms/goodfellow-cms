/**
 * What the admin panel's page and a plugin's admin frame say to each other.
 * The frame runs the plugin's admin module, sandboxed without
 * `allow-same-origin`, with a Content Security Policy that reaches only the
 * addresses the plugin declared. The page answers it only for what the plugin
 * declared, and treats everything it sends as the plugin's code may have
 * written it.
 */
import type {
  PluginDescription,
  PluginEditorBlock,
  PluginEditorData,
  PluginEditorSession,
  PluginEditorState,
  PluginMediaReady,
  PluginSecretsHelp,
  PluginSharePreview,
} from "@goodfellow-cms/core";

/** A plugin's frame sends this to the admin panel's page once it's listening, and the page answers with a port. */
export const PLUGIN_READY_MESSAGE = "goodfellow:plugin-ready";

/** What a plugin's frame is for: answering its services, hidden, showing one of its screens, or its page editor. */
export type PluginFrameMode = "service" | "screen" | "editor";

/** What an editor plugin's frame opens: its session, without the functions, which the frame's runtime adds. */
export type PluginFrameEditorOpen = Omit<
  PluginEditorSession,
  "change" | "chooseMedia" | "sharePreview" | "draw" | "styles"
>;

/** What an editor plugin's frame says it can do once it's open, for the admin panel's header. */
export interface PluginFrameEditorOpened {
  /** Whether it takes changes from outside, such as the AI assistant's. */
  set: boolean;
  /** Whether it has Undo and Redo for the header's buttons. */
  undo: boolean;
}

/** Everything a plugin's frame starts with (`init`). */
export interface PluginFrameInit {
  mode: PluginFrameMode;
  /** The screen to show, by the id the plugin declared. */
  screen?: string;
  /** What its page editor opens, in `editor` mode. */
  editor?: PluginFrameEditorOpen;
  plugin: PluginDescription;
  /** The live site's address. */
  siteUrl: string;
  theme: "system" | "light" | "dark";
}

/** A file change as it crosses the port. */
export type PluginFrameChange =
  | { path: string; text: string }
  | { path: string; bytes: Uint8Array }
  | { path: string; delete: true };

/** What the page asks a plugin's frame. */
export interface PluginFrameRequests {
  /** Starts the frame; an editor plugin's says what its editor can do. */
  init(init: PluginFrameInit): PluginFrameEditorOpened | undefined;
  theme(choice: PluginFrameInit["theme"]): void;
  /** Calls one of its services, for a block in the editor. */
  call(params: { method: string; args: unknown[] }): unknown;
  /** For a plugin that keeps media: whether it can take files now. */
  "media.ready"(): PluginMediaReady;
  /** For a plugin that keeps media: keeps files at their addresses, all together. */
  "media.upload"(params: { files: PluginFrameMediaFile[] }): void;
  /** For a plugin that keeps media: removes files the site no longer lists. */
  "media.remove"(params: { addresses: string[] }): void;
  /** For an editor plugin: what's edited now, as Publish publishes it. */
  "editor.data"(): PluginEditorData;
  /** For an editor plugin that takes changes from outside: replaces what's edited. */
  "editor.set"(data: PluginEditorData): void;
  "editor.undo"(): void;
  "editor.redo"(): void;
}

/** A file for media storage as it crosses the port, its contents a `Blob`, so a long video isn't read into memory first. */
export interface PluginFrameMediaFile {
  address: string;
  type: string;
  size: number;
  data: Blob;
}

/** What a plugin's frame may ask the page, each checked against what the plugin declared. */
export interface PluginPageRequests {
  read(params: { paths: string[] }): Record<string, string | null>;
  readBytes(params: { path: string }): Uint8Array | null;
  list(params: { folder: string }): string[];
  publish(params: { changes: PluginFrameChange[]; message: string }): { published: boolean };
  server(params: { path: string; method?: string; body?: string; headers?: Record<string, string> }): {
    status: number;
    body: string;
  };
  navigate(href: string): void;
  /** A screen's frame says how tall what it draws is, so the page shows it all without a scroll bar of its own. */
  resize(params: { height: number }): void;
  /** Runs one of the plugin's tasks in the site's CI, answering with what it returned. */
  task(params: { id: string; input: unknown }): unknown;
  /** How the site's owner adds the secrets the plugin declared, for this site. */
  "secrets.help"(): PluginSecretsHelp[];
  /** Opens one of the links `secrets.help` gave in a new tab, which the frame's sandbox can't. */
  "secrets.open"(params: { url: string }): void;
  /** An editor plugin's frame says what's edited now, as it changes. Only editor frames may. */
  "editor.change"(params: { data: PluginEditorData; state?: PluginEditorState }): void;
  /** Opens the media library for an editor plugin, answering with the address chosen, or `null`. Only editor frames may. */
  "media.choose"(params: { kind: "image" | "video" | "audio" | "file"; value?: string }): string | null;
  /** How a link to the page edited looks when it's shared. Only editor frames may. */
  "editor.sharePreview"(params: { root: PluginEditorData["root"] }): PluginSharePreview;
  /** One block drawn as the site draws it, its slots left empty. Only editor frames may. */
  "editor.draw"(params: { block: PluginEditorBlock }): string;
  /** The site's stylesheets, for drawn blocks. Only editor frames may. */
  "editor.styles"(): string[];
}
