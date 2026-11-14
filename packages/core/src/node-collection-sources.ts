// Loading the modules a site's config names for its collections' sources, for the tools that load them themselves
// (`goodfellow build` and `goodfellow dev` through Vite, `goodfellow-next finish` and `next dev` with Rolldown), so
// they resolve the config's names the same way and differ only in how a module is loaded.
import { resolve } from "node:path";
import type { GoodfellowConfig } from "./config.js";
import {
  type CollectionSources,
  keptCollectionSources,
  type SourceModuleImport,
} from "./content/collection-sources.js";

/**
 * A module the config names, as Node and bundlers import it: a path from the
 * site's root (`./`, `../`), made absolute, or a package's export, as it is.
 */
export function siteModulePath(root: string, specifier: string): string {
  return specifier.startsWith("./") || specifier.startsWith("../") ? resolve(root, specifier) : specifier;
}

/**
 * The sources `collections` names, each module loaded with `load` from its
 * path (`siteModulePath()`), every one at once, so a request after an edit
 * waits for the slowest rather than all of them in turn, and made once for
 * the same modules (`keptCollectionSources()`), since the development servers
 * load them again on every request.
 */
export async function loadSourceModules(
  root: string,
  collections: GoodfellowConfig["collections"],
  load: (path: string) => Promise<unknown>,
): Promise<CollectionSources> {
  const modules: Record<string, SourceModuleImport> = Object.fromEntries(
    await Promise.all(
      Object.entries(collections ?? {}).map(
        async ([id, collection]) =>
          [id, (await load(siteModulePath(root, collection.source))) as SourceModuleImport] as const,
      ),
    ),
  );
  return keptCollectionSources(collections, modules, root);
}
