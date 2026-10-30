"use client";

import { useEffect } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/** What Disqus's script reads from the page it's on. */
export interface DisqusPage {
  /** Disqus's script for the site, `https://<shortname>.disqus.com/embed.js`. */
  script: string;
  /**
   * What Disqus knows the page's comments by: its address on the site, without
   * the base path; where the block can't know it (in a Next.js layout), the
   * address the browser has.
   */
  identifier?: string;
  /** The page's full address, from the Site address, or else where the browser has it. */
  url?: string;
}

interface DisqusWindow {
  DISQUS?: { reset(options: { reload: boolean; config: () => void }): void };
  disqus_config?: () => void;
}

/**
 * Disqus's comments, loaded once the page has: its script reads
 * `disqus_config` and puts the comments in `#disqus_thread`, which it finds by
 * its id. After moving to another page on a Next.js site, which keeps the same
 * document and so Disqus's script, Disqus is told the page changed instead.
 */
export function DisqusFrame({ script, identifier, url, className }: DisqusPage & { className: string }) {
  useEffect(() => {
    const page = window as unknown as DisqusWindow;
    const config = function (this: { page: { identifier: string; url: string } }) {
      this.page.identifier = identifier ?? location.pathname;
      this.page.url = url ?? location.href;
    };
    if (page.DISQUS) {
      page.DISQUS.reset({ reload: true, config });
      return;
    }
    page.disqus_config = config;
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    element.setAttribute("data-timestamp", String(Date.now()));
    document.head.appendChild(element);
  }, [script, identifier, url]);
  return <div id="disqus_thread" className={className} />;
}
