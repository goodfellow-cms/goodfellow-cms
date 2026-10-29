"use client";

import type { ImageSize } from "@goodfellow-cms/core";
import type { SiteImageProps, SiteLinkProps } from "@goodfellow-cms/react";
import { CurrentPathProvider } from "@goodfellow-cms/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

// A Client Component module, so Server Components can pass these to the browser for Client Components in blocks.

/** A link to one of the site's pages, with Next.js's client-side navigation. Next.js adds the base path. */
export function NextLink(props: SiteLinkProps) {
  return <Link {...props} />;
}

/** One of the site's images, through Next.js's image component. Its address already has the base path. */
export function NextImage({ src, alt, width, height, loading = "eager", ...props }: SiteImageProps & ImageSize) {
  // Loads lazily only when the block asks to, as `<img>` does, so a logo at the top of the page isn't delayed.
  return <Image {...props} src={src} alt={alt} width={width} height={height} loading={loading} />;
}

/** A path without its trailing slash, but for the site's home page: `/news/` → `/news`. */
function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Marks the current page's links in the site's menus (`data-current`, and
 * `aria-current` for the page itself), as Menu does when it knows the page. The
 * layout's header and footer are shared by every page, so they can't know it;
 * this runs in the browser after every navigation instead, and closes a menu
 * button's links, which would otherwise stay open on the new page.
 */
export function CurrentMenuLinks({ basePath = "" }: { basePath?: string }) {
  const pathname = usePathname();
  useEffect(() => {
    void pathname;
    const here = trimSlash(location.pathname);
    const home = trimSlash(`${basePath}/`);
    for (const link of document.querySelectorAll<HTMLAnchorElement>("[data-gf-menu] a[href]")) {
      const url = new URL(link.href, location.href);
      const target = trimSlash(url.pathname);
      const local = url.origin === location.origin;
      const exact = local && target === here;
      link.toggleAttribute("data-current", exact || (local && target !== home && here.startsWith(`${target}/`)));
      if (exact) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    // A menu button's links stay open in the shared header otherwise.
    for (const panel of document.querySelectorAll<HTMLDetailsElement>("[data-gf-menu] details[open]")) {
      panel.open = false;
    }
  }, [pathname, basePath]);
  return null;
}

/**
 * Opens the Search box's results with Next.js's navigation, and loads them
 * ahead when they're pointed at or reached with the keyboard, as `next/link`
 * does. The Search box writes its results itself (`searchScript()`), as plain
 * links, so pages built with `goodfellow build` need no React for them.
 */
export function SearchResultLinks({ basePath = "" }: { basePath?: string }) {
  const router = useRouter();
  useEffect(() => {
    const prefix = trimSlash(basePath) === "/" ? "" : trimSlash(basePath);
    /** A result's address within the site, without the base path, which Next.js's router adds. */
    const target = (event: Event): string | undefined => {
      const link = (event.target as Element | null)?.closest?.("[data-gf-search-box] a[href]");
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return undefined;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin) return undefined;
      if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return undefined;
      return `${url.pathname.slice(prefix.length) || "/"}${url.search}${url.hash}`;
    };
    const open = (event: MouseEvent) => {
      // A new tab or window, or another script's own handling, is left to the browser.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const to = target(event);
      if (!to) return;
      event.preventDefault();
      router.push(to);
    };
    const prefetch = (event: Event) => {
      const to = target(event);
      if (to) router.prefetch(to);
    };
    document.addEventListener("click", open);
    document.addEventListener("pointerover", prefetch);
    document.addEventListener("focusin", prefetch);
    return () => {
      document.removeEventListener("click", open);
      document.removeEventListener("pointerover", prefetch);
      document.removeEventListener("focusin", prefetch);
    };
  }, [router, basePath]);
  return null;
}

/**
 * On a site in several languages, says the page's language on `<html>`, which
 * the root layout shared by every page can't. `goodfellow-next finish` writes
 * it into exported pages; this keeps it right as visitors move between pages.
 */
export function PageLanguage({ language }: { language: string }) {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return null;
}

/**
 * On a site in several languages, shows the layout's header or footer in the
 * language of the page at the current address: the layout has one of each,
 * already rendered, for every language. Blocks inside it learn the address
 * from `useCurrentPath()`, such as the Language switch, whose links follow it.
 */
export function ByLanguage({ variants }: { variants: Array<{ prefix: string; children: ReactNode }> }) {
  const pathname = usePathname();
  const shown =
    variants.find(
      (variant) => variant.prefix && (pathname === variant.prefix || pathname.startsWith(`${variant.prefix}/`)),
    ) ?? variants.find((variant) => !variant.prefix);
  return <CurrentPathProvider path={pathname}>{shown?.children}</CurrentPathProvider>;
}
