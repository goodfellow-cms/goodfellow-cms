import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  absoluteUrl,
  adminSiteForCopy,
  applyBasePath,
  CLOUDFLARE_REDIRECTS_PATH,
  calendarFiles,
  checkSite,
  cloudflareRedirects,
  DEMO_CONTENT_PATH,
  demoContent,
  describedForCopy,
  feedFiles,
  framedPlugins,
  IMAGE_WIDTHS,
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
  siteCopyFrom,
  sitemapPages,
  sitePages,
  todayIn,
  upcomingChanges,
  withBase,
} from "@goodfellow-cms/core";
import { type BuiltPage, checkBuiltPages } from "@goodfellow-cms/core/accessibility";
import {
  builtSiteSource,
  fileSystemSource,
  guardBuiltSite,
  type ImageSizesResult,
  readMediaSizes,
  runPluginBuildSteps,
  selfHostFonts,
  writeBuildRecord,
  writeImageSizes,
  writeSiteHeaders,
} from "@goodfellow-cms/core/node";
import { writeSearchIndex } from "@goodfellow-cms/core/search-index";
import { type Alias, createServer, type InlineConfig, build as viteBuild } from "vite";
import { ADMIN_ENTRY, adminEntryPlugin, adminHtml } from "./admin-entry.js";
import { buildEditor } from "./editor-bundle.js";
import { sharpResizer } from "./image-sizes.js";
import { type ClientModules, ISLANDS_ENTRY, needReact } from "./islands.js";
import { cssFiles, findEntry, type Manifest } from "./manifest.js";
import { buildPluginFrame } from "./plugin-frames.js";
import { preactAliases, preactIslands } from "./preact.js";
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
  /** The smaller copies of the media library's photos the build wrote, for pages' `srcset`. */
  images?: ImageSizesResult;
  /** The plugins' build steps that ran, as `plugin: step`. */
  pluginSteps?: string[];
  /**
   * What runs the site's Client Components in visitors' browsers: Preact,
   * where every one says it works with it and the config doesn't turn it off,
   * or else React, with the components that don't say so in `needReact`.
   * Absent for a site without any.
   */
  islands?: { runtime: "preact" } | { runtime: "react"; needReact: string[] };
  /** How many pages the content API has, at `/api/`, unless the config turns it off. */
  apiPages?: number;
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

  let stopPreact: (() => Promise<void>) | undefined;
  try {
    const { config, renderPage, describe, admin: adminSite, api } = await loadServerEntry(server);
    const base = normalizeBase(options.base ?? config.base);
    // Loading the config found the Client Components; they run with Preact where every one says it can.
    const needed = needReact(modules);
    const runtime =
      modules.size === 0
        ? undefined
        : config.preact === false || needed.length > 0
          ? ("react" as const)
          : ("preact" as const);
    if (runtime === "preact") stopPreact = await preactIslands(root, modules, server);
    // The site as visitors see it now: pages and items scheduled for later, or hidden again, are left out.
    const now = new Date();
    // Rendering pages reports when what they show by today's date changes, for the build record.
    resetDateChanges();
    const loaded = await loadSiteContent(builtSiteSource(root));
    const content = shownContent(loaded, now);
    const styles = await writeStylesEntries(root, config);
    const withAdmin = Boolean(config.backend || config.demo);

    // Build the CSS (Tailwind scans content/ for class names), the admin panel if the site has
    // a backend or is a demo, the Client Components if it has any, and copy public/ into the output.
    const input: Record<string, string> = { styles: styles.site };
    if (withAdmin) Object.assign(input, { preview: styles.preview, admin: ADMIN_ENTRY });
    // With Preact, the islands have a bundle of their own, whose React is Preact, unlike the admin panel's.
    if (runtime === "react") input.islands = ISLANDS_ENTRY;
    const viteConfig = baseViteConfig(root, configFile, modules);
    // A copy of the site, such as a staging site, says so to its admin panel, which stays at the copy's address.
    const copy = siteCopyFrom(process.env);
    const site = adminSiteForCopy(adminSite(), copy);
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

    if (runtime === "preact") {
      await viteBuild({
        ...viteConfig,
        resolve: { ...viteConfig.resolve, alias: [...aliasList(viteConfig.resolve?.alias), ...preactAliases()] },
        base,
        build: {
          outDir,
          emptyOutDir: false,
          manifest: ISLANDS_MANIFEST,
          rolldownOptions: {
            input: { islands: ISLANDS_ENTRY },
            onLog(level, log, handler) {
              if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
              handler(level, log);
            },
          },
        },
      });
    }

    const manifestPath = join(outDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    await rm(manifestPath);
    let islandsManifest = manifest;
    if (runtime === "preact") {
      const path = join(outDir, ISLANDS_MANIFEST);
      islandsManifest = JSON.parse(await readFile(path, "utf8")) as Manifest;
      await rm(path);
    }
    const stylesheets = cssFiles(manifest, "styles").map((file) => `/${file}`);
    const islandsEntry = findEntry(islandsManifest, "islands");
    // Root-relative like the stylesheets: applyBasePath() adds the base path to the finished pages.
    const islands = islandsEntry && {
      script: `/${islandsEntry.file}`,
      preload: importedFiles(islandsManifest, "islands").map((file) => `/${file}`),
      ...(base !== "/" && { base }),
    };

    if (withAdmin) {
      const admin = findEntry(manifest, "admin");
      if (!admin) throw new Error("The admin panel's bundle is missing from the build.");
      const { url } = await buildEditor(viteConfig, entries, { base, outDir });
      // Each plugin's admin module, in a frame of its own beside the editor's.
      for (const plugin of framedPlugins(config.plugins)) await buildPluginFrame(plugin, { root, base, outDir });
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
    await writeFile(
      join(outDir, SITE_DESCRIPTION_PATH),
      `${JSON.stringify(describedForCopy(describe(), copy), null, 2)}\n`,
    );

    const today = todayIn(content.settings.timeZone);
    const pages = sitePages(content, today, config.blocks);
    const written: string[] = [];
    const built: BuiltPage[] = [];
    // Images' sizes, and the widths the build makes smaller copies of photos at, which pages list in `srcset`.
    const imageOptions = { media: await readMediaSizes(root), imageWidths: IMAGE_WIDTHS };
    for (const page of pages) {
      const html = applyBasePath(
        await renderPage(content, page, { stylesheets, ...(islands && { islands }) }, imageOptions),
        base,
      );
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

    // The content API: the site's content as JSON, each page as it's shown, for apps and other sites.
    const apiFiles = await api(content, pages, { base });
    for (const file of apiFiles) {
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
    // Its header rules too, after the site's own: SVGs in the media library sandboxed, and the admin panel unframed.
    await writeSiteHeaders(outDir, {
      base,
      ...(site.admin && { admin: site.admin }),
      ...(config.broker && { broker: config.broker }),
    });

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

    // The smaller copies of the media library's photos that pages list.
    const images = await writeImageSizes(root, outDir, { resize: await sharpResizer() });

    // The site's own copy of its fonts, once every page is written, so visitors' browsers don't ask Google for them.
    const fonts = await selfHostFonts(outDir, content.settings.theme, { base });
    const robotsElsewhere = rootRobotsUrl(url);

    // Plugins' build steps, each in a process of its own held to what its plugin declared, once Goodfellow has
    // written everything but the record, the search index and the guards, which then cover what the steps wrote.
    const pluginSteps = (
      await runPluginBuildSteps({
        root,
        outDir,
        base,
        plugins: config.plugins ?? [],
        onStep: (step) => console.log(`Running ${step.title}, from ${step.plugin}…`),
      })
    ).map((step) => `${step.plugin}: ${step.title}`);

    // What the site was built from, and when it stops being current, for the nightly check.
    const record = await writeBuildRecord(outDir, { root, content: loaded, now });

    // Last, once every page is written: the index is made from the finished HTML.
    const searchIndexed = await writeSearchIndex(outDir);
    // Then, for a site with an admin address, every page starts with the script that keeps site pages off it.
    if (site.admin) {
      await guardBuiltSite(outDir, { admin: site.admin, siteUrl: content.settings.url, base, broker: config.broker });
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
      ...(images.written > 0 && { images }),
      ...(pluginSteps.length > 0 && { pluginSteps }),
      ...(runtime && {
        islands: runtime === "preact" ? { runtime } : { runtime, needReact: config.preact === false ? [] : needed },
      }),
      ...(apiFiles.length > 0 && { apiPages: pages.length }),
      ...(robotsElsewhere && { robotsElsewhere }),
      ...(url && { sitemap: absoluteUrl(url, "/sitemap.xml") }),
    };
  } finally {
    await stopPreact?.();
    await server.close();
  }
}

/** The manifest of the islands' own bundle, where they run with Preact, removed once it's read. */
const ISLANDS_MANIFEST = "islands-manifest.json";

/** Vite's aliases as a list, however the config gives them. */
function aliasList(alias: NonNullable<InlineConfig["resolve"]>["alias"]): Alias[] {
  if (!alias) return [];
  if (Array.isArray(alias)) return alias;
  return Object.entries(alias).map(([find, replacement]) => ({ find, replacement }));
}
