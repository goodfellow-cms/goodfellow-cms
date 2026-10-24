import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  absoluteUrl,
  applyBasePath,
  CLOUDFLARE_REDIRECTS_PATH,
  calendarFiles,
  checkSite,
  cloudflareRedirects,
  DEMO_CONTENT_PATH,
  demoContent,
  feedFiles,
  loadSiteContent,
  MEDIA_DIR,
  normalizeBase,
  pageOutputFile,
  type Redirect,
  redirectFiles,
  resetDateChanges,
  rootRobotsUrl,
  type ScheduledChange,
  type SelfHostedResult,
  SITE_DESCRIPTION_PATH,
  type SiteProblem,
  shownContent,
  sitemapPages,
  sitePages,
  todayIn,
  upcomingChanges,
  withBase,
} from "@goodfellow-cms/core";
import { type BuiltPage, checkBuiltPages } from "@goodfellow-cms/core/accessibility";
import { fileSystemSource, guardBuiltSite, selfHostFonts, writeBuildRecord } from "@goodfellow-cms/core/node";
import { writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { createServer, build as viteBuild } from "vite";
import { ADMIN_ENTRY, adminEntryPlugin, adminHtml } from "./admin-entry.js";
import { buildEditor } from "./editor-bundle.js";
import { type ClientModules, ISLANDS_ENTRY } from "./islands.js";
import { cssFiles, findEntry, type Manifest } from "./manifest.js";
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
  /** What the site checks found: links to pages and media the site doesn't have, and things to improve. */
  problems: SiteProblem[];
  /** The next change the site's schedules make, which the site must be rebuilt for. */
  nextChange?: ScheduledChange;
  /**
   * When something the site shows by today's date, or a scheduled change, makes
   * it different, as the build record (`goodfellow-build.json`) says.
   */
  currentUntil?: string;
  /**
   * How many redirects didn't fit in Cloudflare Pages' `_redirects`, past its
   * limit of 2,000 lines, and are left to their pages.
   */
  redirectsLeft?: number;
  /** Whether the site's Google Fonts were copied into it (`selfHostFonts()`), or left to Google since it couldn't be reached. */
  fonts?: SelfHostedResult;
  /** Where search engines look for `robots.txt`, for a site in a subfolder, where the one the build writes isn't read. */
  robotsElsewhere?: string;
  /** The sitemap's address, for a site with its address set. */
  sitemap?: string;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
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
    const { config, renderPage, describe, admin: adminSite } = await loadServerEntry(server);
    const base = normalizeBase(options.base ?? config.base);
    // The site as visitors see it now: pages and items scheduled for later, or hidden again, are left out.
    const now = new Date();
    // Rendering pages reports when what they show by today's date changes, for the build record.
    resetDateChanges();
    const loaded = await loadSiteContent(fileSystemSource(root));
    const content = shownContent(loaded, now);
    const styles = await writeStylesEntries(root, config);
    const withAdmin = Boolean(config.backend || config.demo);

    // Build the CSS (Tailwind scans content/ for class names), the admin panel if the site has
    // a backend or is a demo, the Client Components if it has any, and copy public/ into the output.
    const input: Record<string, string> = { styles: styles.site };
    if (withAdmin) Object.assign(input, { preview: styles.preview, admin: ADMIN_ENTRY });
    if (modules.size > 0) input.islands = ISLANDS_ENTRY;
    const viteConfig = baseViteConfig(root, configFile, modules);
    const site = adminSite();
    const entries = adminEntryPlugin(configFile, { mode: "build", site });
    await viteBuild({
      ...viteConfig,
      plugins: [...(viteConfig.plugins ?? []), entries],
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
      const { url } = await buildEditor(viteConfig, entries, { base, outDir });
      const html = adminHtml({
        scripts: [`${base}${admin.file}`],
        stylesheets: cssFiles(manifest, "admin").map((file) => `${base}${file}`),
        settings: {
          previewStylesheets: cssFiles(manifest, "preview").map((file) => `${base}${file}`),
          siteUrl: base,
          site,
          frames: { url },
        },
        ...(content.settings.favicon && { icon: withBase(content.settings.favicon, base) }),
      });
      await mkdir(join(outDir, "admin"), { recursive: true });
      await writeFile(join(outDir, "admin/index.html"), html);
      // A demo's admin panel starts from a copy of the site's content, since visitors don't sign in.
      if (config.demo) await writeFile(join(outDir, DEMO_CONTENT_PATH), await demoContent(fileSystemSource(root)));
    }

    // What tools that edit the site without its code, such as the Claude connector, need to know about its blocks.
    await writeFile(join(outDir, SITE_DESCRIPTION_PATH), `${JSON.stringify(describe(), null, 2)}\n`);

    const today = todayIn(content.settings.timeZone);
    const pages = sitePages(content, today, config.blocks);
    const written: string[] = [];
    const built: BuiltPage[] = [];
    for (const page of pages) {
      const html = applyBasePath(await renderPage(content, page, { stylesheets, ...(islands && { islands }) }), base);
      built.push({ path: page.path, file: page.file, html });
      const file = join(outDir, pageOutputFile(page.path));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      written.push(relative(root, file).split("\\").join("/"));
    }

    // Calendar files of collections of events, for subscribing and for adding events to calendars, and feeds.
    for (const file of [...calendarFiles(content), ...feedFiles(content)]) {
      const target = join(outDir, file.path.slice(1));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
    }

    // A page at each old address that sends visitors on. Pages, and files in public/, win over redirects.
    const redirected: Redirect[] = [];
    for (const file of redirectFiles(content, { taken: pages.map((page) => page.path), base })) {
      const target = join(outDir, file.path.slice(1));
      if (await exists(target)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
      redirected.push(file);
    }
    // And the same redirects for Cloudflare Pages, which sends them itself, unless the site has its own file.
    const cloudflare = cloudflareRedirects(redirected, base);
    const redirectsTarget = join(outDir, CLOUDFLARE_REDIRECTS_PATH.slice(1));
    if (cloudflare.file && !(await exists(redirectsTarget))) await writeFile(redirectsTarget, cloudflare.file.content);

    const { url } = content.settings;
    if (url) {
      // Pages hidden from search engines, and "Page not found", aren't in the sitemap. Translations list each other.
      const listed = sitemapPages(content, pages);
      const urls = listed.map(({ url: loc, alternates }) => {
        const links = Object.entries(alternates ?? {}).map(
          ([language, href]) =>
            `<xhtml:link rel="alternate" hreflang="${escapeXml(language)}" href="${escapeXml(href)}"/>`,
        );
        return `  <url><loc>${escapeXml(loc)}</loc>${links.join("")}</url>`;
      });
      const namespaces = listed.some((page) => page.alternates)
        ? ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
        : ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
      await writeFile(
        join(outDir, "sitemap.xml"),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset${namespaces}>\n${urls.join("\n")}\n</urlset>\n`,
      );
      await writeFile(
        join(outDir, "robots.txt"),
        `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl(url, "/sitemap.xml")}\n`,
      );
    }

    // The site's own copy of its fonts, once every page is written, so visitors' browsers don't ask Google for them.
    const fonts = await selfHostFonts(outDir, content.settings.theme, { base });
    const robotsElsewhere = rootRobotsUrl(url);

    // What the site was built from, and when it stops being current, for the nightly check.
    const record = await writeBuildRecord(outDir, { root, content: loaded, now });

    // Last, once every page is written: the index is made from the finished HTML.
    const searchIndexed = await writeSearchIndex(outDir);
    // Then, for a site with an admin address, every page starts with the script that keeps site pages off it.
    if (config.admin) {
      await guardBuiltSite(outDir, { admin: config.admin, siteUrl: content.settings.url, base, broker: config.broker });
    }
    const media = (await fileSystemSource(root).list(MEDIA_DIR)).map(
      (path) => `/media/${path.slice(MEDIA_DIR.length + 1)}`,
    );
    // The site checks, then what checking the built pages finds, such as images without alt text. The site
    // checks check the site as it's written, so links to pages that aren't shown yet aren't errors.
    const problems = [...checkSite(loaded, { media, blocks: config.blocks, today }), ...(await checkBuiltPages(built))];
    const [nextChange] = upcomingChanges(loaded, now);
    return {
      outDir,
      pages: written,
      ...(searchIndexed !== undefined && { searchIndexed }),
      problems,
      ...(nextChange && { nextChange }),
      ...(record.currentUntil && { currentUntil: record.currentUntil }),
      ...(cloudflare.left > 0 && { redirectsLeft: cloudflare.left }),
      ...(fonts && { fonts }),
      ...(robotsElsewhere && { robotsElsewhere }),
      ...(url && { sitemap: absoluteUrl(url, "/sitemap.xml") }),
    };
  } finally {
    await server.close();
  }
}
