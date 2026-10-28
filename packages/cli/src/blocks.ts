import { join, resolve } from "node:path";
import { type GoodfellowConfig, loadSiteContent } from "@goodfellow-cms/core";
import { builtSiteSource } from "@goodfellow-cms/core/node";
import {
  addShadcnBlock,
  type CodemodRunner,
  type PageRender,
  type ShadcnBlockResult,
  type ShadcnRunner,
} from "@goodfellow-cms/core/shadcn";
import { createServer } from "vite";
import { type ClientModules, slashes } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry } from "./site.js";

export interface AddBlockOptions {
  /** The site's folder (default: the current folder). */
  root?: string;
  /** What `shadcn add` takes: `button`, `@acme/hero`, or an item's address. */
  item: string;
  /** Writes the block into a block registry in this folder, rather than into the site. */
  registry?: string;
  /** Runs shadcn's CLI, for tests. */
  shadcn?: ShadcnRunner;
  /** Also makes the block's version for the Expo app in this folder, with shadcn-tamagui-codemod. */
  native?: string;
  /** Runs shadcn-tamagui-codemod, for tests. */
  codemod?: CodemodRunner;
}

/**
 * Renders the block as `goodfellow build` renders pages: through Vite, with
 * the site's config and the block's own file, whose Client Components become
 * islands, so parts that need one another's context fail here as on the site.
 */
function viteRender(root: string): PageRender {
  return async (page, block) => {
    const modules: ClientModules = new Map();
    const server = await createServer({
      ...baseViteConfig(root, findConfigFile(root), modules),
      appType: "custom",
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    });
    try {
      // The renderer comes with the config, so the blocks and it share one copy of the site's context.
      const { config, createPageRenderer } = await loadServerEntry(server);
      // With forward slashes, as Vite writes module ids on Windows too.
      const { default: entry } = (await server.ssrLoadModule(slashes(join(root, block.entry)))) as {
        default: GoodfellowConfig["blocks"][string];
      };
      const render = createPageRenderer({ ...config, blocks: { ...config.blocks, [block.name]: entry } });
      const content = await loadSiteContent(builtSiteSource(root));
      return await render(content, { path: "/", file: "content/pages/index.json", content: page });
    } finally {
      await server.close();
    }
  };
}

/** `goodfellow blocks add <item>`: a shadcn item, installed with shadcn's CLI, as a Goodfellow block. */
export function addBlock(options: AddBlockOptions): Promise<ShadcnBlockResult> {
  const root = resolve(options.root ?? ".");
  return addShadcnBlock({
    root,
    item: options.item,
    ...(options.registry && { registry: resolve(options.registry) }),
    ...(options.shadcn && { shadcn: options.shadcn }),
    ...(options.native && { native: resolve(options.native) }),
    ...(options.codemod && { codemod: options.codemod }),
    render: viteRender(root),
  });
}
