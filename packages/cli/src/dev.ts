import { type FSWatcher, watch } from "node:fs";
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
  todayIn,
} from "@goodfellow-cms/core";
import {
  fileSystemSource,
  handleDevApi,
  localFileStore,
  localRegistryDir,
  sendCalendarFile,
} from "@goodfellow-cms/core/node";
import react from "@vitejs/plugin-react";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { ADMIN_ENTRY, adminEntryPlugin, adminHtml } from "./admin-entry.js";
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

/** Serves the local backend's API, the admin panel at /admin, and pages rendered on request from the files on disk. */
function devPlugin(root: string, styles: () => StylesEntries): Plugin {
  const store = localFileStore(root);
  const registryDir = localRegistryDir(root);
  return {
    name: "goodfellow:dev",
    configureServer(server: ViteDevServer) {
      watchContent(server, root, styles);
      server.middlewares.use(serveMedia(root));

      // Runs after Vite's own middleware, so modules, assets and public/ files are served first.
      return () => {
        server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
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
          // Calendar files, as builds write them, from the content as it is now.
          if (await sendCalendarFile(fileSystemSource(root), url.pathname, res).catch(() => false)) return;
          if (/\.[a-z0-9]+$/i.test(url.pathname)) {
            // Old addresses such as /news.html send visitors on, as the built site's pages there do.
            const content = await loadSiteContent(fileSystemSource(root)).catch(() => undefined);
            const redirect = content && findRedirect(content, url.pathname);
            if (content && redirect) return void res.end(redirectPage(content, redirect.to));
            return next();
          }

          try {
            const content = await loadSiteContent(fileSystemSource(root));
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
  const server = await createServer({
    ...base,
    appType: "custom",
    logLevel: "info",
    server: {
      port: options.port ?? 4321,
      strictPort: options.port !== undefined,
      // content/ is watched separately by watchContent(), and media is served by serveMedia(). Vite
      // mustn't watch either: Tailwind's plugin reloads every open page when a file it scans changes,
      // which would reload the admin panel in the middle of publishing.
      watch: { ignored: [`${join(root, CONTENT_DIR)}/**`, `${join(root, MEDIA_DIR)}/**`] },
    },
    // Finds the packages the site's blocks use in the browser when the server starts, rather than when a page with
    // Client Components first loads them, which reloads the page.
    optimizeDeps: { entries: [configFile], include: ["react-dom/client"] },
    plugins: [
      react(),
      ...(base.plugins ?? []),
      adminEntryPlugin(configFile, {
        mode: "dev",
        get previewStylesheet() {
          return `${devUrl(root, getStyles().preview)}?direct`;
        },
      }),
      devPlugin(root, getStyles),
    ],
  });

  const { config } = await loadServerEntry(server);
  styles = await writeStylesEntries(root, config);
  await server.listen();
  server.printUrls();
  server.config.logger.info(`  ➜  Admin:   ${server.resolvedUrls?.local[0] ?? "/"}admin`);
  return server;
}
