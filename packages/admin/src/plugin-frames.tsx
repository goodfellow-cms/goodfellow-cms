/**
 * The admin panel's side of plugins' admin frames: making them, connecting to
 * them, and answering only for what each plugin declared. Everything a frame
 * sends is treated as the plugin's code may have written it.
 */
import {
  APP_API_HEADER,
  type FileChange,
  type PluginDescription,
  pluginFrameUrl,
  pluginMayList,
  pluginMayUse,
} from "@goodfellow-cms/core";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { type Channel, CONNECT_MESSAGE, createChannel } from "./frame/channel.js";
import { FRAME_SANDBOX } from "./frame/host.js";
import {
  PLUGIN_READY_MESSAGE,
  type PluginFrameChange,
  type PluginFrameInit,
  type PluginFrameMode,
  type PluginPageRequests,
} from "./frame/plugin-protocol.js";
import type { ThemeChoice } from "./theme.js";

/** What plugins' frames may ask for, which the admin panel gives each only within what it declared. */
export interface PluginHost {
  /** The editor's frames' page, beside which plugins' frames are. */
  editorUrl: string;
  siteUrl: string;
  theme: ThemeChoice;
  read(path: string): Promise<string | undefined>;
  readBytes(path: string): Promise<Uint8Array | undefined>;
  list(folder: string): Promise<string[]>;
  /** Publishes as an editor would, after the site checks. Answers whether it was published. */
  publish(changes: FileChange[], message: string): Promise<boolean>;
  /** On a full-stack site, the address of plugins' server routes, such as `https://example.org/api/goodfellow/plugins`. */
  server?: string;
  navigate(href: string): void;
}

/** A plugin's frame asked for something it didn't declare, or that isn't there. */
class RefusedError extends Error {
  override name = "RefusedError";
}

/** How many times a plugin's frame may start again before it's given up on. */
const MAX_CONNECTIONS = 5;
/** How long a service call waits for the plugin's frame to start. */
const START_TIMEOUT = 20_000;

function isAdminScreen(href: unknown): href is string {
  return typeof href === "string" && /^#\/[\w\-/?=&%.]*$/.test(href);
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new RefusedError(`Say which ${what}.`);
  return value;
}

/** A plugin's file change, as the admin panel publishes it, if the plugin declared its file. */
function toFileChange(plugin: PluginDescription, value: unknown): FileChange {
  if (typeof value !== "object" || value === null) throw new RefusedError("That isn't a change.");
  const change = value as Partial<Record<"path" | "text" | "bytes" | "delete", unknown>>;
  if (typeof change.path !== "string" || !pluginMayUse(plugin.permissions, change.path)) {
    throw new RefusedError(`${plugin.title} didn't ask to change ${String(change.path)}.`);
  }
  if (change.delete === true) return { path: change.path, delete: true };
  if (typeof change.text === "string") return { path: change.path, content: change.text };
  if (change.bytes instanceof Uint8Array) return { path: change.path, bytes: change.bytes };
  throw new RefusedError("That isn't a change.");
}

