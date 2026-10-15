import { COLOR_SCHEME_ATTRIBUTE, escapeStyleText, googleFontsUrl, type Theme, themeToCss } from "@goodfellow-cms/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type PreviewOptions, useAdmin } from "./admin-context.js";
import { showMediaInPreview } from "./media-previews.js";
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

  upsert(doc, "theme", "style", () => {}).textContent = themeToCss(styles.theme);

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

/** Applies preview styles to a document whenever the theme or custom CSS change, and keeps its media showing. */
export function usePreviewStyles(doc: Document | null | undefined, styles: PreviewStyles): void {
  const { preview, mediaPreviews } = useAdmin();
  const dark = useDarkMode();
  const scheme = styles.scheme ?? (dark ? "dark" : "light");
  useEffect(() => {
    if (!doc) return;
    preventNavigation(doc);
    installPreviewStyles(doc, preview, { ...styles, scheme });
  }, [doc, preview, styles, scheme]);
  useEffect(() => (doc ? showMediaInPreview(doc, mediaPreviews) : undefined), [doc, mediaPreviews]);
}

const FRAME_WIDTH = 1280;
const EMPTY_DOCUMENT =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';

/**
 * A scaled-down, read-only view of a page as it will look on a desktop screen,
 * rendered into an isolated iframe so the site's styles and the admin panel's don't mix.
 */
export function PreviewFrame({
  title,
  styles,
  children,
}: {
  title: string;
  styles: PreviewStyles;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(800);
  usePreviewStyles(doc, styles);

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
        srcDoc={EMPTY_DOCUMENT}
        onLoad={(event) => setDoc(event.currentTarget.contentDocument)}
        style={{ width: FRAME_WIDTH, height: height / scale, transform: `scale(${scale})` }}
      />
      {doc && createPortal(children, doc.body)}
    </div>
  );
}
