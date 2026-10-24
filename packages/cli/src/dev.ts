import { type FSWatcher, realpathSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import {
  CONTENT_DIR,
  ContentError,
  findRedirect,
  findSitePage,
  loadSiteContent,
  MEDIA_DIR,
  redirectPage,
  SITE_DESCRIPTION_PATH,
  shownContent,
  todayIn,
} from "@goodfellow-cms/core";
import {
  fileSystemSource,
  handleDevApi,
  localFileStore,
  localRegistryDir,
  sendBuildFile,
} from "@goodfellow-cms/core/node";
import react from "@vitejs/plugin-react";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import {
  ADMIN_ENTRY,
  adminEntryPlugin,
  adminHtml,
  DEV_ADMIN_SITE_PATH,
  EDITOR_PATH,
  EDITOR_REBUILT_EVENT,
} from "./admin-entry.js";
import { buildEditor } from "./editor-bundle.js";
import { type ClientModules, ISLANDS_DEV_URL } from "./islands.js";
import {
  baseViteConfig,
  devUrl,
  findConfigFile,
  loadServerEntry,
  type StylesEntries,
  writeStylesEntries,
} from "./site.js";

export interface DevOptions {
  root?: string;
  port?: number;
}

const CONTENT_CHANGED = "goodfellow:content-changed";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function errorPage(title: string, lines: string[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:48rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1 style="color:#b91c1c">${escapeHtml(title)}</h1><ul>${lines.map((line) => `<li><code>${escapeHtml(line)}</code></li>`).join("")}</ul>
</body></html>`;
}

/** Reloads site pages when content changes on disk. The admin panel doesn't listen, so saving never reloads the editor. */
const RELOAD_ON_CONTENT_CHANGE = `<script type="module">
import { createHotContext } from "/@vite/client";
createHotContext("/__goodfellow/reload").on("${CONTENT_CHANGED}", () => location.reload());
</script>`;

/**
 * Tells site pages to reload when content changes, after making Vite recompile
 * the site's CSS (Tailwind scans content/ for class names).
 *
 * content/ is hidden from Vite's own watcher on purpose: Tailwind's Vite plugin
 * reloads every open page when a file it scans changes, which would reload the
 * admin panel (and lose the editor's state) each time it publishes.
 */
function watchContent(server: ViteDevServer, root: string, styles: () => StylesEntries): void {
  const dir = join(root, CONTENT_DIR);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: FSWatcher | undefined;
  let closed = false;

  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const { moduleGraph } = server.environments.client;
      for (const entry of [styles().site, styles().preview]) {
        for (const module of moduleGraph.getModulesByFile(entry) ?? []) moduleGraph.invalidateModule(module);
      }
      server.environments.client.hot.send({ type: "custom", event: CONTENT_CHANGED });
    }, 50);
  };

  // Watching breaks if folders are deleted while it scans them (for example when
  // content/ is replaced wholesale), so start again whenever it fails.
  const start = () => {
    if (closed) return;
    try {
      watcher = watch(dir, { recursive: true }, changed);
      watcher.on("error", () => {
        watcher?.close();
        changed();
        setTimeout(start, 250);
      });
    } catch {
      setTimeout(start, 250);
    }
  };
  start();

  server.httpServer?.once("close", () => {
    closed = true;
    clearTimeout(timer);
    watcher?.close();
  });
}

/** Globs for a folder and, if it's a link, the folder it links to. */
function watchedPaths(dir: string): string[] {
  const real = (() => {
    try {
      return realpathSync(dir);
    } catch {
      return dir;
    }
  })();
  return [...new Set([dir, real])].map((path) => `${path}/**`);
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
};

/**
 * Serves `public/media/` straight from disk. Vite serves `public/` from a list
 * it keeps as files change, which misses files when the folder itself is
 * replaced (such as by switching branches), and uploads must show up at once.
 */
function serveMedia(root: string) {
  const dir = resolve(root, MEDIA_DIR);
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith("/media/")) return next();
    let file: string;
    try {
      file = resolve(dir, decodeURIComponent(pathname.slice("/media/".length)));
    } catch {
      return next();
    }
    if (!file.startsWith(`${dir}${sep}`)) return next();
    try {
      const data = await readFile(file);
      const extension = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
      res.setHeader("Content-Type", MEDIA_TYPES[extension] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      next();
    }
  };
}

/** How long the editor's frames stay as built before the admin panel reloads them. */
const REBUILT_DELAY = 300;

/** The editor's frames' bundle, which `goodfellow dev` rebuilds as the site's code changes. */
interface DevEditor {
  outDir: string;
  /** Settles once the first build has finished, whether or not it worked. */
  ready: Promise<void>;
}

const EDITOR_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  woff: "font/woff",
  woff2: "font/woff2",
};

/**
 * Serves the editor's frames from their bundle, as `goodfellow build` writes
 * it: a classic script, which a frame sandboxed with `allow-scripts` alone can
 * load without the server letting other websites' sandboxed frames read it.
 */
function serveEditor(editor: DevEditor) {
  const prefix = `/${EDITOR_PATH}`;
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!pathname.startsWith(prefix)) return next();
    await editor.ready;
    let file: string;
    try {
      file = resolve(
        editor.outDir,
        decodeURIComponent(pathname === prefix ? `${prefix}index.html` : pathname).slice(1),
      );
    } catch {
      return next();
    }
    if (!file.startsWith(`${editor.outDir}${sep}`)) return next();
    try {
      const data = await readFile(file);
      res.setHeader("Content-Type", EDITOR_TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      next();
    }
  };
}