/** The answers a plugin's frame gets, each checked against what the plugin declared. */
function pluginHandlers(plugin: PluginDescription, host: () => PluginHost) {
  const handlers: { [K in keyof PluginPageRequests]: (params: Parameters<PluginPageRequests[K]>[0]) => unknown } = {
    read: async (params) => {
      const paths = strings(params?.paths, "files");
      const refused = paths.find((path) => !pluginMayUse(plugin.permissions, path));
      if (refused) throw new RefusedError(`${plugin.title} didn't ask to read ${refused}.`);
      const read = await Promise.all(paths.map(async (path) => [path, (await host().read(path)) ?? null] as const));
      return Object.fromEntries(read);
    },
    readBytes: async (params) => {
      const path = params?.path;
      if (typeof path !== "string" || !pluginMayUse(plugin.permissions, path)) {
        throw new RefusedError(`${plugin.title} didn't ask to read ${String(path)}.`);
      }
      return (await host().readBytes(path)) ?? null;
    },
    list: async (params) => {
      const folder = params?.folder;
      if (typeof folder !== "string" || !pluginMayList(plugin.permissions, folder)) {
        throw new RefusedError(`${plugin.title} didn't ask to list ${String(folder)}.`);
      }
      const files = await host().list(folder.replace(/\/+$/, ""));
      return files.filter((path) => pluginMayUse(plugin.permissions, path));
    },
    publish: async (params) => {
      if (!Array.isArray(params?.changes) || params.changes.length === 0 || typeof params.message !== "string") {
        throw new RefusedError("That isn't a publish.");
      }
      const changes = (params.changes as PluginFrameChange[]).map((change) => toFileChange(plugin, change));
      return { published: await host().publish(changes, params.message.slice(0, 500)) };
    },
    server: async (params) => {
      const base = host().server;
      if (!plugin.server || !base) throw new RefusedError(`${plugin.title} has no server here.`);
      const path = params?.path;
      if (typeof path !== "string" || path.includes("..") || /^[a-z]+:/i.test(path)) {
        throw new RefusedError("That isn't one of the plugin's addresses.");
      }
      const method = typeof params.method === "string" ? params.method.toUpperCase() : "GET";
      const headers = Object.fromEntries(
        Object.entries(params.headers ?? {}).filter(
          ([name, value]) =>
            typeof value === "string" && /^(content-type|accept|x-goodfellow-plugin-[\w-]+)$/i.test(name),
        ),
      );
      const response = await fetch(
        `${base.replace(/\/+$/, "")}/${encodeURIComponent(plugin.id)}/${path.replace(/^\/+/, "")}`,
        {
          method,
          headers: { ...headers, [APP_API_HEADER]: "1" },
          ...(typeof params.body === "string" && method !== "GET" && method !== "HEAD" && { body: params.body }),
          credentials: "same-origin",
          cache: "no-store",
        },
      );
      return { status: response.status, body: await response.text() };
    },
    navigate: (href) => {
      if (isAdminScreen(href)) host().navigate(href);
    },
  };
  return handlers as Record<string, (params: never) => unknown>;
}

export interface PluginFrameConnection {
  /** The connected frame, once it has started. */
  channel?: Channel;
  failed: boolean;
  frameProps: { ref: (element: HTMLIFrameElement | null) => void; sandbox: string; src: string };
}

/** Makes one of a plugin's frames and connects to it. */
export function usePluginFrame(
  plugin: PluginDescription,
  host: PluginHost,
  mode: PluginFrameMode,
  screen?: string,
): PluginFrameConnection {
  const element = useRef<HTMLIFrameElement | null>(null);
  const [channel, setChannel] = useState<Channel>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(host);
  latest.current = host;

  useEffect(() => {
    let current: Channel | undefined;
    let connections = 0;
    let stopped = false;
    const onMessage = (event: MessageEvent) => {
      const frame = element.current?.contentWindow;
      if (!frame || event.source !== frame || event.data !== PLUGIN_READY_MESSAGE) return;
      current?.close();
      setChannel(undefined);
      connections += 1;
      if (connections > MAX_CONNECTIONS) {
        setFailed(true);
        return;
      }
      const { port1, port2 } = new MessageChannel();
      const next = createChannel(
        port1,
        pluginHandlers(plugin, () => latest.current),
      );
      current = next;
      frame.postMessage({ type: CONNECT_MESSAGE }, "*", [port2]);
      const init: PluginFrameInit = {
        mode,
        ...(screen && { screen }),
        plugin,
        siteUrl: latest.current.siteUrl,
        theme: latest.current.theme,
      };
      next.call("init", init).then(
        () => {
          if (!stopped && current === next) setChannel(next);
        },
        () => {
          if (!stopped && current === next) setFailed(true);
        },
      );
    };
    window.addEventListener("message", onMessage);
    return () => {
      stopped = true;
      window.removeEventListener("message", onMessage);
      current?.close();
    };
  }, [plugin, mode, screen]);

  useEffect(() => {
    void channel?.call("theme", host.theme).catch(() => {});
  }, [channel, host.theme]);

  const ref = useCallback((frame: HTMLIFrameElement | null) => {
    element.current = frame;
  }, []);
  return {
    channel,
    failed,
    frameProps: { ref, sandbox: FRAME_SANDBOX, src: pluginFrameUrl(host.editorUrl, plugin.id) },
  };
}

