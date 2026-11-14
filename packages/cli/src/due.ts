import {
  type CollectionSources,
  type ContentSource,
  closeSources,
  loadReadableSources,
  loadSiteContent,
  type SiteContent,
} from "@goodfellow-cms/core";
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
    const sourced = Object.keys(config.collections ?? {});
    if (sourced.length === 0) return await loadSiteContent(files);
    let sources: CollectionSources;
    try {
      sources = await loadCollectionSources(server, root, config);
    } catch (error) {
      // Sources that can't even be made leave every sourced collection's items out.
      warnUnread(sourced, [error]);
      return await loadSiteContent(files, { sourced });
    }
    try {
      // Only the sources that can't be read are left out, so the others' schedules still come due.
      const { content, failed, errors } = await loadReadableSources(files, sources);
      if (failed.length > 0) warnUnread(failed, errors);
      return content;
    } finally {
      await closeSources(sources);
    }
  } finally {
    await server.close();
  }
}

/** Says which collections' schedules are left out, since their sources couldn't be read, and why. */
function warnUnread(ids: readonly string[], errors: readonly unknown[]): void {
  const why = errors.map((error) => (error instanceof Error ? error.message : String(error))).join("; ");
  console.warn(
    `The items of ${ids.join(", ")} couldn't be read from their sources, so their schedules are left out: ${why}`,
  );
}
