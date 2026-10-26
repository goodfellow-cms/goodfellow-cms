/**
 * The site's code, run in the page that has loaded it: the frame that runs
 * it for the admin panel, or tests. Never imported by the admin panel's own page.
 */
import {
  allPages,
  DRAWN_SLOT_ELEMENT,
  type GoodfellowConfig,
  type Page,
  pageView,
  renderedProblems,
  type SiteContent,
  type SiteProblem,
  sitePages,
} from "@goodfellow-cms/core";
import { createPuckConfigs, PageBody, PageContent, type PuckConfigs, preparePage } from "@goodfellow-cms/react";
import type { ComponentConfig, ComponentData } from "@puckeditor/core";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { type DrawTarget, MAX_RENDERED, type SiteCodeService } from "../site-code.js";

/** The block drawn in each slot's place, which only drawing has: its name can't be one of a site's. */
const DRAWN_SLOT_BLOCK = "__goodfellow_drawn_slot__";

/** A block that draws nothing but an empty `DRAWN_SLOT_ELEMENT` with its slot's name. */
const drawnSlot = {
  fields: { slot: { type: "text" } },
  render: ({ slot }: { slot?: unknown }) => createElement(DRAWN_SLOT_ELEMENT, { "data-slot": String(slot ?? "") }),
} as unknown as ComponentConfig;

/** The block as it's drawn: each of its slots holding only the block that marks its place. */
function withSlotPlaces(block: ComponentData, config: ComponentConfig | undefined): ComponentData {
  const fields = (config?.fields ?? {}) as Record<string, { type?: string }>;
  const places = Object.entries(fields)
    .filter(([, field]) => field.type === "slot")
    .map(([slot]) => [slot, [{ type: DRAWN_SLOT_BLOCK, props: { id: `${String(block.props.id)}:${slot}`, slot } }]]);
  return { ...block, props: { ...block.props, ...Object.fromEntries(places) } };
}

/** One block drawn as the site draws it, in the page at its address, as `drawBlock()` describes. */
async function drawBlock(configs: PuckConfigs, content: SiteContent, { kind, path, block }: DrawTarget) {
  const layout = kind === "header" || kind === "footer";
  const config = layout ? configs.layout : kind === "template" ? configs.template : configs.page;
  if (!config.components[block.type]) throw new Error(`The site has no block called ${block.type} here.`);
  // The page it's on, with this block alone: neither an item's page nor one blocks add, so it's drawn as it's edited.
  const found = allPages(content).find((page) => page.path === path);
  const root = layout ? (kind === "header" ? content.header : content.footer).data.root : found?.content.data.root;
  const page = {
    path,
    file: found?.file ?? "",
    content: {
      ...found?.content,
      version: found?.content.version ?? 1,
      data: { root: root ?? { props: {} }, content: [withSlotPlaces(block, config.components[block.type])] },
    },
  } as Page;
  const prepared = await preparePage({ ...configs, page: config }, content, page);
  const container = document.createElement("div");
  const reactRoot = createRoot(container);
  try {
    flushSync(() =>
      reactRoot.render(
        createElement(PageContent, {
          // Without the photo credits pages end with: they're the page's, not the block's.
          site: { ...prepared.site, credits: [] },
          pageConfig: prepared.pageConfig,
          page: prepared.data,
        }),
      ),
    );
    // The block alone, without the element Puck puts the page's blocks in.
    const main = container.querySelector("main");
    const zone = main?.children.length === 1 ? main.firstElementChild : null;
    const bare = zone?.tagName === "DIV" && zone.attributes.length === 0;
    return (bare ? zone : main)?.innerHTML ?? "";
  } finally {
    reactRoot.unmount();
  }
}

/** The site's code run here, in the page that has loaded it: the frame, or tests. */
export function localSiteCode(config: GoodfellowConfig): SiteCodeService {
  const configs = createPuckConfigs(config);
  let drawing: PuckConfigs | undefined;
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
    async drawBlock(content, target) {
      if (typeof document === "undefined") throw new Error("Blocks are drawn only in a browser.");
      drawing ??= createPuckConfigs({ ...config, blocks: { ...config.blocks, [DRAWN_SLOT_BLOCK]: drawnSlot } });
      return drawBlock(drawing, content, target);
    },
  };
}
