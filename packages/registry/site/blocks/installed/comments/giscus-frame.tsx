"use client";

import { useEffect, useRef } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/**
 * Giscus's comments, loaded once the page has: its script reads its settings
 * from its own attributes and puts the comments in the `.giscus` element.
 * Started again after moving to another page on a Next.js site, which keeps
 * the same document.
 */
export function GiscusFrame({
  script,
  attributes,
  className,
}: {
  script: string;
  attributes: Record<string, string>;
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const settings = JSON.stringify(attributes);
  useEffect(() => {
    const container = box.current;
    if (!container) return;
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    element.crossOrigin = "anonymous";
    for (const [name, value] of Object.entries(JSON.parse(settings) as Record<string, string>)) {
      element.setAttribute(name, value);
    }
    container.after(element);
    return () => {
      element.remove();
      container.replaceChildren();
    };
  }, [script, settings]);
  return <div ref={box} className={`giscus ${className}`.trim()} />;
}
