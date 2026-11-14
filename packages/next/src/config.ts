import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { type AddressInfo, connect } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  type AdminAddress,
  allPages,
  brokerOrigin,
  buildNotes,
  CALENDARS_DIR,
  type ContentSource,
  configAdmin,
  configBroker,
  editorPolicy,
  FEEDS_DIR,
  loadSiteContent,
  loadSourcedContent,
  mayBeUnreadPage,
  normalizeBase,
  redirectFrom,
  redirectProblems,
  SITE_FILE,
  shownContent,
  TRAILING_SLASH_VARIABLE,
  vercelAdminRedirects,
  vercelHeaders,
} from "@goodfellow-cms/core";
import {
  BUILD_DATES_DIR,
  BUILD_DATES_ENV,
  builtSiteSource,
  contentRepositoryProblem,
  DEV_API_PREFIX,
  fontStandIns,
  handleDevApi,
  hostFonts,
  isAllowedDevHost,
  isLocalOrigin,
  localFileStore,
  localRegistryDir,
} from "@goodfellow-cms/core/node";
import type { NextConfig } from "next";
import { EDITOR_FRAMES_PATH } from "./editor-frames-path.js";
import type { BuiltFontStandIns } from "./font-stand-ins.js";
import {
  DIST_DIR_RECORD,
  IMAGE_SIZES_ENV,
  IMAGE_SIZES_MARK,
  SITE_SERVING,
  type SiteServing,
} from "./image-sizes-mark.js";

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
type Headers = Awaited<ReturnType<NonNullable<NextConfig["headers"]>>>;

const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];

/** The config's admin address, from its line of its own, since Next.js's config can't load the site's. */
function siteAdmin(root: string): AdminAddress | undefined {
  const file = CONFIG_FILES.map((name) => join(root, name)).find((path) => existsSync(path));
  return file ? configAdmin(readFileSync(file, "utf8")) : undefined;
}

/**
 * The site's header rules, for hosts that read them from the build, such as
 * Vercel, as `goodfellow build`'s `_headers` does on Cloudflare Pages: the
 * media library's SVGs sandboxed, the admin panel unframed, and with an admin
 * address every page there sandboxed but the admin panel's own. Next.js adds the base path itself.
 */
function siteHeaders(root: string): Headers {
  const admin = siteAdmin(root);
  const file = CONFIG_FILES.map((name) => join(root, name)).find((path) => existsSync(path));
  const broker = brokerOrigin(file ? configBroker(readFileSync(file, "utf8")) : undefined);
  return vercelHeaders({ ...(admin && { admin }), ...(broker && { broker }) });
}
/**
 * A full-stack site's editor frames' rules, after `siteHeaders()`, whose
 * `Content-Security-Policy` for the frames they replace, since Next.js sends
 * the last rule's value of a header: the frames' own policy (`editorPolicy()`),
 * which their page in `public/` names no inline scripts for, and the frames' rule.
 */
function editorFramesHeaders(): Headers {
  return [
    {
      source: `/${EDITOR_FRAMES_PATH}:path*`,
      headers: [{ key: "Content-Security-Policy", value: `${editorPolicy()}; frame-ancestors 'self'` }],
    },
  ];
}

/**
 * The site's settings as builds read them (a copy's address included), from
 * `content/site.json` alone, so a problem in any other file, such as an item
 * file left in a sourced collection's folder, never stops what needs only the
 * settings: the build reports it where it reads the rest.
 */
async function builtSettings(root: string) {
  const files = builtSiteSource(root);
  const settingsOnly: ContentSource = {
    read: (path) => (path === SITE_FILE ? files.read(path) : Promise.resolve(undefined)),
    list: async () => [],
  };
  return (await loadSiteContent(settingsOnly)).settings;
}

/**
 * A full-stack site's Google Fonts, copied into its `public/` folder
 * (`hostFonts()`), or `undefined` where it has none or Google can't be
 * reached, which the build says, as `goodfellow build` does.
 */
