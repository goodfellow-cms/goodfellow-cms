/**
 * The site's code, run in the page that has loaded it: the frame that runs
 * it for the admin panel, or tests. Never imported by the admin panel's own page.
 */
import { type GoodfellowConfig, pageView, renderedProblems, type SiteProblem, sitePages } from "@goodfellow-cms/core";
import { createPuckConfigs, PageBody, preparePage } from "@goodfellow-cms/react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MAX_RENDERED, type SiteCodeService } from "../site-code.js";

/** The site's code run here, in the page that has loaded it: the frame, or tests. */
export function localSiteCode(config: GoodfellowConfig): SiteCodeService {
  const configs = createPuckConfigs(config);
  return {
    async sitePages(content, today) {
      return sitePages(content, today, config.blocks);
    },
    async pageView(page, content, today) {
      return pageView(page, content, today, config.blocks);
    },
    async renderedProblems(content, targets, today) {
      if (targets.length === 0 || typeof document === "undefined") return [];
      const container = document.createElement("div");
      const root = createRoot(container);
      const problems: SiteProblem[] = [];
      try {
        for (const { page, file } of targets.slice(0, MAX_RENDERED)) {
          try {
            // As builds show it, with its added pages' links on the block they're for.
            const view = pageView(page, content, today, config.blocks);
            const prepared = await preparePage(configs, content, view ? { ...page, view } : page);
            flushSync(() =>
              root.render(
                createElement(PageBody, {
                  site: prepared.site,
                  pageConfig: prepared.pageConfig,
                  layoutConfig: prepared.layoutConfig,
                  page: prepared.data,
                  header: prepared.header,
                  footer: prepared.footer,
                }),
              ),
            );
            problems.push(...renderedProblems({ html: container.innerHTML, path: page.path, file }));
          } catch {
            // Left out: the editor's preview shows what's wrong with the page.
          }
        }
      } finally {
        root.unmount();
      }
      return problems;
    },
  };
}
