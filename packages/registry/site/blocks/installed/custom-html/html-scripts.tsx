"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/** Scripts that have already run, so a second pass (React's Strict Mode runs effects twice) doesn't run them again. */
const ran = new WeakSet<Element>();

const noSubscription = () => () => {};

/** Runs a script that was put in the page as HTML, which browsers never run on their own. */
function run(original: HTMLScriptElement): Promise<void> {
  const script = document.createElement("script");
  for (const { name, value } of original.attributes) script.setAttribute(name, value);
  script.text = original.text;
  ran.add(script);
  // An external script runs once it has loaded; the next one waits for it, as when the page is first opened.
  const waits = Boolean(original.src) && !original.async && original.type !== "module";
  const loaded = waits
    ? new Promise<void>((resolve) => {
        script.addEventListener("load", () => resolve());
        script.addEventListener("error", () => resolve());
      })
    : Promise.resolve();
  if (waits) script.async = false;
  original.replaceWith(script);
  return loaded;
}

/**
 * HTML with scripts, used as it was written. When the page is first opened
 * the browser runs its scripts; when it's shown without a new page load (moving
 * between pages on a Next.js site), this runs them, in order.
 */
export function HtmlWithScripts({ html, className }: { html: string; className: string }) {
  const container = useRef<HTMLDivElement>(null);
  // True when React takes over HTML the browser loaded with the page, whose scripts have already run.
  const hydrating = useSyncExternalStore(
    noSubscription,
    () => false,
    () => true,
  );
  const fromPage = useRef(hydrating);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs the scripts again whenever the HTML changes
  useEffect(() => {
    const scripts = [...(container.current?.querySelectorAll("script") ?? [])].filter((script) => !ran.has(script));
    if (fromPage.current) {
      fromPage.current = false;
      for (const script of scripts) ran.add(script);
      return;
    }
    let cancelled = false;
    (async () => {
      for (const script of scripts) {
        if (cancelled) return;
        await run(script);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={container}
      className={className || undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the editor chose to use this HTML as written
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