async function hostSiteFonts(root: string) {
  const settings = await builtSettings(root);
  const fonts = await hostFonts(join(root, "public"), settings.theme);
  if (!fonts) return undefined;
  if ("unavailable" in fonts) {
    for (const line of buildNotes({ fonts })) console.warn(line);
    return undefined;
  }
  return fonts;
}
/**
 * The theme's font stand-ins, worked out with Fontaine where the build runs, in
 * Node, for the pages' renderer, which reads them from the env.
 */
async function builtFontStandIns(root: string): Promise<BuiltFontStandIns> {
  const { theme } = await builtSettings(root);
  const { heading, body } = theme.fonts;
  return { ...(heading && { heading }), ...(body && { body }), standIns: await fontStandIns(theme, { root }) };
}

type Rewrite = Extract<Rewrites, unknown[]>[number];

/** `PHASE_DEVELOPMENT_SERVER` from `next/constants`, which Node can't import by that name. */
const PHASE_DEVELOPMENT_SERVER = "phase-development-server";
const PHASE_PRODUCTION_BUILD = "phase-production-build";

const SERVER_KEY = Symbol.for("goodfellow.next.devApi");

/** What to run instead, where `next dev` answers other computers. */
const EXPOSED_MESSAGE =
  "next dev is answering other computers on the network, so the admin panel's local backend is turned off: anyone on the network could change the site's files through it. Run next dev -H 127.0.0.1, as the starters' dev script does.";

/** Link-local IPv6 addresses, `fe80::/10`, which are connected to only through a named interface. */
const LINK_LOCAL = /^fe[89ab]/i;

/**
 * The addresses other computers could reach this one at, as `connect()` takes
 * them: every interface's but this computer's own, with link-local IPv6 ones
 * (`fe80::/10`) naming their interface, as they must to be connected to, by
 * its number, which every platform reads.
 */
export function networkAddresses(interfaces: Record<string, NetworkInterfaceInfo[] | undefined>): string[] {
  return Object.entries(interfaces).flatMap(([name, infos]) =>
    (infos ?? [])
      .filter((info) => !info.internal)
      .map((info) =>
        info.family === "IPv6" && LINK_LOCAL.test(info.address)
          ? `${info.address}%${info.scopeid ?? name}`
          : info.address,
      ),
  );
}

/**
 * Whether Next.js's development server, at `port`, answers on this computer's
 * network addresses, as `next dev` does unless it's started with `-H`. Next.js
 * passes on every header a client sends as it is, so the local backend can't
 * tell another computer's requests from this one's: it's safe only while
 * Next.js answers this computer alone.
 */
export async function answersNetwork(
  port: number,
  addresses = networkAddresses(networkInterfaces()),
): Promise<boolean> {
  const answers = await Promise.all(
    addresses.map(
      (host) =>
        new Promise<boolean>((resolveAnswer) => {
          const socket = connect({ host, port, timeout: 1000 });
          const done = (answered: boolean) => {
            socket.destroy();
            resolveAnswer(answered);
          };
          socket.once("connect", () => done(true));
          socket.once("error", () => done(false));
          socket.once("timeout", () => done(false));
        }),
    ),
  );
  return answers.some(Boolean);
}

/**
 * Whether `next dev` answers other computers, asked again whenever this
 * computer's network addresses change, such as when it joins a network after
 * the first request, until the answer is yes, which holds until `next dev`
 * starts again, since the addresses it listens on don't change.
 */