const HIDDEN: CSSProperties = { position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" };

/** One plugin's hidden frame for its services, which tells `onChannel` once it has started. */
function ServiceFrame({
  plugin,
  host,
  onChannel,
}: {
  plugin: PluginDescription;
  host: PluginHost;
  onChannel: (id: string, channel: Channel | undefined) => void;
}) {
  const { channel, frameProps } = usePluginFrame(plugin, host, "service");
  useEffect(() => onChannel(plugin.id, channel), [plugin.id, channel, onChannel]);
  return <iframe title="" aria-hidden="true" tabIndex={-1} style={HIDDEN} {...frameProps} />;
}

const PluginHostContext = createContext<PluginHost | null>(null);

/** What plugins' screens are given, inside `PluginServices`. */
export function usePluginHost(): PluginHost {
  const value = useContext(PluginHostContext);
  if (!value) throw new Error("Plugins' frames need the admin panel around them.");
  return value;
}

/**
 * Plugins' services for the editor's blocks: each plugin's hidden frame is
 * made the first time something asks it. `onCall` gets the function that
 * asks, `(plugin name, method, arguments)`.
 */
export function PluginServices({
  plugins,
  host,
  onCall,
  children,
}: {
  plugins: readonly PluginDescription[];
  host: PluginHost;
  onCall: (call: (plugin: string, method: string, args: unknown[]) => Promise<unknown>) => void;
  children: ReactNode;
}) {
  const [started, setStarted] = useState<string[]>([]);
  const ready = useRef(new Map<string, Channel>());
  const waiting = useRef(new Map<string, Array<(channel: Channel) => void>>());
  const onChannel = useCallback((id: string, channel: Channel | undefined) => {
    if (!channel) {
      ready.current.delete(id);
      return;
    }
    ready.current.set(id, channel);
    for (const resolve of waiting.current.get(id)?.splice(0) ?? []) resolve(channel);
  }, []);
  const call = useCallback(
    async (name: string, method: string, args: unknown[]) => {
      const plugin = plugins.find((candidate) => candidate.name === name && candidate.admin);
      if (!plugin) throw new Error(`The site has no plugin called ${name} with services.`);
      let channel = ready.current.get(plugin.id);
      if (!channel) {
        setStarted((current) => (current.includes(plugin.id) ? current : [...current, plugin.id]));
        channel = await new Promise<Channel>((resolve, reject) => {
          const list = waiting.current.get(plugin.id) ?? [];
          list.push(resolve);
          waiting.current.set(plugin.id, list);
          setTimeout(() => reject(new Error(`${plugin.title} didn't start.`)), START_TIMEOUT);
        });
      }
      return channel.call("call", { method, args });
    },
    [plugins],
  );
  useEffect(() => onCall(call), [call, onCall]);
  return (
    <PluginHostContext.Provider value={host}>
      {children}
      {plugins
        .filter((plugin) => started.includes(plugin.id))
        .map((plugin) => (
          <ServiceFrame key={plugin.id} plugin={plugin} host={host} onChannel={onChannel} />
        ))}
    </PluginHostContext.Provider>
  );
}

/** One of a plugin's screens, drawn by its admin module in a frame of its own. */
export function PluginScreenFrame({
  plugin,
  screen,
  failedText,
}: {
  plugin: PluginDescription;
  screen: { id: string; title: string };
  failedText: string;
}) {
  const host = usePluginHost();
  const { failed, frameProps } = usePluginFrame(plugin, host, "screen", screen.id);
  if (failed) return <p className="gfa-error">{failedText}</p>;
  return <iframe title={screen.title} className="gfa-plugin-screen" {...frameProps} />;
}
