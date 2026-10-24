import { resolve } from "node:path";
import type { HostSource } from "@goodfellow-cms/core";
import { createServer } from "vite";
import type { ClientModules } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry, SiteSetupError } from "./site.js";

/** The site's backend as its config makes it (`GitHost.source`), which a token broker's `broker.json` names. */
export async function siteBackend(rootDir = "."): Promise<HostSource> {
  const root = resolve(rootDir);
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, findConfigFile(root), modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const { backend } = (await loadServerEntry(server)).admin();
    if (!backend) {
      throw new SiteSetupError(
        "The site's config has no backend, so there's nothing for a sign-in page to sign in to. Turn on the backend line in goodfellow.config.tsx first.",
      );
    }
    return backend;
  } finally {
    await server.close();
  }
}
