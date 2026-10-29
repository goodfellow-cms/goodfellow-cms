import type { GoodfellowConfig } from "@goodfellow-cms/core";
import { createServer } from "vite";
import type { ClientModules } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry } from "./site.js";

/**
 * The site's config, loaded as `goodfellow build` loads it, for `goodfellow
 * task`, which loads it in a process of its own (`sitePluginsApart()`), never
 * the one holding the job's secrets.
 */
export async function loadTaskConfig(root: string): Promise<GoodfellowConfig> {
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, findConfigFile(root), modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    return (await loadServerEntry(server)).config;
  } finally {
    await server.close();
  }
}
