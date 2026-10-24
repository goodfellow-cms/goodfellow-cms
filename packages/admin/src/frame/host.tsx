/**
 * The admin panel's side of the site's frames: making them, connecting to
 * them, and answering the little they may ask. Everything a frame sends is
 * treated as coming from the site's blocks, which run there.
 */
import type { Page, PageView, SiteContent } from "@goodfellow-cms/core";
import type { MediaFieldKind } from "@goodfellow-cms/react";
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
import { MEDIA_URL_PREFIX } from "../media.js";
import type { MediaPreviews } from "../media-previews.js";
import type { RenderTarget, SiteCodeService } from "../site-code.js";
import { type Channel, CONNECT_MESSAGE, createChannel } from "./channel.js";
import type { AdminRequests, FrameEvents, FrameInit, FrameMode, FrameRequests } from "./protocol.js";
import { READY_MESSAGE } from "./protocol.js";

/**
 * Where the admin panel loads the frames that run the site's code from: a
 * page of their own, such as `goodfellow build`'s `admin/editor/` or the
 * Next.js starter's `app/admin/editor/`, whose Content Security Policy
 * (`editorPolicy()`) runs only the site's scripts. Every frame is sandboxed
 * with `allow-scripts` alone, development servers' too, so the site's code
 * never shares the admin panel's origin.
 */
export interface FrameSource {
  url: string;
}

/** The only thing frames are allowed: no `allow-same-origin`, so they never reach the admin panel's page or storage. */
export const FRAME_SANDBOX = "allow-scripts";

/** A connected frame's requests, typed. */
export interface FrameClient {
  call<K extends keyof FrameRequests>(
    method: K,
    ...params: Parameters<FrameRequests[K]>
  ): Promise<Awaited<ReturnType<FrameRequests[K]>>>;
  on<K extends keyof FrameEvents>(name: K, listener: (payload: FrameEvents[K]) => void): () => void;
}

export function frameClient(channel: Channel): FrameClient {
  return {
    call: (method, ...params) => channel.call(method, params[0]),
    on: (name, listener) => channel.on(name, listener as (payload: unknown) => void),
  };
}

/** How many times a frame may start again, such as after the development server reloads it, before it's given up on. */
const MAX_CONNECTIONS = 5;

/** Each frame's way of loading its page again, for `reloadFrames()`. */
const reloaders = new Set<() => void>();

/**
 * Loads every frame's page again, as development servers do once they've
 * rebuilt the frames with the site's new code, leaving the admin panel's own
 * page, and whatever is open on it, as it is. Frames reloaded this way
 * don't count towards the times one may start again.
 */
export function reloadFrames(): void {
  for (const reload of reloaders) reload();
}

/** What the admin panel tells every frame it makes, and answers for them. */
export interface FrameServices {
  source: FrameSource;
  /** Everything a frame starts with but its mode, kept the same object until something in it changes. */
  init: Omit<FrameInit, "mode">;
  /** The site's compiled CSS as text, for the editor's frame, which scopes it to its canvas. */
  siteCss(): Promise<string[]>;
  /** Where frames' `/media/` files come from, unless a frame says otherwise. */
  mediaPreviews: MediaPreviews;
  /** Opens the media library for a field in a frame. */
  chooseMedia(kind: MediaFieldKind, value: string): Promise<string | null>;
  /** Goes to another screen, asking first about unpublished changes. */
  navigate(href: string): void;
}

const FrameServicesContext = createContext<FrameServices | null>(null);

export function FrameServicesProvider({ value, children }: { value: FrameServices; children: ReactNode }) {
  return <FrameServicesContext.Provider value={value}>{children}</FrameServicesContext.Provider>;
}

export function useFrameServices(): FrameServices {
  const value = useContext(FrameServicesContext);
  if (!value) throw new Error("Frames need the admin panel around them.");
  return value;
}

/** Whether a frame asked to go somewhere it may: one of the admin panel's own screens. */
function isAdminScreen(href: unknown): href is string {
  return typeof href === "string" && /^#\/[\w\-/?=&%.]*$/.test(href);
}

interface FrameOptions {
  mode: FrameMode;
  /** Run each time the frame connects, after `init`: what to show it. */
  onConnect?: (client: FrameClient) => Promise<void> | void;
  /** Where its `/media/` files come from, if not the site as it is now. */
  media?: MediaPreviews;
}

export interface FrameConnection {
  /** The connected frame, once it's started and been told what to show. */
  client?: FrameClient;
  /** The frame stopped working, such as by leaving its page again and again. */
  failed: boolean;
  /** Props for the `<iframe>`. */
  frameProps: {
    ref: (element: HTMLIFrameElement | null) => void;
    sandbox: string;
    src: string;
  };
}

