"use client";

import type { GoodfellowConfig } from "@goodfellow-cms/core";
import { useEffect, useRef } from "react";
import "@puckeditor/core/puck.css";
import "@goodfellow-cms/admin/styles.css";

/** Started once a page: React runs effects twice in development, and a second start would connect again. */
let started = false;

/**
 * The editor's frames, for a Next.js site's `app/admin/editor/page.tsx`,
 * which must be a Client Component (`"use client"`) that imports the site's
 * config: Puck, the config and every block, sandboxed away from the admin
 * panel's page, which signs in and publishes.
 */
export function GoodfellowEditor({ config }: { config: GoodfellowConfig }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = element.current;
    if (!container || started) return;
    started = true;
    void Promise.all([
      import("@goodfellow-cms/admin/editor"),
      // Tailwind for the browser, from this page: the admin panel's copy is at an address only it can read.
      import("./generated/tailwind-browser.js").then((module) => module.default),
    ]).then(([{ mountEditorFrame }, tailwindBrowser]) => {
      const tailwindBrowserUrl = URL.createObjectURL(new Blob([tailwindBrowser], { type: "text/javascript" }));
      mountEditorFrame(config, container, { tailwindBrowserUrl });
    });
  }, [config]);
  return <div ref={element} id="goodfellow-frame" />;
}