export function exposureCheck(
  port: number,
  { probe = answersNetwork, interfaces = networkInterfaces } = {},
): () => Promise<boolean> {
  let checked: { addresses: string; exposed: Promise<boolean> } | undefined;
  return async () => {
    const addresses = networkAddresses(interfaces());
    const key = addresses.join(" ");
    while (checked && checked.addresses !== key) {
      const previous = checked;
      if (await previous.exposed) return true;
      // One request asks for the new addresses: others that waited too take its answer, never one of their own.
      if (checked === previous) checked = { addresses: key, exposed: probe(port, addresses) };
    }
    checked ??= { addresses: key, exposed: probe(port, addresses) };
    return checked.exposed;
  };
}

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
    // The editor's frames, bundled here, since Next.js refuses its own files to sandboxed frames.
    // If it can't start, the rest of the local backend still works, and says why the editor doesn't.
    const editor = import("./dev-editor.js")
      .then(({ startDevEditor }) => startDevEditor(root))
      .catch((error: Error) => {
        console.error(`The editor's frames can't be served: ${error.message}`);
        return { serve: async () => false };
      });
    // Plugins' tasks, from the config as it is when each runs, loaded only then.
    const tasks = {
      root,
      plugins: async () => (await (await import("./plugins.js")).loadSiteConfig(root)).plugins ?? [],
      server: "next-dev" as const,
    };
    // Calendar files and feeds, with the collections' sources read in, from the config and modules as they are now.
    const load = async (files: ContentSource) => {
      const { readCollectionSources } = await import("./plugins.js");
      return loadSourcedContent(files, readCollectionSources(root));
    };
    // Asked once Next.js is answering, at the first request, which comes through it, and again after.
    const exposed = exposureCheck(Number(process.env.PORT) || 3000);
    let said = false;
    const server = createServer(async (req, res) => {
      if (await exposed()) {
        if (!said) console.error(EXPOSED_MESSAGE);
        said = true;
        res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: EXPOSED_MESSAGE }));
        return;
      }
      // A website can point its own name at this computer, so nothing here, the frames' bundle of the site's
      // config included, answers a request for any other name. Next.js passes requests on with this server's
      // own name, and the one the browser asked for as `x-forwarded-host`, so both must be this computer's.
      const forwarded = req.headers["x-forwarded-host"];
      if (!isAllowedDevHost(req.headers.host) || (forwarded !== undefined && !isAllowedDevHost(String(forwarded)))) {
        res.writeHead(403).end();
        return;
      }
      if (await (await editor).serve(req, res)) return;
      // Requests come through Next.js's development server, so they're from its address rather than this one's.
      if (!(await handleDevApi(store, req, res, { trustOrigin: isLocalOrigin, registryDir, tasks, load }))) {
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
  return encodeURI(path).replace(/[\\()[\]{}+*?:!]/g, "\\$&");
}

/**
 * A redirect's target as Next.js's destination: Next.js reads `:name`, `*`,
 * `+`, `(`, `)`, `{`, and `}` in its path and hash as a pattern, which would
 * fail the build (`/a/:b` names a value the source doesn't have), so they're
 * percent-encoded there, which browsers and servers read as the same address.
 * Next.js escapes its query values itself.
 */
