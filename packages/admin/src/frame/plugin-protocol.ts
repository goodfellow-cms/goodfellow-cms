/**
 * What the admin panel's page and a plugin's admin frame say to each other.
 * The frame runs the plugin's admin module, sandboxed without
 * `allow-same-origin`, with a Content Security Policy that reaches only the
 * addresses the plugin declared. The page answers it only for what the plugin
 * declared, and treats everything it sends as the plugin's code may have
 * written it.
 */
import type { PluginDescription, PluginMediaReady } from "@goodfellow-cms/core";

/** A plugin's frame sends this to the admin panel's page once it's listening, and the page answers with a port. */
export const PLUGIN_READY_MESSAGE = "goodfellow:plugin-ready";

/** What a plugin's frame is for: answering its services, hidden, or showing one of its screens. */
export type PluginFrameMode = "service" | "screen";

/** Everything a plugin's frame starts with (`init`). */
export interface PluginFrameInit {
  mode: PluginFrameMode;
  /** The screen to show, by the id the plugin declared. */
  screen?: string;
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
  init(init: PluginFrameInit): void;
  theme(choice: PluginFrameInit["theme"]): void;
  /** Calls one of its services, for a block in the editor. */
  call(params: { method: string; args: unknown[] }): unknown;
  /** For a plugin that keeps media: whether it can take files now. */
  "media.ready"(): PluginMediaReady;
  /** For a plugin that keeps media: keeps files at their addresses, all together. */
  "media.upload"(params: { files: PluginFrameMediaFile[] }): void;
  /** For a plugin that keeps media: removes files the site no longer lists. */
  "media.remove"(params: { addresses: string[] }): void;
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
  /** Runs one of the plugin's tasks in the site's CI, answering with what it returned. */
  task(params: { id: string; input: unknown }): unknown;
}
