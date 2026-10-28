/**
 * The admin panel's side of plugins' admin frames: making them, connecting to
 * them, and answering only for what each plugin declared. Everything a frame
 * sends is treated as the plugin's code may have written it.
 */
import {
  APP_API_HEADER,
  type FileChange,
  type MediaStorage,
  newTaskRequestId,
  openTaskAnswer,
  type PluginDescription,
  type PluginEditorBlock,
  type PluginEditorStyles,
  type PluginMediaReady,
  type PluginSecretsHelp,
  type PluginTaskRequest,
  pluginFrameUrl,
  pluginMayList,
  pluginMayUse,
  TASK_INPUT_LIMIT,
  taskKeys,
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
  type PluginFrameEditorOpen,
  type PluginFrameEditorOpened,
  type PluginFrameInit,
  type PluginFrameMode,
  type PluginPageRequests,
} from "./frame/plugin-protocol.js";
import { MEDIA_URL_PREFIX } from "./media.js";
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
  /**
   * Runs a plugin's task in the site's CI, giving its answer's text, still
   * sealed, where the site's backend can; throws with what went wrong, in the
   * admin panel's words.
   */
  runTask?(request: PluginTaskRequest): Promise<string>;
  /** How a plugin's secrets are added for this site, in the admin panel's words. */
  secretsHelp?(plugin: PluginDescription): Promise<PluginSecretsHelp[]>;
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

/** The tallest a screen's frame is made, whatever it says. */
const MAX_SCREEN_HEIGHT = 20_000;

/** What the page edited with an editor plugin answers its frame with, and hears from it. */
export interface PluginEditorHooks {
  /** What the editor opens, read each time the frame starts. */
  open(): PluginFrameEditorOpen;
  /** The editor opened, saying what it can do, on the channel to it. */
  onOpened(opened: PluginFrameEditorOpened, channel: Channel): void;
  /** What's edited now, as the frame says: the page checks it before publishing. */
  onChange(change: Parameters<PluginPageRequests["editor.change"]>[0]): void;
  chooseMedia(kind: "image" | "video" | "audio" | "file", value: string): Promise<string | null>;
  sharePreview(root: unknown): ReturnType<PluginPageRequests["editor.sharePreview"]>;
  /** Draws a block of what's edited, which the page checks is one the editor may use. */
  draw(block: PluginEditorBlock): Promise<string>;
  styles(): Promise<PluginEditorStyles>;
  /** A media file the live site doesn't have yet, from memory or the repository, for the frame to show. */
  mediaBytes(url: string): Promise<Uint8Array | undefined>;
  /** Calls `listener` with each file shown from memory, those already remembered first; answers how to stop. */
  onRemember(listener: (url: string, bytes: Uint8Array) => void): () => void;
  /** The files a plugin keeps outside the repository, as the site has them now. */
  mediaStorage(): MediaStorage | undefined;
}

const MEDIA_KINDS = new Set(["image", "video", "audio", "file"]);

