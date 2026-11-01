import {
  COLOR_SCHEME_ATTRIBUTE,
  customFonts,
  escapeStyleText,
  googleFontsUrl,
  type Theme,
  themeToCss,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { type PreviewOptions, useAdmin } from "./admin-context.js";
import { installCustomFonts } from "./custom-font-faces.js";
import { type FrameClient, useFrame, useFrameUpdates } from "./frame/host.js";
import type { RenderShow } from "./frame/protocol.js";
import { type MediaPreviews, showMediaInPreview } from "./media-previews.js";
import { useDarkMode } from "./theme.js";

/** Whether a preview shows the site light or dark. */
export type PreviewScheme = "light" | "dark";

export interface PreviewStyles {
  theme: Theme;
  customCss: string;
  /** Light or dark, for sites with dark mode. Without it, previews are like the admin panel. */
  scheme?: PreviewScheme;
}

function upsert<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  key: string,
  tag: K,
  setup: (element: HTMLElementTagNameMap[K]) => void,
): HTMLElementTagNameMap[K] {
  let element = doc.head.querySelector<HTMLElementTagNameMap[K]>(`[data-gf="${key}"]`);
  if (!element) {
    element = doc.createElement(tag);
    element.dataset.gf = key;
    setup(element);
    doc.head.append(element);
  }
  return element;
}

/**
 * Styles a preview document like the live site: the site's compiled CSS, the
 * theme being edited, and the custom CSS being edited. Tailwind runs in the
 * browser too, so classes typed in the editor take effect before the site is rebuilt.
 */
export function installPreviewStyles(
  doc: Document,
  options: PreviewOptions,
  styles: PreviewStyles & { scheme: PreviewScheme },
  media?: Pick<MediaPreviews, "bytes">,
): void {
  // Light-only sites' previews are always light, as their pages are.
  doc.documentElement.setAttribute(COLOR_SCHEME_ATTRIBUTE, styles.theme.darkMode ? styles.scheme : "light");
  options.stylesheets.forEach((href, index) => {
    upsert(doc, `stylesheet-${index}`, "link", (link) => {
      link.rel = "stylesheet";
      link.href = href;
    });
  });

  const fonts = googleFontsUrl(styles.theme);
  const fontsLink = doc.head.querySelector<HTMLLinkElement>('[data-gf="fonts"]');
  if (fonts) {
    upsert(doc, "fonts", "link", (link) => {
      link.rel = "stylesheet";
    }).href = fonts;
  } else {
    fontsLink?.remove();
  }

  // The site's own fonts come from their bytes, which previews' frames can't load from the site.
  upsert(doc, "theme", "style", () => {}).textContent = themeToCss(styles.theme, undefined, { fontFaces: false });
  if (media) installCustomFonts(doc, customFonts(styles.theme), (url) => media.bytes(url));

  // Replaced rather than edited, so Tailwind notices the change and recompiles.
  const tailwindCss = escapeStyleText(`${options.themeCss}\n${styles.customCss}`);
  const current = doc.head.querySelector<HTMLStyleElement>('[data-gf="tailwind"]');
  if (current?.textContent !== tailwindCss) {
    current?.remove();
    const style = doc.createElement("style");
    style.type = "text/tailwindcss";
    style.dataset.gf = "tailwind";
    style.textContent = tailwindCss;
    doc.head.append(style);
  }

  if (options.tailwindBrowserUrl) {
    const url = options.tailwindBrowserUrl;
    upsert(doc, "tailwind-browser", "script", (script) => {
      script.src = url;
    });
  }
}

/** Keeps links in a preview from navigating away from the editor. */
function preventNavigation(doc: Document): void {
  if (doc.documentElement.dataset.gfNoNavigate) return;
  doc.documentElement.dataset.gfNoNavigate = "true";
  doc.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
  });
}

/**
 * Applies preview styles to a document whenever the theme or custom CSS
 * change, and keeps its media showing: the site's own, or `media`, such as the
 * site's media as it was at an earlier publish.
 */
export function usePreviewStyles(doc: Document | null | undefined, styles: PreviewStyles, media?: MediaPreviews): void {
  const { preview, mediaPreviews: current } = useAdmin();
  const mediaPreviews = media ?? current;
  const dark = useDarkMode();
  const scheme = styles.scheme ?? (dark ? "dark" : "light");
  useEffect(() => {
    if (!doc) return;
    preventNavigation(doc);
    installPreviewStyles(doc, preview, { ...styles, scheme }, mediaPreviews);
  }, [doc, preview, styles, scheme, mediaPreviews]);
  useEffect(() => (doc ? showMediaInPreview(doc, mediaPreviews) : undefined), [doc, mediaPreviews]);
}

const FRAME_WIDTH = 1280;

/**
 * A scaled-down, read-only view of a page as it will look on a desktop screen,
 * rendered by the site's code in a sandboxed frame of its own, so the site's
 * styles and the admin panel's don't mix and its blocks can't reach the admin panel.
 */
export function PreviewFrame({
  title,
  show,
  media,
}: {
  title: string;
  /** The page to show: the one at `path` in `content`. */
  show: RenderShow | undefined;
  /** Where the preview's media comes from, if not the site as it is now. */
  media?: MediaPreviews;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(800);
  const latest = useRef(show);
  latest.current = show;
  const onConnect = useCallback(async (client: FrameClient) => {
    if (latest.current) await client.call("render.show", latest.current);
  }, []);
  const { client, frameProps } = useFrame({ mode: "render", onConnect, ...(media && { media }) });
  useFrameUpdates(client);
  useEffect(() => {
    if (client && show) void client.call("render.show", show).catch(() => {});
  }, [client, show]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Resize on the next frame, so resizing the iframe can't re-trigger this observer in the same frame.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setScale(Math.min(1, width / FRAME_WIDTH));
        setHeight(height);
      });
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={container} className="gfa-preview">
      <iframe
        title={title}
        {...frameProps}
        style={{ width: FRAME_WIDTH, height: height / scale, transform: `scale(${scale})` }}
      />
    </div>
  );
}