/** Makes a frame of the site's code and connects to it. */
export function useFrame({ mode, onConnect, media }: FrameOptions): FrameConnection {
  const services = useFrameServices();
  const element = useRef<HTMLIFrameElement | null>(null);
  const [client, setClient] = useState<FrameClient>();
  const [failed, setFailed] = useState(false);
  // The latest of each, so the connection, made once, always uses them.
  const latest = useRef({ services, onConnect, media });
  latest.current = { services, onConnect, media };

  useEffect(() => {
    let current: Channel | undefined;
    let stopRemembering: (() => void) | undefined;
    let connections = 0;
    let stopped = false;
    const handlers: { [K in keyof AdminRequests]: (params: Parameters<AdminRequests[K]>[0]) => unknown } = {
      navigate: (href) => {
        if (isAdminScreen(href)) latest.current.services.navigate(href);
      },
      "media.choose": (params) => {
        const kind = params?.kind;
        if (kind !== "image" && kind !== "video" && kind !== "file") return null;
        return latest.current.services.chooseMedia(kind, typeof params.value === "string" ? params.value : "");
      },
      "media.bytes": async (url) => {
        if (typeof url !== "string" || !url.startsWith(MEDIA_URL_PREFIX) || url.includes("..")) return null;
        const previews = latest.current.media ?? latest.current.services.mediaPreviews;
        return (await previews.bytes(url)) ?? null;
      },
    };
    const onMessage = (event: MessageEvent) => {
      const frame = element.current?.contentWindow;
      if (!frame || event.source !== frame || event.data !== READY_MESSAGE) return;
      current?.close();
      setClient(undefined);
      connections += 1;
      if (connections > MAX_CONNECTIONS) {
        setFailed(true);
        return;
      }
      const { port1, port2 } = new MessageChannel();
      const channel = createChannel(port1, handlers as Record<string, (params: never) => unknown>);
      current = channel;
      frame.postMessage({ type: CONNECT_MESSAGE }, "*", [port2]);
      const next = frameClient(channel);
      void (async () => {
        try {
          const { services } = latest.current;
          const siteCss = mode === "editor" ? await services.siteCss() : undefined;
          await next.call("init", { ...services.init, mode, ...(siteCss && { siteCss }) });
          // Files shown from memory, such as uploads the live site doesn't have yet, show in the frame too.
          const previews = latest.current.media ?? services.mediaPreviews;
          stopRemembering?.();
          stopRemembering = previews.onRemember((url, bytes) => {
            void next.call("media.remember", { url, bytes }).catch(() => {});
          });
          await latest.current.onConnect?.(next);
          if (!stopped && current === channel) setClient(next);
        } catch {
          if (!stopped && current === channel) setFailed(true);
        }
      })();
    };
    const reload = () => {
      connections = 0;
      setFailed(false);
      if (element.current) element.current.src = latest.current.services.source.url;
    };
    reloaders.add(reload);
    window.addEventListener("message", onMessage);
    return () => {
      stopped = true;
      reloaders.delete(reload);
      window.removeEventListener("message", onMessage);
      stopRemembering?.();
      current?.close();
    };
  }, [mode]);

  const { source } = services;
  const ref = useCallback((frame: HTMLIFrameElement | null) => {
    element.current = frame;
  }, []);
  return {
    client,
    failed,
    frameProps: {
      ref,
      sandbox: FRAME_SANDBOX,
      src: source.url,
    },
  };
}

/** Keeps frames told about the site, the admin panel's light or dark choice, and the like, as they change. */
export function useFrameUpdates(client: FrameClient | undefined) {
  const services = useFrameServices();
  const { content, media, schedule, theme } = services.init;
  useEffect(() => {
    void client?.call("site", { content, media, schedule }).catch(() => {});
  }, [client, content, media, schedule]);
  useEffect(() => {
    void client?.call("theme", theme).catch(() => {});
  }, [client, theme]);
}

/** The site's code, run in a hidden frame of its own, for screens that need it without showing anything. */
export function frameSiteCode(client: () => Promise<FrameClient>): SiteCodeService {
  return {
    async sitePages(content: SiteContent, today: string): Promise<Page[]> {
      return (await client()).call("code.sitePages", { content, today });
    },
    async pageView(page: Page, content: SiteContent, today: string): Promise<PageView | undefined> {
      return (await (await client()).call("code.pageView", { page, content, today })) ?? undefined;
    },
    async renderedProblems(content: SiteContent, targets: RenderTarget[], today: string) {
      return (await client()).call("code.renderedProblems", { content, targets, today });
    },
  };
}

const HIDDEN: CSSProperties = { position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" };

/**
 * The hidden frame `frameSiteCode()` asks. `onClient` gets a function that
 * answers with the frame once it's connected.
 */
export function SiteCodeFrame({ onClient }: { onClient: (client: FrameClient | undefined) => void }) {
  const { client, frameProps } = useFrame({ mode: "code" });
  useEffect(() => onClient(client), [client, onClient]);
  return <iframe title="" aria-hidden="true" tabIndex={-1} style={HIDDEN} {...frameProps} />;
}
