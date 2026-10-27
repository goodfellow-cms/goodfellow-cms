import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  type AdminSite,
  CUSTOM_CSS_FILE,
  type GoodfellowConfig,
  type Page,
  type SiteContent,
  type SiteDescription,
} from "@goodfellow-cms/core";
import type { ContentApiFile } from "@goodfellow-cms/core/content-api";
import type { PageRenderer } from "@goodfellow-cms/react/server";
import tailwindcss from "@tailwindcss/vite";
import type { InlineConfig, Plugin, ViteDevServer } from "vite";
import { blockPackages, type ClientModules, islandsPlugin, slashes } from "./islands.js";

const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];
const SERVER_ENTRY = "virtual:goodfellow/server";
const RESOLVED_SERVER_ENTRY = `\0${SERVER_ENTRY}`;

export class SiteSetupError extends Error {
  override name = "SiteSetupError";
}

export function findConfigFile(root: string): string {
  for (const name of CONFIG_FILES) {
    const path = join(root, name);
    if (existsSync(path)) return path;
  }
  throw new SiteSetupError(`No Goodfellow config found in ${root}. Create goodfellow.config.tsx.`);
}

/** The module loaded inside Vite to render pages: the site's config plus the renderer, sharing one copy of React. */
function serverEntryPlugin(configFile: string): Plugin {
  return {
    name: "goodfellow:server-entry",
    resolveId: (id) => (id === SERVER_ENTRY ? RESOLVED_SERVER_ENTRY : undefined),
    load: (id) =>
      id === RESOLVED_SERVER_ENTRY
        ? [
            `import config from ${JSON.stringify(configFile)};`,
            `import { contentApi, createPageRenderer } from "@goodfellow-cms/react/server";`,
            `import { adminSite, describeSite } from "@goodfellow-cms/react";`,
            "export { config, createPageRenderer };",
            "export const renderPage = createPageRenderer(config);",
            "export const describe = () => describeSite(config);",
            "export const admin = () => adminSite(config);",
            "export const api = (content, pages, options) => contentApi(config, content, pages, options);",
          ].join("\n")
        : undefined,
  };
}

export interface ServerEntry {
  config: GoodfellowConfig;
  renderPage: PageRenderer;
  /** The renderer, from the same modules as the config's blocks, for pages with blocks the config doesn't list yet. */
  createPageRenderer: (config: GoodfellowConfig) => PageRenderer;
  /** What the site says about its blocks, for tools such as the Claude connector (`SITE_DESCRIPTION_PATH`). */
  describe: () => SiteDescription;
  /** What the admin panel's page knows about the site, which never loads its config. */
  admin: () => AdminSite;
  /** The content API's files (`contentApi()`), none where the config turns it off. */
  api: (content: SiteContent, pages: readonly Page[], options?: { base?: string }) => Promise<ContentApiFile[]>;
}

export function loadServerEntry(server: ViteDevServer): Promise<ServerEntry> {
  return server.ssrLoadModule(SERVER_ENTRY) as Promise<ServerEntry>;
}

/**
 * Vite settings shared by every command. `modules` collects the site's Client
 * Components as pages' modules load, for the browser's islands entry.
 */
export function baseViteConfig(root: string, configFile: string, modules: ClientModules): InlineConfig {
  return {
    root,
    configFile: false,
    envDir: false,
    // One cache per site, even when sites share a node_modules folder (such as in a monorepo).
    cacheDir: join(root, "node_modules/.vite"),
    logLevel: "warn",
    plugins: [tailwindcss(), serverEntryPlugin(configFile), islandsPlugin(root, modules)],
    // `@/` is the site's root, as in shadcn/ui projects, where installed blocks find `@/components/ui/…`.
    // With forward slashes: on Windows, Vite doesn't resolve a replacement that mixes `\` and `/`.
    resolve: { alias: [{ find: /^@\//, replacement: `${slashes(root)}/` }] },
    // Packages of blocks go through Vite, so their Client Components become islands too.
    ssr: { noExternal: blockPackages(root) },
  };
}

export interface StylesEntries {
  /** The site's stylesheet followed by the admin's custom CSS: what pages load. */
  site: string;
  /** The site's stylesheet alone. Admin previews add the custom CSS being edited themselves. */
  preview: string;
}

/**
 * Writes the stylesheets Vite builds: the site's stylesheet followed by the
 * admin's custom CSS (unlayered, so it overrides block styles), and one without
 * the custom CSS for admin previews. They live in node_modules/.goodfellow so
 * they never show up in the site's repository.
 */
export async function writeStylesEntries(root: string, config: GoodfellowConfig): Promise<StylesEntries> {
  const styles = resolve(root, config.styles ?? "src/styles.css");
  if (!existsSync(styles)) {
    throw new SiteSetupError(
      `The site's stylesheet ${relative(root, styles)} doesn't exist. Create it, or set "styles" in the Goodfellow config.`,
    );
  }

  const dir = join(root, "node_modules/.goodfellow");
  const importPath = (file: string) => JSON.stringify(relative(dir, file).split("\\").join("/"));
  const siteLines = [`@import ${importPath(styles)};`];
  const customCss = join(root, CUSTOM_CSS_FILE);
  if (existsSync(customCss)) siteLines.push(`@import ${importPath(customCss)};`);

  await mkdir(dir, { recursive: true });
  const entries = { site: join(dir, "styles.css"), preview: join(dir, "preview.css") };
  await writeFile(entries.site, `${siteLines.join("\n")}\n`);
  await writeFile(entries.preview, `@import ${importPath(styles)};\n`);
  return entries;
}

/** The URL path the dev server serves a file in the site at. */
export function devUrl(root: string, file: string): string {
  return `/${relative(root, file).split("\\").join("/")}`;
}