/** The answers a plugin's frame gets, each checked against what the plugin declared. */
function pluginHandlers(
  plugin: PluginDescription,
  host: () => PluginHost,
  onResize: (height: number) => void,
  editor: () => PluginEditorHooks | undefined,
) {
  /** The page edited with the plugin's editor, for requests only its editor frame may make. */
  const editing = (what: string) => {
    const hooks = editor();
    if (!hooks) throw new RefusedError(`Only an editor's frame may ${what}.`);
    return hooks;
  };
  const secretsLinks = new Set<string>();
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
    "secrets.help": async () => {
      const help = (await host().secretsHelp?.(plugin)) ?? [];
      for (const { link } of help) if (link) secretsLinks.add(link.url);
      return help;
    },
    // Only the links the page itself gave, so a plugin can't open whatever it likes.
    "secrets.open": (params) => {
      const url = params?.url;
      if (typeof url !== "string" || !secretsLinks.has(url))
        throw new RefusedError("That isn't one of the links given.");
      window.open(url, "_blank", "noopener,noreferrer");
    },
    resize: (params) => {
      const height = params?.height;
      if (typeof height === "number" && Number.isFinite(height)) {
        onResize(Math.min(Math.max(0, Math.ceil(height)), MAX_SCREEN_HEIGHT));
      }
    },
    "editor.change": (params) => {
      const hooks = editing("say what's edited");
      if (typeof params !== "object" || params === null || typeof params.data !== "object" || params.data === null) {
        throw new RefusedError("That isn't what's edited.");
      }
      const state = typeof params.state === "object" && params.state !== null ? params.state : {};
      hooks.onChange({
        data: params.data,
        state: {
          past: state.past === true,
          future: state.future === true,
          selected: typeof state.selected === "string" ? state.selected : null,
        },
      });
    },
    "media.choose": (params) => {
      const hooks = editing("choose media");
      const kind = params?.kind;
      if (typeof kind !== "string" || !MEDIA_KINDS.has(kind)) throw new RefusedError("That isn't a kind of media.");
      return hooks.chooseMedia(kind as "image", typeof params.value === "string" ? params.value : "");
    },
    "editor.sharePreview": (params) => {
      const hooks = editing("preview a shared link");
      return hooks.sharePreview(params?.root);
    },
    "editor.draw": (params) => {
      const hooks = editing("draw blocks");
      const block = params?.block;
      if (
        typeof block !== "object" ||
        block === null ||
        typeof block.type !== "string" ||
        typeof block.props !== "object" ||
        block.props === null
      ) {
        throw new RefusedError("That isn't a block.");
      }
      return hooks.draw(block);
    },
    "editor.styles": () => editing("read the site's styles").styles(),
    "media.bytes": async (url) => {
      const hooks = editing("show media");
      if (typeof url !== "string" || !url.startsWith(MEDIA_URL_PREFIX) || url.includes("..")) return null;
      return (await hooks.mediaBytes(url)) ?? null;
    },
    task: async (params) => {
      const id = params?.id;
      if (typeof id !== "string" || !plugin.tasks?.some((task) => task.id === id)) {
        throw new RefusedError(`${plugin.title} has no task called ${String(id)}.`);
      }
      const run = host().runTask;
      if (!run) throw new RefusedError(`${plugin.title}'s tasks can't run here.`);
      let input: string;
      try {
        input = JSON.stringify(params.input ?? null);
      } catch {
        throw new RefusedError("A task's input must be plain data.");
      }
      if (input.length > TASK_INPUT_LIMIT) throw new RefusedError("That's too much for one task.");
      // A key pair for this request alone: only this page can open the answer.
      const keys = await taskKeys();
      const sealed = await run({ id: newTaskRequestId(), plugin: plugin.id, task: id, input, key: keys.publicKey });
      const answer = await openTaskAnswer(sealed, keys.privateKey);
      if (!answer.ok) throw new Error(answer.error.slice(0, 2000));
      return answer.output;
    },
  };
  return handlers as Record<string, (params: never) => unknown>;
}

export interface PluginFrameConnection {
  /** The connected frame, once it has started. */
  channel?: Channel;
  failed: boolean;
  frameProps: {
    ref: (element: HTMLIFrameElement | null) => void;
    sandbox: string;
    src: string;
    /** A screen's frame is as tall as what it draws. */
    style?: CSSProperties;
  };
}

