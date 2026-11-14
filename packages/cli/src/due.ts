import { type ContentSource, dueContent, loadSiteContent, type SiteContent } from "@goodfellow-cms/core";
import { createServer } from "vite";
import type { ClientModules } from "./islands.js";
import { baseViteConfig, findConfigFile, loadCollectionSources, loadServerEntry } from "./site.js";

/**
 * How `goodfellow due` loads the site (`DueOptions.load`): as `goodfellow
 * build` does, with its collections' sources read in, so their items'
 * schedules come due, and the item files they replace, left in their folders,
 * don't. The config is loaded whatever its text says, since it can name its
 * collections in any way JavaScript allows; where it names no sources, the
 * files alone. Where the site has no config, the files, without starting Vite.
 * The sources are closed once read (`closeSources()`), so a database pool
 * doesn't keep the check running. A source that can't be read here, as where the hourly check has none
 * of its secrets, leaves its collection's items out, saying so, rather than
 * fail every check.
 */
export async function dueSite(root: string, files: ContentSource): Promise<SiteContent> {
  let configFile: string;
  try {
    configFile = findConfigFile(root);
  } catch {
    return loadSiteContent(files);
  }
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, configFile, modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { config } = await loadServerEntry(server);
    return await dueContent(
      files,
      Object.keys(config.collections ?? {}),
      () => loadCollectionSources(server, root, config),
      {
        close: true,
      },
    );
  } finally {
    await server.close();
  }
}