export function redirectDestination(to: string): string {
  const target = to.trim();
  const origin = /^https:\/\/[^/?#]*/i.exec(target)?.[0] ?? "";
  const rest = target.slice(origin.length);
  const query = rest.indexOf("?");
  const hash = rest.indexOf("#");
  const encode = (part: string) =>
    part.replace(/[:*+(){}]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const pathEnd = [query, hash].filter((index) => index >= 0).reduce((a, b) => Math.min(a, b), rest.length);
  const search = query >= 0 && (hash < 0 || query < hash) ? rest.slice(query, hash > query ? hash : undefined) : "";
  const fragment = hash >= 0 ? rest.slice(hash) : "";
  return `${origin}${encode(rest.slice(0, pathEnd))}${search}${encode(fragment)}`;
}

/**
 * The site's redirects (`content/redirects.json`) for hosts that send them
 * themselves, such as Vercel, which reads them from the build. Redirects from
 * an address a page or a collection's item has are left out, since pages win,
 * as they do over the pages `goodfellow-next finish` writes at old addresses.
 * So are redirects from an address a sourced collection's item could have,
 * since the items aren't known here: `finish`'s redirect pages still serve
 * those that no item has. Item files left in a sourced collection's folder
 * aren't read (`sourcedCollectionIds()`). Content with a problem gives none,
 * and the build reports the problem.
 */
async function siteRedirects(root: string): Promise<Redirects> {
  const { sourcedCollectionIds } = await import("./plugins.js");
  // The config is bundled to find its sources only where there are redirects to check against them.
  // Item files a source replaces may not load; then the config is read to leave them out, as below.
  const files = await loadSiteContent(builtSiteSource(root)).catch(() => undefined);
  if (files && !files.redirects?.length) return [];
  // A config that can't be loaded here is the build's to report; its redirects are read without it.
  const sourced = await sourcedCollectionIds(root).catch((): string[] => []);
  const content = await loadSiteContent(builtSiteSource(root), { sourced }).then(shownContent, () => undefined);
  if (!content?.redirects) return [];
  const taken = new Set(allPages(content).map((page) => page.path));
  const unread = new Set(sourced);
  const problems = redirectProblems(content.redirects);
  return content.redirects.flatMap((redirect, index) => {
    const from = redirectFrom(redirect.from);
    // A collection whose pattern is only its item's name doesn't take every redirect of one part: the redirect wins.
    const item = from.ok && mayBeUnreadPage(content, unread, from.path, { anyAddress: false });
    if (problems[index] || !from.ok || taken.has(from.path) || item) return [];
    return [{ source: redirectSource(from.path), destination: redirectDestination(redirect.to), permanent: true }];
  });
}

/**
 * Pages opened at the wrong one of the Site address and the admin address,
 * sent to the right one before anything loads, for hosts that send redirects,
 * such as Vercel (`vercelAdminRedirects()`). The Site address is
 * `content/site.json`'s own, never a copy's, which leaves the admin address
 * out. Their addresses already have the base path, so Next.js adds none.
 */
function adminRedirects(root: string, basePath: string): Redirects {
  const admin = siteAdmin(root);
  if (!admin) return [];
  let siteUrl: unknown;
  try {
    siteUrl = JSON.parse(readFileSync(join(root, "content/site.json"), "utf8")).url;
  } catch {
    return [];
  }
  return vercelAdminRedirects(admin, typeof siteUrl === "string" ? siteUrl : undefined, `${basePath}/`).map((rule) => ({
    ...rule,
    basePath: false as const,
  }));
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
 * - Adds header rules for hosts that send them, such as Vercel: the media library's SVGs
 *   sandboxed, the admin panel unframed, and, for a site with an admin address, every page
 *   there sandboxed but the admin panel's own, with redirects sending pages opened at the
 *   wrong one of the two addresses to the right one.
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
  const configFor = async (phase: string): Promise<NextConfig> => {
    // Content kept in a repository of its own has to be put in place before anything reads it.
    const problem = contentRepositoryProblem(root);
    if (problem) throw new Error(problem);
    const config: NextConfig = {
      // Pages are folders (about/index.html), as `goodfellow build` writes them, so /admin/ works for GitLab sign-in.
      trailingSlash: true,
      ...nextConfig,
      ...(basePath && { basePath }),
      images: imageSettings(nextConfig.images),
      // Tells the site's pages and the admin panel where the site is served from, and the pages how their full
      // addresses end, as Next.js serves them.
      env: {
        ...nextConfig.env,
        GOODFELLOW_BASE_PATH: basePath,
        [TRAILING_SLASH_VARIABLE]: String(nextConfig.trailingSlash ?? true),
      },
    };
    // Pages are rendered in several processes, which each write the dates what they show changes on for
    // `goodfellow-next finish`'s build record.
    if (phase === PHASE_PRODUCTION_BUILD) {
      // Where the build goes, for `goodfellow-next finish`, which reads what it wrote there.
      await mkdir(dirname(join(root, DIST_DIR_RECORD)), { recursive: true });
      await writeFile(join(root, DIST_DIR_RECORD), nextConfig.distDir ?? ".next");
      const dates = join(root, nextConfig.distDir ?? ".next", BUILD_DATES_DIR);
      await rm(dates, { recursive: true, force: true });
      process.env[BUILD_DATES_ENV] = dates;
      // Pages' renderer gets the theme's font stand-ins from the env, so the server's code never includes
      // Fontaine's measurements, the largest thing it would bundle.
      config.env = { ...config.env, GOODFELLOW_FONT_STAND_INS: JSON.stringify(await builtFontStandIns(root)) };
      // A static export whose images Next.js doesn't optimize lists the smaller copies `goodfellow-next finish`
      // writes, which the mark says to write.
      const mark = join(root, nextConfig.distDir ?? ".next", IMAGE_SIZES_MARK);
      await rm(mark, { force: true });
      if (!options.server && config.images?.unoptimized) {
        process.env[IMAGE_SIZES_ENV] = "1";
        await mkdir(dirname(mark), { recursive: true });
        await writeFile(mark, "");
      } else {
        delete process.env[IMAGE_SIZES_ENV];
      }
    }
    // A server of its own: Next.js serves the redirects itself, and can optimize images.
    if (phase !== PHASE_DEVELOPMENT_SERVER && options.server) {
      if (siteAdmin(root)) {
        throw new Error(
          "A full-stack site can't have an admin address: its admin panel signs in with the site's own sign-in.",
        );
      }
      // Next.js can't change pages once it has rendered them, so the fonts are copied into public/ first, and
      // where they are reaches the renderer through the env, which Next.js writes into its code for the server.
      const fonts = phase === PHASE_PRODUCTION_BUILD ? await hostSiteFonts(root) : undefined;
      return {
        ...config,
        ...(fonts && { env: { ...config.env, GOODFELLOW_FONTS: JSON.stringify(fonts) } }),
        images: nextConfig.images,
        outputFileTracingIncludes: {
          ...nextConfig.outputFileTracingIncludes,
          "/**": [...(nextConfig.outputFileTracingIncludes?.["/**"] ?? []), "./content/**/*", "./public/media/**/*"],
        },
        redirects: async () => [...(await siteRedirects(root)), ...((await nextConfig.redirects?.()) ?? [])],
        headers: async () => [
          ...siteHeaders(root),
          ...editorFramesHeaders(),
          ...((await nextConfig.headers?.()) ?? []),
        ],
      };
    }
    // In development, Next.js treats an unknown address in an exported site as an error rather than "not found".
    if (phase !== PHASE_DEVELOPMENT_SERVER) {
      return {
        output: "export",
        ...config,
        redirects: async () => [
          ...adminRedirects(root, basePath),
          ...(await siteRedirects(root)),
          ...((await nextConfig.redirects?.()) ?? []),
        ],
        // Only where they're sent, since Next.js warns that a static export can't send headers: on Vercel
        // (`VERCEL` is set where it builds), and for an admin address, which needs them.
        ...((siteAdmin(root) || process.env.VERCEL) && {
          headers: async () => [...siteHeaders(root), ...((await nextConfig.headers?.()) ?? [])],
        }),
      };
    }

    const port = await startDevApi(root);
    const rewrite = {
      source: `${DEV_API_PREFIX}/:path*`,
      destination: `http://127.0.0.1:${port}${DEV_API_PREFIX}/:path*`,
    };
    // Calendar files and feeds, which `goodfellow-next finish` writes into the export, come from the local backend,
    // in the site's other languages too (`/es/feeds/…`).
    const buildFiles = [
      { dir: CALENDARS_DIR, file: ":file(.+\\.ics)" },
      { dir: FEEDS_DIR, file: ":file(.+\\.rss|.+\\.atom)" },
    ].flatMap(({ dir, file }) => [
      { source: `/${dir}/${file}`, destination: `http://127.0.0.1:${port}${DEV_API_PREFIX}/${dir}/:file` },
      {
        source: `/:language([a-z0-9-]+)/${dir}/${file}`,
        destination: `http://127.0.0.1:${port}${DEV_API_PREFIX}/:language/${dir}/:file`,
      },
    ]);
    return {
      ...config,
      experimental: { reactDebugChannel: false, ...nextConfig.experimental },
      rewrites: async () => {
        let rewrites = await nextConfig.rewrites?.();
        for (const next of [...buildFiles, rewrite]) rewrites = withRewrite(rewrites, next);
        return rewrites ?? [];
      },
    };
  };
  // How the site is served, for `goodfellow-next finish`, which reads it from this file without building.
  const serving: SiteServing = { basePath, trailingSlash: nextConfig.trailingSlash ?? true };
  return Object.assign(configFor, { [SITE_SERVING]: serving });
}
