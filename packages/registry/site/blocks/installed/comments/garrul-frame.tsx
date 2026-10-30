"use client";

import { garrulSlug } from "@goodfellow-cms/core";
import { useEffect, useRef } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/** The elements Garrul's script has been loaded for, which it can show comments in only once. */
const started = new WeakSet<Element>();

/**
 * Garrul's comments, loaded once the page has: its script reads its settings
 * from `#garrul`'s attributes, which it finds by its id, and puts the comments
 * there. Its script runs again whenever it's added, so after moving to another
 * page on a Next.js site, which keeps the same document, adding it again shows
 * the new page's. Where the block can't know the page (in a Next.js layout),
 * the thread is named by the browser's address.
 */
export function GarrulFrame({
  script,
  attributes,
  className,
}: {
  script: string;
  attributes: Record<string, string>;
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = box.current;
    if (!host || started.has(host)) return;
    started.add(host);
    if (!host.dataset.slug) host.dataset.slug = garrulSlug(location.pathname);
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    document.head.appendChild(element);
  }, [script]);
  return <div ref={box} id="garrul" className={className} {...attributes} />;
}