/** Makes one of a plugin's frames and connects to it; an editor's frame with `editor`. */
export function usePluginFrame(
  plugin: PluginDescription,
  host: PluginHost,
  mode: PluginFrameMode,
  screen?: string,
  editor?: PluginEditorHooks,
): PluginFrameConnection {
  const element = useRef<HTMLIFrameElement | null>(null);
  const [channel, setChannel] = useState<Channel>();
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number>();
  const latest = useRef(host);
  latest.current = host;
  const latestEditor = useRef(editor);
  latestEditor.current = editor;

  useEffect(() => {
    let current: Channel | undefined;
    let connections = 0;
    let stopped = false;
    let stopRemembering: (() => void) | undefined;
    const onMessage = (event: MessageEvent) => {
      const frame = element.current?.contentWindow;
      if (!frame || event.source !== frame || event.data !== PLUGIN_READY_MESSAGE) return;
      current?.close();
      stopRemembering?.();
      stopRemembering = undefined;
      setChannel(undefined);
      connections += 1;
      if (connections > MAX_CONNECTIONS) {
        setFailed(true);
        return;
      }
      const { port1, port2 } = new MessageChannel();
      const next = createChannel(
        port1,
        pluginHandlers(
          plugin,
          () => latest.current,
          (next) => {
            if (mode === "screen") setHeight(next);
          },
          () => (mode === "editor" ? latestEditor.current : undefined),
        ),
      );
      current = next;
      frame.postMessage({ type: CONNECT_MESSAGE }, "*", [port2]);
      const opening = mode === "editor" ? latestEditor.current?.open() : undefined;
      const init: PluginFrameInit = {
        mode,
        ...(screen && { screen }),
        ...(opening && { editor: opening }),
        plugin,
        siteUrl: latest.current.siteUrl,
        theme: latest.current.theme,
      };
      const storage = mode === "editor" ? latestEditor.current?.mediaStorage() : undefined;
      if (storage) init.mediaStorage = storage;
      next.call("init", init).then(
        (opened: unknown) => {
          if (stopped || current !== next) return;
          setChannel(next);
          if (mode === "editor") {
            const said = (opened ?? {}) as Partial<PluginFrameEditorOpened>;
            latestEditor.current?.onOpened({ set: said.set === true, undo: said.undo === true }, next);
            // Files shown from memory, such as uploads the live site doesn't have yet, show in the editor too.
            stopRemembering = latestEditor.current?.onRemember((url, bytes) => {
              void next.call("media.remember", { url, bytes }).catch(() => {});
            });
          }
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
      stopRemembering?.();
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
    frameProps: {
      ref,
      sandbox: FRAME_SANDBOX,
      src: pluginFrameUrl(host.editorUrl, plugin.id),
      ...(height !== undefined && { style: { height } }),
    },
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
  return <iframe title="" aria-hidden="true" tabIndex={-1} {...frameProps} style={HIDDEN} />;
}

const PluginHostContext = createContext<PluginHost | null>(null);

/** A file for a plugin that keeps media, its contents a `Blob`. */
export interface PluginMediaUpload {
  address: string;
  type: string;
  size: number;
  data: Blob;
}

/** Asks a plugin that keeps media (`mediaStorage`) through its hidden frame. */
export interface PluginMediaClient {
  plugin: PluginDescription;
  ready(): Promise<PluginMediaReady>;
  /** Keeps files all together, since each batch may wait for one of the plugin's tasks. */
  upload(files: PluginMediaUpload[]): Promise<void>;
  remove(addresses: string[]): Promise<void>;
}

const PluginMediaContext = createContext<((name: string) => PluginMediaClient | undefined) | null>(null);

/**
 * The plugin keeping the site's media, by its name in
 * `content/media-storage.json`, where the site has it and it says it keeps
 * media. Outside `PluginServices`, such as in the site's frames, none.
 */
export function usePluginMedia(name: string | undefined): PluginMediaClient | undefined {
  const media = useContext(PluginMediaContext);
  return name && media ? media(name) : undefined;
}

/** What a plugin's frame said about being ready, as the admin panel shows it: its message is the plugin's own words. */
function readyAnswer(plugin: PluginDescription, value: unknown): PluginMediaReady {
  const answer = (value ?? {}) as { ready?: unknown; message?: unknown; screen?: unknown };
  if (answer.ready === true) return { ready: true };
  const screen =
    typeof answer.screen === "string" && plugin.screens?.some((own) => own.id === answer.screen)
      ? answer.screen
      : undefined;
  return {
    ready: false,
    message: typeof answer.message === "string" ? answer.message.slice(0, 500) : "",
    ...(screen && { screen }),
  };
}

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
  const channelFor = useCallback(async (plugin: PluginDescription): Promise<Channel> => {
    const channel = ready.current.get(plugin.id);
    if (channel) return channel;
    setStarted((current) => (current.includes(plugin.id) ? current : [...current, plugin.id]));
    return await new Promise<Channel>((resolve, reject) => {
      const list = waiting.current.get(plugin.id) ?? [];
      list.push(resolve);
      waiting.current.set(plugin.id, list);
      setTimeout(() => reject(new Error(`${plugin.title} didn't start.`)), START_TIMEOUT);
    });
  }, []);
  const call = useCallback(
    async (name: string, method: string, args: unknown[]) => {
      const plugin = plugins.find((candidate) => candidate.name === name && candidate.admin);
      if (!plugin) throw new Error(`The site has no plugin called ${name} with services.`);
      return (await channelFor(plugin)).call("call", { method, args });
    },
    [plugins, channelFor],
  );
  useEffect(() => onCall(call), [call, onCall]);
  const media = useCallback(
    (name: string): PluginMediaClient | undefined => {
      const plugin = plugins.find((candidate) => candidate.name === name && candidate.admin && candidate.mediaStorage);
      if (!plugin) return undefined;
      return {
        plugin,
        ready: async () => readyAnswer(plugin, await (await channelFor(plugin)).call("media.ready")),
        upload: async (files) => {
          await (await channelFor(plugin)).call("media.upload", { files });
        },
        remove: async (addresses) => {
          await (await channelFor(plugin)).call("media.remove", { addresses });
        },
      };
    },
    [plugins, channelFor],
  );
  return (
    <PluginHostContext.Provider value={host}>
      <PluginMediaContext.Provider value={media}>{children}</PluginMediaContext.Provider>
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
