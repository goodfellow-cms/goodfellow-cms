import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import {
  allPages,
  CALENDARS_DIR,
  loadSiteContent,
  normalizeBase,
  redirectFrom,
  redirectProblems,
} from "@goodfellow-cms/core";
import {
  DEV_API_PREFIX,
  fileSystemSource,
  handleDevApi,
  isLocalOrigin,
  localFileStore,
  localRegistryDir,
} from "@goodfellow-cms/core/node";
import type { NextConfig } from "next";

export interface GoodfellowNextOptions {
  /** The site's folder, holding `content/` and `public/media/`. Defaults to the folder Next.js runs in. */
  root?: string;
  /**
   * For a full-stack site, with a server of its own: builds it for `next start`
   * or a host that runs Next.js, rather than as static files, and includes
   * `content/` and `public/media/` with its server, which reads them for pages
   * built on request and calendar files.
   */
  server?: boolean;
}

type Rewrites = Awaited<ReturnType<NonNullable<NextConfig["rewrites"]>>>;
type Redirects = Awaited<ReturnType<NonNullable<NextConfig["redirects"]>>>;
type Rewrite = Extract<Rewrites, unknown[]>[number];

/** `PHASE_DEVELOPMENT_SERVER` from `next/constants`, which Node can't import by that name. */
const PHASE_DEVELOPMENT_SERVER = "phase-development-server";

const SERVER_KEY = Symbol.for("goodfellow.next.devApi");

/**
 * The admin panel's local backend, which reads and writes the site's files on
 * disk. It runs beside `next dev`, on this computer only, and Next.js passes
 * the admin panel's requests to it. Started once however often Next.js loads its config.
 */