/** Serves the local backend's API, the admin panel at /admin, and pages rendered on request from the files on disk. */
function devPlugin(root: string, styles: () => StylesEntries, editor: DevEditor): Plugin {
  const store = localFileStore(root);
  const registryDir = localRegistryDir(root);
  return {
    name: "goodfellow:dev",
    configureServer(server: ViteDevServer) {
      watchContent(server, root, styles);
      server.middlewares.use(serveMedia(root));
      server.middlewares.use(serveEditor(editor));

      // Runs after Vite's own middleware, so modules, assets and public/ files are served first.
      return () => {
        server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.url === DEV_ADMIN_SITE_PATH) {
            const { admin } = await loadServerEntry(server);
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-cache");
            res.end(JSON.stringify(admin()));
            return;
          }
          if (await handleDevApi(store, req, res, { registryDir })) return;
          if (req.method !== "GET" && req.method !== "HEAD") return next();
          const url = new URL(req.url ?? "/", "http://localhost");

          res.setHeader("Content-Type", "text/html; charset=utf-8");
          if (url.pathname === "/admin" || url.pathname === "/admin/") {
            // Content with a problem still opens the admin panel, which explains it.
            const icon = await loadSiteContent(fileSystemSource(root)).then(
              (content) => content.settings.favicon,
              () => undefined,
            );
            const html = adminHtml({ scripts: [`/@id/__x00__${ADMIN_ENTRY}`], ...(icon && { icon }) });
            res.end(await server.transformIndexHtml("/admin", html));
            return;
          }
          if (url.pathname === `/${SITE_DESCRIPTION_PATH}`) {
            const { describe } = await loadServerEntry(server);
            res.setHeader("Content-Type", "application/json");
            res.setHeader("Cache-Control", "no-cache");
            res.end(JSON.stringify(describe(), null, 2));
            return;
          }
          // Calendar files and feeds, as builds write them, from the content as it is now.
          if (await sendBuildFile(fileSystemSource(root), url.pathname, res).catch(() => false)) return;
          if (/\.[a-z0-9]+$/i.test(url.pathname)) {
            // Old addresses such as /news.html send visitors on, as the built site's pages there do.
            const content = await loadSiteContent(fileSystemSource(root)).then(shownContent, () => undefined);
            const redirect = content && findRedirect(content, url.pathname);
            if (content && redirect) return void res.end(redirectPage(content, redirect.to));
            return next();
          }

          try {
            // As a build now would show the site: pages and items scheduled for later are left out.
            const content = shownContent(await loadSiteContent(fileSystemSource(root)));
            const { config, renderPage } = await loadServerEntry(server);
            const match = findSitePage(content, todayIn(content.settings.timeZone), config.blocks, url.pathname);
            // Pages win over redirects, as in builds.
            const redirect = (!match || match.status === 404) && findRedirect(content, url.pathname);
            if (redirect) {
              res.end(redirectPage(content, redirect.to));
              return;
            }
            if (!match) {
              res.statusCode = 404;
              res.end(errorPage("Page not found", [`No page is stored for ${url.pathname}.`]));
              return;
            }
            const html = await renderPage(content, match.page, {
              stylesheets: [`${devUrl(root, styles().site)}?direct`],
              islands: { script: ISLANDS_DEV_URL },
            });
            res.statusCode = match.status;
            if (match.status === 404) {
              // Says which address wasn't found, since the site's own "not found" page doesn't.
              server.config.logger.warn(`Page not found: ${JSON.stringify(url.pathname)}`, { timestamp: true });
            }
            const transformed = await server.transformIndexHtml(url.pathname, html);
            res.end(transformed.replace("</body>", `${RELOAD_ON_CONTENT_CHANGE}</body>`));
          } catch (error) {
            res.statusCode = 500;
            if (error instanceof ContentError) {
              res.end(
                errorPage(
                  "Some content files have problems",
                  error.problems.map((p) => `${p.file}: ${p.message}`),
                ),
              );
            } else {
              const err = error as Error;
              server.ssrFixStacktrace(err);
              res.end(errorPage("The page couldn't be rendered", [err.stack ?? err.message]));
            }
          }
        });
      };
    },
  };
}

