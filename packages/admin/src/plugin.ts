/**
 * A plugin's admin frame: runs the plugin's admin module, sandboxed away from
 * the admin panel's own page, and answers for it. Builds bundle each plugin's
 * admin module with this into a page of its own (`pluginFrameEntry()` in
 * `@goodfellow-cms/core`), whose Content Security Policy reaches only the
 * addresses the plugin declared.
 */
import type { PluginAdmin, PluginAdminApi, PluginFileChange } from "@goodfellow-cms/core";
import { type Channel, CONNECT_MESSAGE, createChannel } from "./frame/channel.js";
import { PLUGIN_READY_MESSAGE, type PluginFrameInit, type PluginFrameMediaFile } from "./frame/plugin-protocol.js";

/** Shows the admin panel's light or dark choice, as the admin panel's stylesheet reads it. */
function applyTheme(choice: PluginFrameInit["theme"]) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.gfaTheme;
  else root.dataset.gfaTheme = choice;
}

function adminApi(channel: Channel, init: PluginFrameInit): PluginAdminApi {
  return {
    plugin: init.plugin,
    siteUrl: init.siteUrl,
    read: (paths) => channel.call("read", { paths }),
    readBytes: (path) => channel.call("readBytes", { path }),
    list: (folder) => channel.call("list", { folder }),
    publish: (changes: PluginFileChange[], message) => channel.call("publish", { changes, message }),
    server: (path, request = {}) => channel.call("server", { path, ...request }),
    navigate: (href) => {
      void channel.call("navigate", href).catch(() => {});
    },
    task: (id, input) => channel.call("task", { id, input: input ?? null }),
  };
}

/** Starts a plugin's admin frame with its admin module's default export. */
export function mountPluginFrame(admin: PluginAdmin): void {
  document.documentElement.classList.add("gfa-plugin");
  const element = document.getElementById("goodfellow-plugin") ?? document.body;
  let connected = false;
  const onMessage = (event: MessageEvent) => {
    const port = event.ports[0];
    if (connected || event.source !== window.parent || !port) return;
    if ((event.data as { type?: unknown } | null)?.type !== CONNECT_MESSAGE) return;
    connected = true;
    window.removeEventListener("message", onMessage);
    const channel = createChannel(port);
    let api: PluginAdminApi | undefined;
    let init: PluginFrameInit | undefined;
    channel.handle("init", async (given: PluginFrameInit) => {
      init = given;
      applyTheme(given.theme);
      api = adminApi(channel, given);
      if (given.mode !== "screen") return;
      const mount =
        given.screen && admin.screens && Object.hasOwn(admin.screens, given.screen) && admin.screens[given.screen];
      if (!mount) throw new Error(`${given.plugin.title} has no screen called "${given.screen}".`);
      const cleanup = await mount(element, api);
      if (typeof cleanup === "function") window.addEventListener("pagehide", () => cleanup());
    });
    channel.handle("theme", (choice: PluginFrameInit["theme"]) => applyTheme(choice));
    channel.handle("call", ({ method, args }: { method: string; args: unknown[] }) => {
      const service = admin.services && Object.hasOwn(admin.services, method) && admin.services[method];
      if (!service || !api) throw new Error(`No such service: ${method}`);
      return service(Array.isArray(args) ? args : [], api);
    });
    const media = () => {
      if (!admin.media || !api) throw new Error(`${init?.plugin.title ?? "This plugin"} doesn't keep media.`);
      return { storage: admin.media, api };
    };
    channel.handle("media.ready", () => {
      const { storage, api } = media();
      return storage.ready(api);
    });
    channel.handle("media.upload", ({ files }: { files: PluginFrameMediaFile[] }) => {
      const { storage, api } = media();
      return storage.upload(files, api);
    });
    channel.handle("media.remove", ({ addresses }: { addresses: string[] }) => {
      const { storage, api } = media();
      return storage.remove(addresses, api);
    });
  };
  window.addEventListener("message", onMessage);
  window.parent.postMessage(PLUGIN_READY_MESSAGE, "*");
}