function startDevApi(root: string): Promise<number> {
  const globals = globalThis as { [SERVER_KEY]?: Promise<number> };
  globals[SERVER_KEY] ??= new Promise((resolvePort, reject) => {
    const store = localFileStore(root);
    const registryDir = localRegistryDir(root);
    const server = createServer(async (req, res) => {
      // Requests come through Next.js's development server, so they're from its address rather than this one's.
      if (!(await handleDevApi(store, req, res, { trustOrigin: isLocalOrigin, registryDir }))) {
        res.writeHead(404).end();
      }
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePort((server.address() as AddressInfo).port));
    // Never keeps Next.js running on its own.
    server.unref();
  });
  return globals[SERVER_KEY];
}

/** Adds a rewrite ahead of the site's own, whichever form the site's rewrites take. */
function withRewrite(rewrites: Rewrites | undefined, rewrite: Rewrite): Rewrites {
  if (!rewrites) return [rewrite];
  if (Array.isArray(rewrites)) return [rewrite, ...rewrites];
  return { ...rewrites, beforeFiles: [rewrite, ...(rewrites.beforeFiles ?? [])] };
}

/** Next.js's form of a base path: `/my-site`, or empty for the root. */
function nextBasePath(base: string | undefined): string {
  return normalizeBase(base).slice(0, -1);
}

/**
 * Next.js only optimizes images with a server or a custom loader. Without a
 * loader, `next/image` serves images as they are, still with their sizes set.
 */
function imageSettings(images: NextConfig["images"]): NextConfig["images"] {
  if (images?.loader && images.loader !== "default") return images;
  if (images?.loaderFile) return images;
  return { unoptimized: true, ...images };
}

/** An address as Next.js matches a redirect's source, with the characters its patterns use escaped. */
function redirectSource(path: string): string {
  return encodeURI(path).replace(/[()[\]{}+*?:!]/g, "\\$&");
}

/**
 * The site's redirects (`content/redirects.json`) for hosts that send them
 * themselves, such as Vercel, which reads them from the build. Redirects from
 * an address a page or a collection's item has are left out, since pages win,
 * as they do over the pages `goodfellow-next finish` writes at old addresses.
 * Content with a problem gives none, and the build reports the problem.
 */
async function siteRedirects(root: string): Promise<Redirects> {
  const content = await loadSiteContent(fileSystemSource(root)).catch(() => undefined);
  if (!content?.redirects) return [];
  const taken = new Set(allPages(content).map((page) => page.path));
  const problems = redirectProblems(content.redirects);
  return content.redirects.flatMap((redirect, index) => {
    const from = redirectFrom(redirect.from);
    if (problems[index] || !from.ok || taken.has(from.path)) return [];
    return [{ source: redirectSource(from.path), destination: redirect.to.trim(), permanent: true }];
  });
}

/**
 * Sets up Next.js for a Goodfellow site, in `next.config.ts`:
 * `export default withGoodfellow({ ... })`.
 *
 * - Builds the site as static files (`output: "export"`), so any static host can serve it,
 *   with each page in its own folder (`trailingSlash: true`), as `goodfellow build` does.
 *   `next dev` serves pages as usual, so an unknown address shows the "not found" page.
 * - Serves the site from `basePath`, or else the `GOODFELLOW_BASE` environment
 *   variable, as `goodfellow build` does (GitHub Pages serves most sites from `/repository-name/`).
 * - Serves images as they are unless the site sets an image loader, since static files can't be optimized on request.
 * - Adds the site's redirects (Site Settings → Redirects) ahead of the site's own, for hosts that
 *   send them, such as Vercel. Others get the pages `goodfellow-next finish` writes at old addresses.
 * - With `{ server: true }`, builds a full-stack site for a server instead of as static
 *   files: see `goodfellowApi()` in `@goodfellow-cms/next/server`.
 * - In `next dev`, runs the admin panel's local backend, so publishing saves to
 *   the files on disk. It's never part of a build.
 * - In `next dev`, turns off React's debug channel (`experimental.reactDebugChannel`)
 *   unless the site sets it: with the header and footer in a layout, it made the
 *   browser's memory grow to gigabytes on every page, until pages crashed.
 */
export function withGoodfellow(nextConfig: NextConfig = {}, options: GoodfellowNextOptions = {}) {
  const root = resolve(options.root ?? process.cwd());
  const basePath = nextBasePath(nextConfig.basePath ?? process.env.GOODFELLOW_BASE);
  return async (phase: string): Promise<NextConfig> => {
    const config: NextConfig = {
      // Pages are folders (about/index.html), as `goodfellow build` writes them, so /admin/ works for GitLab sign-in.
      trailingSlash: true,
      ...nextConfig,
      ...(basePath && { basePath }),
      images: imageSettings(nextConfig.images),
      // Tells the site's pages and the admin panel where the site is served from.
      env: { ...nextConfig.env, GOODFELLOW_BASE_PATH: basePath },
    };
    // A server of its own: Next.js serves the redirects itself, and can optimize images.
    if (phase !== PHASE_DEVELOPMENT_SERVER && options.server) {
      return {
        ...config,
        images: nextConfig.images,
        outputFileTracingIncludes: {
          ...nextConfig.outputFileTracingIncludes,
          "/**": [...(nextConfig.outputFileTracingIncludes?.["/**"] ?? []), "./content/**/*", "./public/media/**/*"],
        },
        redirects: async () => [...(await siteRedirects(root)), ...((await nextConfig.redirects?.()) ?? [])],
      };
    }
    // In development, Next.js treats an unknown address in an exported site as an error rather than "not found".
    if (phase !== PHASE_DEVELOPMENT_SERVER) {
      return {
        output: "export",
        ...config,
        redirects: async () => [...(await siteRedirects(root)), ...((await nextConfig.redirects?.()) ?? [])],
      };
    }

    const port = await startDevApi(root);
    const rewrite = {
      source: `${DEV_API_PREFIX}/:path*`,
      destination: `http://127.0.0.1:${port}${DEV_API_PREFIX}/:path*`,
    };
    // Calendar files, which `goodfellow-next finish` writes into the export, come from the local backend.
    const calendars = {
      source: `/${CALENDARS_DIR}/:file(.+\\.ics)`,
      destination: `http://127.0.0.1:${port}${DEV_API_PREFIX}/${CALENDARS_DIR}/:file`,
    };
    return {
      ...config,
      experimental: { reactDebugChannel: false, ...nextConfig.experimental },
      rewrites: async () => withRewrite(withRewrite(await nextConfig.rewrites?.(), calendars), rewrite),
    };
  };
}
