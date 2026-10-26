/**
 * The site's frame: Puck, the site's config and every block, sandboxed away
 * from the admin panel's page, which signs in and publishes. It tells the page
 * it's ready, gets a port back, and from then on only answers on that port.
 */
import type { GoodfellowConfig, Page, SiteContent } from "@goodfellow-cms/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DrawTarget, RenderTarget } from "../site-code.js";
import { setThemeChoice, type ThemeChoice } from "../theme.js";
import { installSiteCss } from "./canvas-styles.js";
import { type Channel, CONNECT_MESSAGE, createChannel } from "./channel.js";
import { FrameEditor } from "./editor.js";
import { adminClient, FrameProviders, useFrameCode } from "./frame-site.js";
import { type EditorOpen, type EditorOpened, type FrameInit, type FrameSite, READY_MESSAGE } from "./protocol.js";
import { FrameRender } from "./render.js";

/** Answers for the site's code, for the admin panel's screens. */
function CodeService({ channel }: { channel: Channel }) {
  const { code } = useFrameCode();
  useEffect(() => {
    const stops = [
      channel.handle("code.sitePages", ({ content, today }: { content: SiteContent; today: string }) =>
        code.sitePages(content, today),
      ),
      channel.handle(
        "code.pageView",
        async ({ page, content, today }: { page: Page; content: SiteContent; today: string }) =>
          (await code.pageView(page, content, today)) ?? null,
      ),
      channel.handle(
        "code.renderedProblems",
        ({ content, targets, today }: { content: SiteContent; targets: RenderTarget[]; today: string }) =>
          code.renderedProblems(content, targets, today),
      ),
      channel.handle("code.drawBlock", ({ content, target }: { content: SiteContent; target: DrawTarget }) =>
        code.drawBlock(content, target),
      ),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [channel, code]);
  return null;
}

/** Which editor is open: another one starts Puck afresh. */
function editorKey(open: EditorOpen): string {
  return JSON.stringify([open.kind, open.path, open.collection, open.entry, open.language]);
}

/** Opens an editor when the admin panel's page asks, and tells it Puck's config once it's open. */
function EditorService({ channel }: { channel: Channel }) {
  const [opened, setOpened] = useState<{ open: EditorOpen; told: (opened: EditorOpened) => void }>();
  useEffect(
    () =>
      channel.handle(
        "editor.open",
        (open: EditorOpen) =>
          new Promise<EditorOpened>((resolve) => {
            setOpened({ open, told: resolve });
          }),
      ),
    [channel],
  );
  const onOpened = useCallback((editor: EditorOpened) => opened?.told(editor), [opened]);
  // The canvas's width, for previewing a page on a phone or tablet.
  useEffect(
    () =>
      channel.handle("editor.viewport", (width: number | null) => {
        const style = document.documentElement.style;
        if (typeof width === "number" && width > 0) style.setProperty("--gf-canvas-width", `${Math.round(width)}px`);
        else style.removeProperty("--gf-canvas-width");
      }),
    [channel],
  );
  return opened ? <FrameEditor key={editorKey(opened.open)} open={opened.open} onOpened={onOpened} /> : null;
}

function FrameApp({
  config,
  channel,
  init,
  onReady,
}: {
  config: GoodfellowConfig;
  channel: Channel;
  init: FrameInit;
  onReady: () => void;
}) {
  const [site, setSite] = useState<FrameSite>(init);
  const client = useState(() => adminClient(channel))[0];
  useEffect(() => {
    const stops = [
      channel.handle("site", (next: FrameSite) => setSite(next)),
      channel.handle("theme", (theme: ThemeChoice) => setThemeChoice(theme)),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [channel]);
  // After the modes' own effects, which answer the requests that come next.
  const ready = useRef(onReady);
  useEffect(() => ready.current(), []);
  return (
    <FrameProviders config={config} client={client} init={init} site={site}>
      {init.mode === "editor" && <EditorService channel={channel} />}
      {init.mode === "render" && <FrameRender channel={channel} />}
      {init.mode === "code" && <CodeService channel={channel} />}
    </FrameProviders>
  );
}

/**
 * Starts the site's frame in `element`: tells the admin panel's page it's
 * ready, and waits for its port. Only the page that made the frame can answer,
 * since a sandboxed frame's parent is the only window that can reach it.
 */
export interface EditorFrameOptions {
  /**
   * Where the frame loads `@tailwindcss/browser` from, where the admin
   * panel's own address for it can't be loaded from the frame, such as a
   * `blob:` address only the admin panel's page can read.
   */
  tailwindBrowserUrl?: string;
}

export function mountEditorFrame(config: GoodfellowConfig, element?: Element, options: EditorFrameOptions = {}): void {
  document.documentElement.classList.add("gfa-frame");
  let container = element;
  if (!container) {
    container = document.createElement("div");
    container.id = "goodfellow-frame";
    document.body.append(container);
  }
  const root = createRoot(container);
  let connected = false;
  const onMessage = (event: MessageEvent) => {
    const port = event.ports[0];
    if (connected || event.source !== window.parent || !port) return;
    if ((event.data as { type?: unknown } | null)?.type !== CONNECT_MESSAGE) return;
    connected = true;
    window.removeEventListener("message", onMessage);
    const channel = createChannel(port);
    channel.handle(
      "init",
      (given: FrameInit) =>
        new Promise<void>((resolve) => {
          const init = options.tailwindBrowserUrl
            ? { ...given, preview: { ...given.preview, tailwindBrowserUrl: options.tailwindBrowserUrl } }
            : given;
          setThemeChoice(init.theme);
          document.documentElement.classList.add(`gfa-frame-${init.mode}`);
          if (init.siteCss) installSiteCss(init.siteCss);
          root.render(<FrameApp config={config} channel={channel} init={init} onReady={resolve} />);
        }),
    );
  };
  window.addEventListener("message", onMessage);
  window.parent.postMessage(READY_MESSAGE, "*");
}
