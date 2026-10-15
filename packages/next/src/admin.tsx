import { Admin, type Strings } from "@goodfellow-cms/admin";
import type { ContentStore, GoodfellowConfig } from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import "@puckeditor/core/puck.css";
import "@goodfellow-cms/admin/styles.css";
import themeCss from "./generated/theme-css.js";

export interface GoodfellowAdminProps {
  /** The site's `goodfellow.config.tsx`. */
  config: GoodfellowConfig;
  /** The live site's address, for "View" links. Defaults to the site's base path, such as `/` or `/my-site/`. */
  siteUrl?: string;
  /** Replaces any of the admin panel's text, for rewording or translation. */
  strings?: Partial<Strings>;
  /**
   * On a full-stack site, the address of its `goodfellowApi()` route, such as
   * `/api/goodfellow`, without the base path. Editors then sign in with the
   * site's own sign-in, and its server publishes for them. `next dev` still
   * saves to the files on disk.
   */
  server?: string;
}

interface Setup {
  store?: ContentStore;
  stylesheets: string[];
  tailwindBrowserUrl: string;
}

/**
 * The site's own stylesheets, as Next.js serves them, for previews to look like
 * the site. Next.js names them as it builds them, so they're read from the
 * site's home page rather than known in advance.
 */
async function siteStylesheets(siteUrl: string): Promise<string[]> {
  try {
    const response = await fetch(siteUrl, { headers: { accept: "text/html" } });
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]'))
      .map((link) => new URL(link.getAttribute("href") ?? "", response.url).href)
      .filter((href) => !href.startsWith("https://fonts.googleapis.com/"));
  } catch {
    return [];
  }
}

/** Set by `withGoodfellow()` from Next.js's `basePath`, such as `/my-site`, or empty. */
const BASE_PATH = process.env.GOODFELLOW_BASE_PATH ?? "";

async function setUp(siteUrl: string): Promise<Setup> {
  const [stylesheets, tailwindBrowser, store] = await Promise.all([
    siteStylesheets(siteUrl),
    // Tailwind for the browser is large, so it's only loaded with the admin panel.
    import("./generated/tailwind-browser.js").then((module) => module.default),
    // `next build` drops this branch, so the local backend never ships.
    process.env.NODE_ENV === "development"
      ? import("@goodfellow-cms/admin/dev").then((module) => module.localStore(`${BASE_PATH}/__goodfellow/api`))
      : undefined,
  ]);
  const tailwindBrowserUrl = URL.createObjectURL(new Blob([tailwindBrowser], { type: "text/javascript" }));
  return { stylesheets, tailwindBrowserUrl, ...(store && { store }) };
}

/**
 * The admin panel, for a Next.js site's `app/admin/page.tsx`, which must be a
 * Client Component (`"use client"`) that imports the site's config.
 * In `next dev` it saves to the files on disk; on the live site, editors sign
 * in to the config's git backend, or on a full-stack site (`server`), with the site's own sign-in.
 */
export function GoodfellowAdmin({ config, siteUrl = `${BASE_PATH}/`, strings, server }: GoodfellowAdminProps) {
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    let current = true;
    let url: string | undefined;
    void setUp(siteUrl).then((result) => {
      url = result.tailwindBrowserUrl;
      if (current) setSetup(result);
      else URL.revokeObjectURL(url);
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [siteUrl]);

  if (!setup) return null;
  return (
    <Admin
      config={config}
      {...(setup.store && { store: setup.store, registry: `${BASE_PATH}/__goodfellow/api/registry/{name}.json` })}
      {...(server && { server: `${BASE_PATH}${server}` })}
      preview={{ stylesheets: setup.stylesheets, themeCss, tailwindBrowserUrl: setup.tailwindBrowserUrl }}
      siteUrl={siteUrl}
      {...(strings && { strings })}
    />
  );
}
