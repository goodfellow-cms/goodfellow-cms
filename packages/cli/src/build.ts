import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  absoluteUrl,
  applyBasePath,
  calendarFiles,
  DEMO_CONTENT_PATH,
  demoContent,
  loadSiteContent,
  normalizeBase,
  pageOutputFile,
  redirectFiles,
  sitePages,
  todayIn,
  withBase,
} from "@goodfellow-cms/core";
import { fileSystemSource } from "@goodfellow-cms/core/node";
import { writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { createServer, build as viteBuild } from "vite";
import { ADMIN_ENTRY, adminEntryPlugin, adminHtml } from "./admin-entry.js";
import { type ClientModules, ISLANDS_ENTRY } from "./islands.js";
import { baseViteConfig, findConfigFile, loadServerEntry, writeStylesEntries } from "./site.js";

export interface BuildOptions {
  /** The site's folder. Defaults to the current directory. */
  root?: string;
  /** Where to write the built site, relative to the root. Defaults to `dist`. */
  outDir?: string;
  /** Overrides the config's `base`. */
  base?: string;
}

export interface BuildResult {
  outDir: string;
  /** Repo-relative paths of the HTML files written. */
  pages: string[];
  /** How many pages the search index has, if the site has a search block. */
  searchIndexed?: number;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}

type Manifest = Record<string, ManifestChunk>;

/** Finds a build input in Vite's manifest by the name it was given in `input`. */
function findEntry(manifest: Manifest, name: string): ManifestChunk | undefined {
  return Object.values(manifest).find((chunk) => chunk.isEntry && chunk.name === name);
}

/** The CSS files a build input produced: the file itself for CSS inputs, or the CSS its JavaScript imports. */
function cssFiles(manifest: Manifest, name: string): string[] {
  const entry = findEntry(manifest, name);
  if (!entry) return [];
  return entry.file.endsWith(".css") ? [entry.file] : (entry.css ?? []);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The files a build input's JavaScript imports, and the files they import, to fetch along with it. */
function importedFiles(manifest: Manifest, name: string): string[] {
  const files = new Set<string>();
  const visit = (keys: string[] | undefined) => {
    for (const key of keys ?? []) {
      const chunk = manifest[key];
      if (!chunk || files.has(chunk.file)) continue;
      files.add(chunk.file);
      visit(chunk.imports);
    }
  };
  visit(findEntry(manifest, name)?.imports);
  return [...files];
}

/**
 * Builds a static site: one HTML file per page, the site's CSS, the public
 * folder, a sitemap if the site's address is set, and the JavaScript that runs
 * Client Components on the pages that use them.
 */
export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  // Vite builds for production when NODE_ENV says so, and otherwise sets it to "development" for the server that
  // renders pages, which would give the browser React's development build. Only an explicit "development" is kept.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv !== "development") process.env.NODE_ENV = "production";
  try {
    return await buildSite(options);
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
}

async function buildSite(options: BuildOptions): Promise<BuildResult> {
  const root = resolve(options.root ?? ".");
  const outDir = resolve(root, options.outDir ?? "dist");
  const configFile = findConfigFile(root);

  // Pages are rendered by modules loaded through Vite, so the site's config can use TSX and shares one copy of React.
  // Loading the site's config finds its Client Components, which the browser build then bundles.
  const modules: ClientModules = new Map();
  const server = await createServer({
    ...baseViteConfig(root, configFile, modules),
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });

  try {
    const { config, renderPage } = await loadServerEntry(server);
    const base = normalizeBase(options.base ?? config.base);
    const content = await loadSiteContent(fileSystemSource(root));
    const styles = await writeStylesEntries(root, config);
    const withAdmin = Boolean(config.backend || config.demo);

    // Build the CSS (Tailwind scans content/ for class names), the admin panel if the site has
    // a backend or is a demo, the Client Components if it has any, and copy public/ into the output.
    const input: Record<string, string> = { styles: styles.site };
    if (withAdmin) Object.assign(input, { preview: styles.preview, admin: ADMIN_ENTRY });
    if (modules.size > 0) input.islands = ISLANDS_ENTRY;
    const viteConfig = baseViteConfig(root, configFile, modules);
    await viteBuild({
      ...viteConfig,
      plugins: [...(viteConfig.plugins ?? []), adminEntryPlugin(configFile, { mode: "build" })],
      base,
      build: {
        outDir,
        emptyOutDir: true,
        manifest: "manifest.json",
        // The admin panel bundles Puck and its editor, which is large but only loads at /admin.
        chunkSizeWarningLimit: 4096,
        rolldownOptions: {
          input,
          onLog(level, log, handler) {
            // React libraries mark modules "use client", which only matters to server-component bundlers.
            if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
            handler(level, log);
          },
        },
      },
    });

    const manifestPath = join(outDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    await rm(manifestPath);
    const stylesheets = cssFiles(manifest, "styles").map((file) => `/${file}`);
    const islandsEntry = findEntry(manifest, "islands");
    // Root-relative like the stylesheets: applyBasePath() adds the base path to the finished pages.
    const islands = islandsEntry && {
      script: `/${islandsEntry.file}`,
      preload: importedFiles(manifest, "islands").map((file) => `/${file}`),
      ...(base !== "/" && { base }),
    };

    if (withAdmin) {
      const admin = findEntry(manifest, "admin");
      if (!admin) throw new Error("The admin panel's bundle is missing from the build.");
      const html = adminHtml({
        scripts: [`${base}${admin.file}`],
        stylesheets: cssFiles(manifest, "admin").map((file) => `${base}${file}`),
        settings: { previewStylesheets: cssFiles(manifest, "preview").map((file) => `${base}${file}`), siteUrl: base },
        ...(content.settings.favicon && { icon: withBase(content.settings.favicon, base) }),
      });
      await mkdir(join(outDir, "admin"), { recursive: true });
      await writeFile(join(outDir, "admin/index.html"), html);
      // A demo's admin panel starts from a copy of the site's content, since visitors don't sign in.
      if (config.demo) await writeFile(join(outDir, DEMO_CONTENT_PATH), await demoContent(fileSystemSource(root)));
    }

    const pages = sitePages(content, todayIn(content.settings.timeZone), config.blocks);
    const written: string[] = [];
    for (const page of pages) {
      const html = applyBasePath(await renderPage(content, page, { stylesheets, ...(islands && { islands }) }), base);
      const file = join(outDir, pageOutputFile(page.path));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      written.push(relative(root, file).split("\\").join("/"));
    }

    // Calendar files of collections of events, for subscribing and for adding events to calendars.
    for (const file of calendarFiles(content)) {
      const target = join(outDir, file.path.slice(1));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }

    // A page at each old address that sends visitors on. Pages, and files in public/, win over redirects.
    for (const file of redirectFiles(content, { taken: pages.map((page) => page.path), base })) {
      const target = join(outDir, file.path.slice(1));
      if (await exists(target)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }

    const { url } = content.settings;
    if (url) {
      const urls = pages
        .filter((page) => page.path !== "/404")
        .map((page) => `  <url><loc>${escapeXml(absoluteUrl(url, page.path))}</loc></url>`);
      await writeFile(
        join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      );
      await writeFile(
        join(outDir, "robots.txt"),
        `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl(url, "/sitemap.xml")}\n`,
      );
    }

    // Last, once every page is written: the index is made from the finished HTML.
    const searchIndexed = await writeSearchIndex(outDir);
    return { outDir, pages: written, ...(searchIndexed !== undefined && { searchIndexed }) };
  } finally {
    await server.close();
  }
}
