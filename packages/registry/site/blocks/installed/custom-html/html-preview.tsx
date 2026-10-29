"use client";

import { useEffect, useRef, useState } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/**
 * Shows HTML as it was written, in the editor only: inside a frame sandboxed
 * with nothing allowed, so it can't reach the admin panel or the editor's
 * sign-in. Its scripts don't run there, since the editor runs only its own
 * scripts; they run on the published site. It has the page's styles, and
 * can be made taller by dragging its corner.
 */
export function HtmlPreview({ html, className }: { html: string; className: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [styles, setStyles] = useState("");

  useEffect(() => {
    const document = frame.current?.ownerDocument;
    if (!document) return;
    setStyles(
      [...document.querySelectorAll('link[rel="stylesheet"], style')].map((element) => element.outerHTML).join(""),
    );
  }, []);

  return (
    <div className={className || undefined}>
      <div style={{ height: 240, resize: "vertical", overflow: "hidden" }}>
        <iframe
          ref={frame}
          title="Custom HTML"
          sandbox=""
          srcDoc={`<!doctype html><html><head><meta charset="utf-8">${styles}</head><body style="margin:0">${html}</body></html>`}
          style={{ display: "block", width: "100%", height: "100%", border: 0 }}
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Scripts don't run in the editor. They run on the published site.
      </p>
    </div>
  );
}
