/**
 * The site's styles in the editor's frame, kept to its canvas: the site's
 * compiled CSS, the theme, and what Tailwind makes in the browser for classes
 * typed in the editor and for custom CSS, so none of it restyles Puck.
 */
import {
  COLOR_SCHEME_ATTRIBUTE,
  customFonts,
  escapeStyleText,
  googleFontsUrl,
  type Theme,
  themeToCss,
} from "@goodfellow-cms/core";
import { useEffect } from "react";
import type { PreviewOptions } from "../admin-context.js";
import { installCustomFonts } from "../custom-font-faces.js";
import type { MediaPreviews } from "../media-previews.js";
import { scopeCss } from "./scope-css.js";

function styleElement(key: string): HTMLStyleElement {
  let element = document.head.querySelector<HTMLStyleElement>(`style[data-gf="${key}"]`);
  if (!element) {
    element = document.createElement("style");
    element.dataset.gf = key;
    document.head.append(element);
  }
  return element;
}

/** What `@tailwindcss/browser` writes, which starts with its licence. */
function isTailwindOutput(node: Node): node is HTMLStyleElement {
  return (
    node instanceof HTMLStyleElement &&
    !node.dataset.gf &&
    node.getAttribute("type") === null &&
    (node.textContent ?? "").startsWith("/*! tailwindcss")
  );
}

/**
 * Keeps Tailwind's own output from applying, since it styles the whole page,
 * and puts a copy of it kept to the canvas in its place, as it changes.
 */
function scopeTailwindOutput(): () => void {
  const watched = new WeakSet<HTMLStyleElement>();
  const copy = styleElement("tailwind-scoped");
  const follow = (output: HTMLStyleElement) => {
    if (watched.has(output)) return;
    watched.add(output);
    output.media = "not all";
    const update = () => {
      copy.textContent = scopeCss(output.textContent ?? "");
    };
    update();
    new MutationObserver(update).observe(output, { childList: true, characterData: true, subtree: true });
  };
  const find = () => {
    for (const element of document.head.querySelectorAll("style")) if (isTailwindOutput(element)) follow(element);
  };
  // Tailwind adds its element once, empty, and fills it in later, so every change to the head is looked at.
  const observer = new MutationObserver(find);
  observer.observe(document.head, { childList: true, subtree: true, characterData: true });
  find();
  return () => observer.disconnect();
}

/** The site's compiled CSS, kept to the canvas, once. */
export function installSiteCss(css: string[]): void {
  styleElement("site").textContent = escapeStyleText(scopeCss(css.join("\n")));
}

/**
 * The theme, fonts, custom CSS and Tailwind for the canvas, as the site
 * shows them, light or dark as `scheme` says. The site's own fonts come from
 * their bytes, through `media`, since the frame can't load the site's files.
 */
export function useCanvasStyles(
  preview: PreviewOptions,
  styles: { theme: Theme; customCss: string; scheme: "light" | "dark" },
  media: Pick<MediaPreviews, "bytes">,
): void {
  const { theme, customCss, scheme } = styles;
  useEffect(() => scopeTailwindOutput(), []);

  useEffect(() => {
    // Light-only sites' pages are always light.
    document.documentElement.setAttribute(COLOR_SCHEME_ATTRIBUTE, theme.darkMode ? scheme : "light");
    styleElement("theme").textContent = escapeStyleText(scopeCss(themeToCss(theme, undefined, { fontFaces: false })));
    installCustomFonts(document, customFonts(theme), (url) => media.bytes(url));
    const fonts = googleFontsUrl(theme);
    const link = document.head.querySelector<HTMLLinkElement>('link[data-gf="fonts"]');
    if (fonts) {
      const element = link ?? document.createElement("link");
      element.rel = "stylesheet";
      element.dataset.gf = "fonts";
      element.href = fonts;
      if (!link) document.head.append(element);
    } else {
      link?.remove();
    }
  }, [theme, scheme, media]);

  useEffect(() => {
    // Replaced rather than edited, so Tailwind notices the change and compiles again.
    const text = escapeStyleText(`${preview.themeCss}\n${customCss}`);
    const current = document.head.querySelector<HTMLStyleElement>('style[data-gf="tailwind"]');
    if (current?.textContent === text) return;
    current?.remove();
    const element = document.createElement("style");
    element.type = "text/tailwindcss";
    element.dataset.gf = "tailwind";
    element.textContent = text;
    document.head.append(element);
  }, [preview.themeCss, customCss]);

  useEffect(() => {
    const url = preview.tailwindBrowserUrl;
    if (!url || document.head.querySelector('script[data-gf="tailwind-browser"]')) return;
    const script = document.createElement("script");
    script.dataset.gf = "tailwind-browser";
    script.src = url;
    document.head.append(script);
  }, [preview.tailwindBrowserUrl]);
}
