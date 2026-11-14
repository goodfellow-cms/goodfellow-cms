import { readFile } from "node:fs/promises";
import { type ContentSource, loadSiteContent, type SiteContent } from "@goodfellow-cms/core";
import { createServer } from "vite";
import type { ClientModules } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry, loadSourcedSite } from "./site.js";

/**
 * How `goodfellow due` loads the site (`DueOptions.load`): as `goodfellow
 * build` does, with its collections' sources read in, so their items'
 * schedules come due, and the item files they replace, left in their folders,
 * don't. Where the config names no sources, the files alone, without starting
 * Vite. A source that can't be read here, as where the hourly check has none
 * of its secrets, leaves its collection's items out, saying so, rather than
 * fail every check.
 */
export async function dueSite(root: string, files: ContentSource): Promise<SiteContent> {
  // A config whose text never says `collections`, however it's written, names no sources.
  let configFile: string;
  try {
    configFile = findConfigFile(root);
  } catch {
    return loadSiteContent(files);
  }
  if (!/\bcollections\b/.test(await readFile(configFile, "utf8"))) return loadSiteContent(files);
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, configFile, modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { config } = await loadServerEntry(server);
    const sourced = Object.keys(config.collections ?? {});
    if (sourced.length === 0) return await loadSiteContent(files);
    try {
      return await loadSourcedSite(server, root, config, files);
    } catch (error) {
      console.warn(
        `The items of ${sourced.join(", ")} couldn't be read from their sources, so their schedules are left out: ${error instanceof Error ? error.message : String(error)}`,
      );
      return await loadSiteContent(files, { sourced });
    }
  } finally {
    await server.close();
  }
}