/** Starts the development server, with the admin panel at /admin. Resolves once it's listening. */
export async function dev(options: DevOptions = {}): Promise<ViteDevServer> {
  const root = resolve(options.root ?? ".");
  const configFile = findConfigFile(root);
  let styles: StylesEntries | undefined;
  const getStyles = () => {
    if (!styles) throw new Error("The development server isn't ready yet.");
    return styles;
  };

  const modules: ClientModules = new Map();
  const base = baseViteConfig(root, configFile, modules);

  // The editor's frames are bundled as builds bundle them, and rebuilt as the site's code changes.
  let server: ViteDevServer | undefined;
  let built: () => void = () => {};
  let builds = 0;
  let reload: ReturnType<typeof setTimeout> | undefined;
  const editor: DevEditor = {
    outDir: join(root, "node_modules/.goodfellow/editor"),
    ready: new Promise<void>((resolve) => {
      built = resolve;
    }),
  };
  const bundle = await buildEditor(base, adminEntryPlugin(configFile, { mode: "dev", previewStylesheet: "" }), {
    base: "/",
    outDir: editor.outDir,
    watch: {
      onStart() {
        clearTimeout(reload);
      },
      onBuilt(error) {
        builds += 1;
        built();
        if (error) server?.config.logger.error(`The editor's frames couldn't be built: ${error.message}`);
        // A change such as adding a block writes several files, which can take several builds: the frames
        // reload once, after the last.
        else if (builds > 1) {
          reload = setTimeout(() => server?.ws.send({ type: "custom", event: EDITOR_REBUILT_EVENT }), REBUILT_DELAY);
        }
      },
    },
  });

  server = await createServer({
    ...base,
    appType: "custom",
    logLevel: "info",
    server: {
      port: options.port ?? 4321,
      strictPort: options.port !== undefined,
      // content/ is watched separately by watchContent(), and media is served by serveMedia(). Vite
      // mustn't watch either: Tailwind's plugin reloads every open page when a file it scans changes,
      // which would reload the admin panel in the middle of publishing.
      // Where content kept in a repository of its own is linked in (`goodfellow content link`), Vite sees the
      // repository's own folders too.
      watch: { ignored: [CONTENT_DIR, MEDIA_DIR].flatMap((dir) => watchedPaths(join(root, dir))) },
    },
    // Finds the packages the site's blocks use in the browser when the server starts, rather than when a page with
    // Client Components first loads them, which reloads the page. The admin panel's WordPress import loads its HTML
    // parser only when it's opened, which would reload it in the middle of an import.
    optimizeDeps: { entries: [configFile], include: ["react-dom/client", "@goodfellow-cms/core > htmlparser2"] },
    plugins: [
      react(),
      ...(base.plugins ?? []),
      adminEntryPlugin(configFile, {
        mode: "dev",
        get previewStylesheet() {
          return `${devUrl(root, getStyles().preview)}?direct`;
        },
      }),
      devPlugin(root, getStyles, editor),
    ],
  });
  const closeServer = server.close.bind(server);
  server.close = async () => {
    await bundle.close();
    await closeServer();
  };

  const { config } = await loadServerEntry(server);
  styles = await writeStylesEntries(root, config);
  await server.listen();
  server.printUrls();
  server.config.logger.info(`  ➜  Admin:   ${server.resolvedUrls?.local[0] ?? "/"}admin`);
  return server;
}
