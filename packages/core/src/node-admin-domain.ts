import { open, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  type AdminAddress,
  adminAddressProblem,
  adminGuard,
  adminOrigin,
  CACHED_FOLDERS,
  CLOUDFLARE_HEADERS_PATH,
  cloudflareAdminHeaders,
  cloudflareSiteHeaders,
  FRAME_FOLDERS,
  headersHost,
  isFrameFileName,
  netlifySiteHeaders,
  pageFileKind,
  SITE_HEADERS_MARK,
  siteGuard,
  startsAsMarkup,
  startsWithGuard,
  typedByContent,
  withGuard,
} from "./admin-domain.js";
import { brokerOrigin } from "./broker.js";

/**
 * Adds Cloudflare Pages' header rules for every site (`cloudflareSiteHeaders()`),
 * or Netlify's where it builds the site (`netlifySiteHeaders()`, `headersHost()`),
 * to the built site's `_headers`, after the site's own rules, once, with long
 * caching for the folders `cachedFolders()` finds named by content: as
 * `goodfellow build` and `goodfellow-next finish` do before `guardBuiltSite()`
 * adds an admin address's. Other hosts serve the file as one of no use.
 */
/** A name Vite gives a file it writes, ending with its 8-character hash: `styles-B56g62wk.css`. */
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

/**
 * The `CACHED_FOLDERS` a built site can be sent with long caching: all of
 * them, but `assets/` where any file there isn't named by its hash, as one
 * the site keeps in `public/assets/` wouldn't be, since a changed one would
 * keep its address.
 */
export async function cachedFolders(outDir: string): Promise<string[]> {
  const files = await readdir(join(outDir, "assets"), { recursive: true, withFileTypes: true }).catch(() => []);
  const unnamed = files.some((entry) => entry.isFile() && !HASHED_NAME.test(entry.name));
  return CACHED_FOLDERS.filter((folder) => folder !== "assets/" || !unnamed);
}

export async function writeSiteHeaders(
  outDir: string,
  {
    base = "/",
    admin,
    broker,
    host = headersHost(process.env),
  }: { base?: string; admin?: AdminAddress; broker?: { url: string }; host?: "netlify" } = {},
): Promise<void> {
  const file = join(outDir, CLOUDFLARE_HEADERS_PATH);
  const own = await readFile(file, "utf8").catch(() => "");
  if (own.includes(SITE_HEADERS_MARK)) return;
  const framer = brokerOrigin(broker);
  const cached = await cachedFolders(outDir);
  const rules =
    host === "netlify"
      ? netlifySiteHeaders(base, { ...(framer && { broker: framer }), cached })
      : cloudflareSiteHeaders(base, { ...(admin && { admin }), ...(framer && { broker: framer }), cached });
  const separator = own === "" ? "" : own.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(file, `${own}${separator}${rules}`);
}

export interface GuardOptions {
  admin: AdminAddress;
  /** The Site address (`content/site.json`'s `url`), where site pages opened at the admin address go. */
  siteUrl: string | undefined;
  /** The site's base path, such as `/` or `/my-site/`. */
  base?: string;
  /** The site's token broker (the config's `broker`), which may show the admin panel in its frame. */
  broker?: { url: string };
  /** Netlify, whose `_headers` can't match hosts, so it gets no rules for the admin address: its guards protect it. */
  host?: "netlify";
}

/**
 * Makes a built site ready for its admin address, as `goodfellow build` and
 * `goodfellow-next finish` do last: puts the guard first in every page a
 * browser opens (HTML, SVG, and XML files, `404.html`, redirect pages, and media
 * included), then checks every one, and adds Cloudflare Pages' header rules to
 * `_headers`. The admin panel's page gets its own guard; the editor's frames'
 * pages have theirs in the script they start with. Throws, naming them, if
 * any page can't start with its guard, since the admin address isn't safe
 * while one doesn't. Returns how many pages it guarded.
 */
