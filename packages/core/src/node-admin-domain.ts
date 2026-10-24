import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  type AdminAddress,
  adminAddressProblem,
  adminGuard,
  adminOrigin,
  CLOUDFLARE_HEADERS_PATH,
  cloudflareAdminHeaders,
  pageFileKind,
  siteGuard,
  startsWithGuard,
  withGuard,
} from "./admin-domain.js";
import { brokerOrigin } from "./broker.js";

export interface GuardOptions {
  admin: AdminAddress;
  /** The Site address (`content/site.json`'s `url`), where site pages opened at the admin address go. */
  siteUrl: string | undefined;
  /** The site's base path, such as `/` or `/my-site/`. */
  base?: string;
  /** The site's token broker (the config's `broker`), which may show the admin panel in its frame. */
  broker?: { url: string };
}

/**
 * Makes a built site ready for its admin address, as `goodfellow build` and
 * `goodfellow-next finish` do last: puts the guard first in every page a
 * browser opens (HTML, SVG and XML files, `404.html`, redirect pages and media
 * included), then checks every one, and adds Cloudflare Pages' header rules to
 * `_headers`. The admin panel's page gets its own guard; the editor's frames'
 * pages have theirs in the script they start with. Throws, naming them, if
 * any page can't start with its guard, since the admin address isn't safe
 * while one doesn't. Returns how many pages it guarded.
 */
export async function guardBuiltSite(
  outDir: string,
  { admin, siteUrl, base = "/", broker }: GuardOptions,
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
  for (const entry of await readdir(outDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const path = relative(outDir, file).split("\\").join("/");
    const kind = pageFileKind(path);
    // The editor's frames refuse to run anywhere but in the admin panel's sandboxed frames (`EDITOR_PRELUDE`).
    if (!kind || path.startsWith("admin/editor/") || path === "admin/editor.html") continue;
    const text = await readFile(file, "utf8");
    const next = withGuard(text, kind, path.startsWith("admin/") ? forAdmin : forSite);
    if (next === undefined || !startsWithGuard(next, kind)) {
      unguarded.push(path);
      continue;
    }
    if (next !== text) await writeFile(file, next);
    guarded += 1;
  }
  if (unguarded.length > 0) {
    throw new Error(
      `The admin address needs every page to start with its guard, and ${unguarded.length === 1 ? "this one can't" : "these can't"}: ${unguarded.join(", ")}. A page can't have a script, an event handler or a frame before it, or an XML stylesheet, and a compressed SVG can't be changed: remove or change ${unguarded.length === 1 ? "it" : "them"}.`,
    );
  }
  // Cloudflare Pages sandboxes the rest of the admin address itself. Other hosts serve this as a file of no use.
  const headersFile = join(outDir, CLOUDFLARE_HEADERS_PATH);
  const own = await readFile(headersFile, "utf8").catch(() => "");
  if (!own.includes(`${origin}/*`)) {
    const separator = own === "" ? "" : own.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(headersFile, `${own}${separator}${cloudflareAdminHeaders(admin, base, framer)}`);
  }
  return guarded;
}
