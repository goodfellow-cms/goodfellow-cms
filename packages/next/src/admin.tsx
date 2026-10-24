"use client";

import { Admin, OutdatedAdminPage, reloadFrames, type Strings } from "@goodfellow-cms/admin";
import {
  type AdminSite,
  type ContentStore,
  DEV_EDITOR_PREFIX,
  type GitHost,
  type GoodfellowConfig,
  type HostSource,
} from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import "@goodfellow-cms/admin/styles.css";
import themeCss from "./generated/theme-css.js";
import { ADMIN_PAGE, EDITOR_PAGE } from "./site-files.js";

export interface GoodfellowAdminProps {
  /**
   * What the admin panel knows about the site, from `site.admin()` in the
   * server component `app/admin/page.tsx`. The admin panel's page then never
   * loads the site's config: its blocks run in the editor's frames, at `app/admin/editor/`.
   */
  site?: AdminSite;
  /**
   * The site's `goodfellow.config.tsx`, which an `app/admin/page.tsx` from
   * before the editor's frames passes. That page loads every block's code
   * itself, so the admin panel only says how to update it, and never signs in
   * there: `goodfellow-next update` replaces it where it's still the starter's.
   */
  config?: GoodfellowConfig;
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
  host?: GitHost;
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

/**
 * Where the editor's frames are: `app/admin/editor/`, or in `next dev` the
 * bundle the local backend serves, since Next.js refuses its development
 * files to sandboxed frames.
 */
const EDITOR_URL =
  process.env.NODE_ENV === "development" ? `${BASE_PATH}${DEV_EDITOR_PREFIX}` : `${BASE_PATH}/admin/editor/`;

/**
 * In `next dev`, reloads the editor's frames once they're rebuilt, so they
 * show the site's new code, leaving whatever is open on the admin panel's page as it is.
 */
function useEditorRebuilds() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    let shown: number | undefined;
    const check = async () => {
      try {
        const response = await fetch(`${EDITOR_URL}version.json`, { cache: "no-store" });
        const { version } = (await response.json()) as { version: number };
        if (shown !== undefined && version !== shown) reloadFrames();
        shown = version;
      } catch {
        // The dev server is restarting.
      }
    };
    void check();
    const timer = setInterval(check, 1500);
    return () => clearInterval(timer);
  }, []);
}

/**
 * Goodfellow's git hosts, which a site's config names as `site.backend`. A
 * bundler needs every package it may load named here, as the starter's
 * dependencies are.
 */
const HOSTS: Record<string, () => Promise<Record<string, unknown>>> = {
  "@goodfellow-cms/github": () => import("@goodfellow-cms/github"),
  "@goodfellow-cms/gitlab": () => import("@goodfellow-cms/gitlab"),
};

async function hostFrom(source: HostSource): Promise<GitHost> {
  const load = Object.hasOwn(HOSTS, source.package) ? HOSTS[source.package] : undefined;
  const make = load && (await load())[source.export];
  if (typeof make !== "function") throw new Error(`The admin panel can't sign in to ${source.package} yet.`);
  return (make as (options: Record<string, unknown>) => GitHost)(source.options);
}

async function setUp(siteUrl: string, backend: HostSource | undefined): Promise<Setup> {
  const [stylesheets, tailwindBrowser, store, host] = await Promise.all([
    siteStylesheets(siteUrl),
    // Tailwind for the browser is large, so it's only loaded with the admin panel.
    import("./generated/tailwind-browser.js").then((module) => module.default),
    // `next build` drops this branch, so the local backend never ships.
    process.env.NODE_ENV === "development"
      ? import("@goodfellow-cms/admin/dev").then((module) => module.localStore(`${BASE_PATH}/__goodfellow/api`))
      : undefined,
    backend ? hostFrom(backend) : undefined,
  ]);
  const tailwindBrowserUrl = URL.createObjectURL(new Blob([tailwindBrowser], { type: "text/javascript" }));
  return { stylesheets, tailwindBrowserUrl, ...(store && { store }), ...(host && { host }) };
}

/**
 * The admin panel, for a Next.js site's `app/admin/page.tsx`, given
 * `site.admin()` there. In `next dev` it saves to the files on disk; on the
 * live site, editors sign in to the config's git backend, or on a full-stack
 * site (`server`), with the site's own sign-in.
 */
export function GoodfellowAdmin({ site, config, strings, ...props }: GoodfellowAdminProps) {
  if (site) return <SiteAdmin site={site} {...(strings && { strings })} {...props} />;
  if (config) {
    const files = [
      { path: "app/admin/page.tsx", content: ADMIN_PAGE },
      { path: "app/admin/editor/page.tsx", content: EDITOR_PAGE },
    ];
    return <OutdatedAdminPage files={files} {...(strings && { strings })} />;
  }
  throw new Error("GoodfellowAdmin needs `site`, from `site.admin()` in app/admin/page.tsx.");
}

function SiteAdmin({
  site,
  siteUrl = `${BASE_PATH}/`,
  strings,
  server,
}: Omit<GoodfellowAdminProps, "site" | "config"> & { site: AdminSite }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  useEditorRebuilds();

  useEffect(() => {
    let current = true;
    let url: string | undefined;
    void setUp(siteUrl, site.backend).then((result) => {
      url = result.tailwindBrowserUrl;
      if (current) setSetup(result);
      else URL.revokeObjectURL(url);
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [siteUrl, site]);

  if (!setup) return null;
  return (
    <Admin
      site={site}
      frames={{ url: EDITOR_URL }}
      {...(setup.host && { host: setup.host })}
      {...(setup.store && { store: setup.store, registry: `${BASE_PATH}/__goodfellow/api/registry/{name}.json` })}
      {...(server && { server: `${BASE_PATH}${server}` })}
      preview={{ stylesheets: setup.stylesheets, themeCss, tailwindBrowserUrl: setup.tailwindBrowserUrl }}
      siteUrl={siteUrl}
      {...(strings && { strings })}
    />
  );
}