export async function guardBuiltSite(
  outDir: string,
  { admin, siteUrl, base = "/", broker, host = headersHost(process.env) }: GuardOptions,
): Promise<number> {
  const problem = adminAddressProblem(admin, siteUrl);
  const origin = adminOrigin(admin);
  if (problem || !origin) {
    throw new Error(
      problem === "same-as-site"
        ? `The admin address, ${admin.url}, is the Site address. It needs an address of its own, such as https://admin.example.org.`
        : `The admin address, ${admin.url}, isn't one: it needs to be an https:// address of its own, such as https://admin.example.org.`,
    );
  }
  let site: string | undefined;
  try {
    site = siteUrl ? new URL(siteUrl).origin : undefined;
  } catch {
    site = undefined;
  }
  const forSite = siteGuard(origin, site);
  const framer = brokerOrigin(broker);
  const forAdmin = adminGuard(admin, framer);
  let guarded = 0;
  const unguarded: string[] = [];
  // Files whose names don't say what they are, which a host could open as a page by what they hold, read once the
  // pages are guarded, many at a time.
  const untyped: { file: string; path: string }[] = [];
  // Files in the frames' folders besides their pages, which must be what a frame needs and nothing a host could
  // open as a page.
  const framed: { file: string; path: string }[] = [];
  for (const entry of await readdir(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const path = relative(outDir, file).split("\\").join("/");
    const kind = pageFileKind(path);
    // The editor's frames, and plugins', refuse to run anywhere but in the admin panel's sandboxed frames
    // (`EDITOR_PRELUDE`); anything else in their folders is held to what a frame needs (`notFrameFiles()`).
    if (path === "admin/editor.html" || isFramePage(path)) continue;
    if (FRAME_FOLDERS.some((folder) => path.startsWith(folder))) {
      framed.push({ file, path });
      continue;
    }
    if (!kind) {
      if (typedByContent(path)) untyped.push({ file, path });
      continue;
    }
    const text = await readFile(file, "utf8");
    const next = withGuard(text, kind, path.startsWith("admin/") ? forAdmin : forSite);
    if (next === undefined || !startsWithGuard(next, kind)) {
      unguarded.push(path);
      continue;
    }
    if (next !== text) await writeFile(file, next);
    guarded += 1;
  }
  const markup: string[] = [];
  for (let start = 0; start < untyped.length; start += FILES_AT_ONCE) {
    const batch = untyped.slice(start, start + FILES_AT_ONCE);
    const starts = await Promise.all(batch.map(async ({ file }) => startsAsMarkup(await firstBytes(file))));
    batch.forEach(({ path }, index) => {
      if (starts[index]) markup.push(path);
    });
  }
  const notFrames = await notFrameFiles(framed);
  if (notFrames.length > 0) throw new Error(notFramesMessage(notFrames));
  if (unguarded.length > 0) {
    throw new Error(
      `The admin address needs every page to start with its guard, and ${unguarded.length === 1 ? "this one can't" : "these can't"}: ${unguarded.join(", ")}. A page can't have a script, an event handler, or a frame before it, or an XML stylesheet, and a compressed SVG can't be changed: remove or change ${unguarded.length === 1 ? "it" : "them"}.`,
    );
  }
  if (markup.length > 0) {
    throw new Error(
      `The admin address needs every file that could open as a page to start with its guard, and ${markup.length === 1 ? "this one starts" : "these start"} as a page does, though ${markup.length === 1 ? "its name doesn't" : "their names don't"} say so, which some hosts, such as GitLab Pages, serve as one: ${markup.join(", ")}. Give ${markup.length === 1 ? "it" : "each"} a page's name, such as .html, or remove ${markup.length === 1 ? "it" : "them"}.`,
    );
  }
  // Cloudflare Pages sandboxes the rest of the admin address itself. Other hosts serve this as a file of no use,
  // but Netlify reads it, and can't match hosts.
  if (host === "netlify") return guarded;
  const headersFile = join(outDir, CLOUDFLARE_HEADERS_PATH);
  const own = await readFile(headersFile, "utf8").catch(() => "");
  if (!own.includes(`${origin}/*`)) {
    const separator = own === "" ? "" : own.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(headersFile, `${own}${separator}${cloudflareAdminHeaders(admin, base, framer)}`);
  }
  return guarded;
}

/** Whether a file is a frame's own page, which the build writes: the editor's `index.html`, or a plugin's. */
function isFramePage(path: string): boolean {
  return /^admin\/editor\/(frames\/)?index\.html$/.test(path) || /^admin\/plugins\/[^/]+\/index\.html$/.test(path);
}

/** Of `files`, those a frame's folder mustn't hold: a name outside `isFrameFileName()`, or a start as a page's. */
async function notFrameFiles(files: { file: string; path: string }[]): Promise<string[]> {
  const found: string[] = [];
  for (let start = 0; start < files.length; start += FILES_AT_ONCE) {
    const batch = files.slice(start, start + FILES_AT_ONCE);
    const bad = await Promise.all(
      batch.map(async ({ file, path }) => !isFrameFileName(path) || startsAsMarkup(await firstBytes(file))),
    );
    batch.forEach(({ path }, index) => {
      if (bad[index]) found.push(path);
    });
  }
  return found;
}

function notFramesMessage(files: string[]): string {
  const one = files.length === 1;
  return `The admin panel's frames can hold only their pages, scripts, styles, fonts, and pictures that aren't SVGs, since anything else in their folders could open as a page at the admin panel's address, and ${one ? "this file isn't one" : "these files aren't"}: ${files.join(", ")}. A block's or plugin's code put ${one ? "it" : "them"} there by importing ${one ? "it" : "them"} as an address (such as an .html or .svg with ?url): import ${one ? "it" : "them"} as text or a data: address instead, or leave ${one ? "it" : "them"} out.`;
}

/**
 * What a rebuild into a kept folder wrote, for `checkFrameFolder()` to take
 * out what an earlier build left: the paths it wrote, relative to the folder,
 * and when it started (`Date.now()`).
 */
export interface FrameBuild {
  written: ReadonlySet<string>;
  since: number;
}

/**
 * How long before a build started a file left by another must be to count as
 * an earlier build's, since some file systems keep times only to the second
 * or two. A file written since is kept, as a newer build's may be.
 */
const STALE_MARGIN_MS = 2000;

/**
 * Stops a build at any file in a frame's folder, `dir` (the editor's, or a
 * plugin's), that a frame doesn't need and a browser could open as a page at
 * the admin panel's address, naming them: anything but its `index.html` whose
 * name isn't `isFrameFileName()`'s, or that starts as a page does. As
 * `goodfellow build`, `goodfellow dev`, and `goodfellow-next` check each
 * frame's bundle once it's written, whatever the site's address.
 *
 * Builds that rebuild into the same folder as code changes give `stale`, the
 * build just written, and files it didn't write that are older than it are
 * taken out first, with folders left empty, so a file an import no longer
 * brings doesn't stop every later build. Files written since it started are
 * kept, since a newer build may be writing them, and callers check one build
 * at a time.
 */
export async function checkFrameFolder(dir: string, { stale }: { stale?: FrameBuild } = {}): Promise<void> {
  const files: { file: string; path: string }[] = [];
  const folders: string[] = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => [])) {
    const file = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) folders.push(file);
    if (!entry.isFile()) continue;
    const path = relative(dir, file).split("\\").join("/");
    if (path === "index.html") continue;
    if (stale && !stale.written.has(path)) {
      const changed = await stat(file).then(
        (info) => info.mtimeMs,
        () => undefined,
      );
      if (changed !== undefined && changed < stale.since - STALE_MARGIN_MS) {
        await rm(file, { force: true });
        continue;
      }
    }
    files.push({ file, path });
  }
  if (stale) {
    // The deepest first, so a folder holding only emptied folders goes too; one that isn't empty stays.
    for (const folder of folders.sort((a, b) => b.length - a.length)) await rmdir(folder).catch(() => undefined);
  }
  const found = await notFrameFiles(files);
  if (found.length > 0) throw new Error(notFramesMessage(found));
}

/** How many files' first bytes are read at once: enough to keep the disk busy, few enough for any open-file limit. */
const FILES_AT_ONCE = 64;

/** A file's first bytes, enough for `startsAsMarkup()`. */
async function firstBytes(file: string): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const { buffer, bytesRead } = await handle.read(new Uint8Array(1024), 0, 1024, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
