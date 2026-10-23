"use client";

import { Admin, type FrameSource, type Strings } from "@goodfellow-cms/admin";
import type { AdminSite, ContentStore, GitHost, GoodfellowConfig, HostSource } from "@goodfellow-cms/core";
import { adminSite } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";
import "@goodfellow-cms/admin/styles.css";
import { GoodfellowEditor } from "./editor.js";
import themeCss from "./generated/theme-css.js";

export interface GoodfellowAdminProps {
  /**
   * What the admin panel knows about the site, from `site.admin()` in the
   * server component `app/admin/page.tsx`. The admin panel's page then never
   * loads the site's config: its blocks run in the editor's frames, at `app/admin/editor/`.
   */
  site?: AdminSite;
  /**
   * The site's `goodfellow.config.tsx`, for an `app/admin/page.tsx` made
   * before the editor's frames, which is a Client Component. The admin panel
   * then works as it did, without keeping blocks' code away from the editor's sign-in.
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

/** Where the editor's frames are: `app/admin/editor/`. */
const EDITOR_URL = `${BASE_PATH}/admin/editor/`;

/** The query an `app/admin/page.tsx` made before the editor's frames shows the editor at, in place of the admin panel. */
const LEGACY_EDITOR = "goodfellow-editor";

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

async function setUp(siteUrl: string, backend: HostSource | undefined, legacyHost?: GitHost): Promise<Setup> {
  const [stylesheets, tailwindBrowser, store, host] = await Promise.all([
    siteStylesheets(siteUrl),
    // Tailwind for the browser is large, so it's only loaded with the admin panel.
    import("./generated/tailwind-browser.js").then((module) => module.default),
    // `next build` drops this branch, so the local backend never ships.
    process.env.NODE_ENV === "development"
      ? import("@goodfellow-cms/admin/dev").then((module) => module.localStore(`${BASE_PATH}/__goodfellow/api`))
      : undefined,
    legacyHost ?? (backend ? hostFrom(backend) : undefined),
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
export function GoodfellowAdmin({ site, config, siteUrl = `${BASE_PATH}/`, strings, server }: GoodfellowAdminProps) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [legacyEditor] = useState(
    () => config !== undefined && typeof location !== "undefined" && location.search.includes(LEGACY_EDITOR),
  );
  const [described] = useState(() => site ?? (config ? adminSite(config) : undefined));
  if (!described) throw new Error("GoodfellowAdmin needs `site`, from `site.admin()` in app/admin/page.tsx.");

  useEffect(() => {
    if (legacyEditor) return;
    let current = true;
    let url: string | undefined;
    void setUp(siteUrl, described.backend, config?.backend).then((result) => {
      url = result.tailwindBrowserUrl;
      if (current) setSetup(result);
      else URL.revokeObjectURL(url);
    });
    return () => {
      current = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [siteUrl, described, config, legacyEditor]);

  // A page made before the editor's frames shows the editor too, in its own frame on the same address.
  if (legacyEditor && config) return <GoodfellowEditor config={config} />;
  if (!setup) return null;
  const frames: FrameSource = config
    ? { url: `${location.pathname}?${LEGACY_EDITOR}`, sameOrigin: true }
    : { url: EDITOR_URL, sameOrigin: process.env.NODE_ENV === "development" };
  return (
    <Admin
      site={described}
      frames={frames}
      {...(setup.host && { host: setup.host })}
      {...(setup.store && { store: setup.store, registry: `${BASE_PATH}/__goodfellow/api/registry/{name}.json` })}
      {...(server && { server: `${BASE_PATH}${server}` })}
      preview={{ stylesheets: setup.stylesheets, themeCss, tailwindBrowserUrl: setup.tailwindBrowserUrl }}
      siteUrl={siteUrl}
      {...(strings && { strings })}
    />
  );
}
