import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  absoluteUrl,
  allPages,
  CALENDARS_DIR,
  CLOUDFLARE_REDIRECTS_PATH,
  calendarFiles,
  cloudflareRedirects,
  EDITOR_PRELUDE,
  editorPolicy,
  FEEDS_DIR,
  feedFiles,
  hasLanguages,
  loadSiteContent,
  type Page,
  parseSiteDescription,
  pathLanguage,
  type Redirect,
  redirectFiles,
  rootRobotsUrl,
  type SelfHostedResult,
  SITE_DESCRIPTION_PATH,
  type SiteProblem,
  shownContent,
  siteLanguages,
} from "@goodfellow-cms/core";
import { checkBuiltPages } from "@goodfellow-cms/core/accessibility";
import {
  BUILD_DATES_DIR,
  fileSystemSource,
  guardBuiltSite,
  reportedDate,
  selfHostFonts,
  writeBuildRecord,
} from "@goodfellow-cms/core/node";

export { NEXT_SITE_FILES } from "./site-files.js";

/**
 * Writes the calendar files of the site's collections of events into the
 * export, as `goodfellow build` does: Next.js has no route for them. Returns
 * how many it wrote.
 */
export async function writeCalendarFiles(outDir: string, root = process.cwd()): Promise<number> {
  const files = calendarFiles(shownContent(await loadSiteContent(fileSystemSource(resolve(root)))));
  for (const file of files) {
    const target = join(outDir, file.path.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return files.length;
}

/**
 * Writes the feeds of the site's collections into the export, as `goodfellow
 * build` does. Returns how many it wrote: none without the site's address.
 */
export async function writeFeedFiles(outDir: string, root = process.cwd()): Promise<number> {
  const files = feedFiles(shownContent(await loadSiteContent(fileSystemSource(resolve(root)))));
  for (const file of files) {
    const target = join(outDir, file.path.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return files.length;
}

/**
 * The folders the calendar files and feeds go in: `calendars/` and `feeds/`,
 * and on a site in several languages, the same under each other language's
 * code, such as `es/feeds/`.
 */
export async function buildFileFolders(root = process.cwd()): Promise<string[]> {
  const { settings } = await loadSiteContent(fileSystemSource(resolve(root)));
  return siteLanguages(settings).flatMap((language) =>
    [CALENDARS_DIR, FEEDS_DIR].map((dir) => `${language.prefix.slice(1)}${language.prefix ? "/" : ""}${dir}`),
  );
}

/** The `basePath` the export was built with, which Next.js records in `.next/routes-manifest.json`. */
async function exportBasePath(root: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(root, ".next/routes-manifest.json"), "utf8")) as {
      basePath?: unknown;
    };
    return typeof manifest.basePath === "string" ? manifest.basePath : "";
  } catch {
    return "";
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** What `writeFontFiles()` did, for `buildNotes()`. */
export interface FontsWritten {
  fonts?: SelfHostedResult;
  robotsElsewhere?: string;
  sitemap?: string;
}

/**
 * Copies the site's Google Fonts into the export and points its pages at
 * them, as `goodfellow build` does (`selfHostFonts()`), with the export's base
 * path, and says where search engines read `robots.txt` for a site in a
 * subfolder (`rootRobotsUrl()`).
 */
export async function writeFontFiles(outDir: string, root = process.cwd()): Promise<FontsWritten> {
  const { settings } = await loadSiteContent(fileSystemSource(resolve(root)));
  const fonts = await selfHostFonts(outDir, settings.theme, { base: await exportBasePath(root) });
  const robotsElsewhere = rootRobotsUrl(settings.url);
  return {
    ...(fonts && { fonts }),
    ...(robotsElsewhere && { robotsElsewhere }),
    ...(settings.url && { sitemap: absoluteUrl(settings.url, "/sitemap.xml") }),
  };
}

/**
 * Writes the build record (`goodfellow-build.json`) into the export, as
 * `goodfellow build` does, from the dates the processes that rendered its
 * pages wrote into `.next/` (see `withGoodfellow()`). Returns when the site
 * stops being current, if it does.
 */
export async function writeBuildRecordFile(outDir: string, root = process.cwd()): Promise<string | undefined> {
  const dir = resolve(root);
  const content = await loadSiteContent(fileSystemSource(dir));
  const date = await reportedDate(join(dir, ".next", BUILD_DATES_DIR));
  const record = await writeBuildRecord(outDir, { root: dir, content, now: new Date(), ...(date && { date }) });
  return record.currentUntil;
}

/** What `writeRedirectFiles()` wrote. */
export interface RedirectsWritten {
  /** How many pages at old addresses. */
  pages: number;
  /** How many redirects didn't fit in Cloudflare Pages' `_redirects`, and are left to their pages. */
  cloudflareLeft: number;
}

/**
 * Writes a page at each of the site's old addresses that sends visitors on, as
 * `goodfellow build` does, and the same redirects in `_redirects` for
 * Cloudflare Pages, which sends them itself. Pages win: an address the export
 * has a page at keeps it.
 */
export async function writeRedirectFiles(outDir: string, root = process.cwd()): Promise<RedirectsWritten> {
  const dir = resolve(root);
  const content = shownContent(await loadSiteContent(fileSystemSource(dir)));
  const base = await exportBasePath(dir);
  const files = redirectFiles(content, { taken: allPages(content).map((page) => page.path), base });
  const written: Redirect[] = [];
  for (const file of files) {
    const target = join(outDir, file.path.slice(1));
    // Next.js writes pages as `about.html`, such as ones blocks add.
    const page = join(outDir, `${file.path.replace(/\/index\.html$/, "")}.html`);
    if ((await exists(target)) || (await exists(page))) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
    written.push(file);
  }
  const cloudflare = cloudflareRedirects(written, base);
  const redirects = join(outDir, CLOUDFLARE_REDIRECTS_PATH.slice(1));
  // A site's own public/_redirects stays as it is.
  if (cloudflare.file && !(await exists(redirects))) await writeFile(redirects, cloudflare.file.content);
  return { pages: written.length, cloudflareLeft: cloudflare.left };
}

/**
 * For a site with an admin address (its config's `admin`, which the exported
 * `goodfellow-site.json` carries), puts the guard first in every page of the
 * export and adds Cloudflare Pages' header rules, as `goodfellow build` does.
 * Run it last, once every page is written. Returns how many pages it guarded,
 * or `undefined` for a site without an admin address.
 */
export async function guardExport(outDir: string, root = process.cwd()): Promise<number | undefined> {
  const text = await readFile(join(outDir, SITE_DESCRIPTION_PATH), "utf8").catch(() => undefined);
  const parsed = text === undefined ? undefined : parseSiteDescription(text);
  const admin = parsed?.ok ? parsed.description.admin : undefined;
  if (!admin) return undefined;
  const dir = resolve(root);
  const content = await loadSiteContent(fileSystemSource(dir));
  return guardBuiltSite(outDir, {
    admin,
    ...(parsed?.ok && parsed.description.broker && { broker: parsed.description.broker }),
    siteUrl: content.settings.url,
    base: `${await exportBasePath(dir)}/`,
  });
}

/**
 * Puts a static export's prefetch files where the browser asks for them.
 * Next.js names each after its segment path with `/` turned into `.`
 * (`__next.$oc$path.__PAGE__.txt`), but on Windows the path has `\` instead, so
 * the export writes folders (`__next.$oc$path/__PAGE__.txt`), and every
 * prefetch is "not found". Returns how many files it moved; none elsewhere.
 */
export async function fixSegmentFiles(outDir: string): Promise<number> {
  let moved = 0;
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "_next") continue;
      const path = join(dir, entry.name);
      if (!entry.name.startsWith("__next.")) {
        await visit(path);
        continue;
      }
      for (const file of await readdir(path, { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        const source = join(file.parentPath, file.name);
        const parts = relative(path, source).split(/[\\/]/);
        await rename(source, join(dir, [entry.name, ...parts].join(".")));
        moved++;
      }
      await rm(path, { recursive: true, force: true });
    }
  }
  await visit(outDir);
  return moved;
}

/** Where the editor's frames' page is in an export, and in a full-stack site's build. */
export const EDITOR_PAGES = ["admin/editor/index.html", "admin/editor.html"];

function scriptHash(text: string): string {
  return `sha256-${createHash("sha256").update(text).digest("base64")}`;
}

/**
 * Gives the editor's frames' page (`app/admin/editor/`) its Content Security
 * Policy and first script, which removes WebRTC, as the first things in its
 * head, so they apply before anything Next.js put there. The policy runs only
 * the site's own scripts, Next.js's inline ones by their hashes, and fetches
 * nothing (`editorPolicy()`). Returns whether it found the page.
 */
export async function writeEditorPolicy(dir: string): Promise<boolean> {
  let found = false;
  for (const name of EDITOR_PAGES) {
    const file = join(dir, name);
    const html = await readFile(file, "utf8").catch(() => undefined);
    if (html === undefined || html.includes('http-equiv="Content-Security-Policy"')) continue;
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => match[1] ?? "",
    );
    const policy = editorPolicy({ scriptHashes: [EDITOR_PRELUDE, ...inline].map(scriptHash), blobScripts: true });
    const head = `<meta http-equiv="Content-Security-Policy" content="${policy}"/><script>${EDITOR_PRELUDE}</script>`;
    await writeFile(
      file,
      html.replace(/<head([^>]*)>/, (open) => `${open}${head}`),
    );
    found = true;
  }
  return found;
}

/** Says a page's language on its `<html>`, in place of the root layout's. */
function withPageLanguage(html: string, language: string): string {
  return html.replace(/<html\b([^>]*?)\slang="[^"]*"/, `<html$1 lang="${language}"`);
}

/**
 * On a site in several languages, puts each page's language on its `<html>`,
 * which Next.js's root layout, shared by every page, says is the main one:
 * in a static export's pages (`outDir`), or, without one, in the pages a
 * full-stack site's `next build` rendered ahead. Returns how many it changed.
 */
export async function writePageLanguages(outDir: string | undefined, root = process.cwd()): Promise<number> {
  const dir = resolve(root);
  const { settings } = await loadSiteContent(fileSystemSource(dir));
  if (!hasLanguages(settings)) return 0;
  const base = outDir ?? join(dir, ".next/server/app");
  const files = (await readdir(base, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter((file) => file.endsWith(".html") && !/^(admin|_next|pagefind)\//.test(file));
  let changed = 0;
  for (const file of files) {
    const path = `/${file.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`.replace(/\/$/, "") || "/";
    const html = await readFile(join(base, file), "utf8");
    const fixed = withPageLanguage(html, pathLanguage(settings, path));
    if (fixed === html) continue;
    await writeFile(join(base, file), fixed);
    changed++;
  }
  return changed;
}

/** A page `next build` rendered ahead: its address on the site, and its HTML. */
export interface BuiltPage {
  url: string;
  html: string;
}

/**
 * The pages `next build` rendered ahead for a full-stack site (`withGoodfellow(config,
 * { server: true })`), at their addresses on the site, without its base path, as the
 * Search block looks them up. Next.js lists them in `.next/prerender-manifest.json`
 * and keeps their HTML in `.next/server/app/`. The admin panel and Next.js's own pages are left out.
 */
export async function builtPages(root = process.cwd()): Promise<BuiltPage[]> {
  const next = join(resolve(root), ".next");
  const manifest = JSON.parse(await readFile(join(next, "prerender-manifest.json"), "utf8")) as {
    routes?: Record<string, unknown>;
  };
  const settings = JSON.parse(await readFile(join(next, "required-server-files.json"), "utf8")) as {
    config?: { trailingSlash?: boolean };
  };
  const trailingSlash = settings.config?.trailingSlash === true;
  const pages: BuiltPage[] = [];
  for (const route of Object.keys(manifest.routes ?? {})) {
    if (route.startsWith("/_") || route === "/admin" || route.startsWith("/admin/")) continue;
    const file = join(next, "server/app", `${route === "/" ? "/index" : route}.html`);
    // Routes that aren't pages, such as robots.txt, have no HTML.
    if (!(await exists(file))) continue;
    const url = route === "/" ? "/" : trailingSlash ? `${route}/` : route;
    pages.push({ url, html: await readFile(file, "utf8") });
  }
  return pages;
}

/**
 * The pages a static export has, at their addresses on the site, without its
 * base path: `about.html` and `about/index.html` are `/about`. The admin panel
 * and Next.js's own files are left out.
 */
export async function exportedPages(outDir: string): Promise<BuiltPage[]> {
  const files = (await readdir(outDir, { recursive: true }))
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        file.endsWith(".html") &&
        !/^(admin|_next|pagefind)\//.test(file) &&
        !file.startsWith("_not-found") &&
        file !== "404/index.html",
    );
  const pages: BuiltPage[] = [];
  for (const file of files) {
    const url = `/${file.replace(/(^|\/)index\.html$/, "").replace(/\.html$/, "")}`.replace(/\/$/, "") || "/";
    pages.push({ url, html: await readFile(join(outDir, file), "utf8") });
  }
  return pages;
}

/** The content file a page comes from: its own, or, for pages blocks add such as a list's second page, its page's. */
function contentFile(pages: readonly Page[], path: string): string | undefined {
  const own = pages.find((page) => page.path === path);
  if (own) return own.file;
  const under = pages
    .filter((page) => page.path !== "/" && path.startsWith(`${page.path}/`))
    .sort((a, b) => b.path.length - a.path.length);
  return under[0]?.file;
}

/**
 * What automated checks find on the pages Next.js built, as `goodfellow build`
 * reports them: images without alt text, headings that skip a level, links
 * that don't say where they go, and axe-core's checks (`checkBuiltPages()`).
 * Pages that aren't the site's, such as Next.js's own, are left out.
 */
export async function checkPages(pages: readonly BuiltPage[], root = process.cwd()): Promise<SiteProblem[]> {
  const known = allPages(shownContent(await loadSiteContent(fileSystemSource(resolve(root)))));
  return checkBuiltPages(
    pages.flatMap((page) => {
      const path = page.url.replace(/(.)\/$/, "$1");
      const file = contentFile(known, path);
      return file ? [{ path, file, html: page.html }] : [];
    }),
  );
}
