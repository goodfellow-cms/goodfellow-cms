// Vercel's settings for this site, which Vercel reads when it builds the site.
//
// Vercel also sends the redirects from Site Settings → Redirects (content/redirects.json) itself,
// so visitors go straight to the new address. Like the pages the build writes at old addresses
// for other hosts, a redirect from an address a page has is left out: pages always win.
//
// Every file gets headers that keep browsers from guessing its type, the media library's SVGs open
// sandboxed, and no other site can frame the admin panel. For a site with an admin address
// (goodfellow.config.tsx's `admin` line, which Site Settings' Domain screen writes), every page at
// that address but the admin panel's own is sandboxed, so a site page served there can't read
// what the admin panel keeps. Pages opened at the wrong one of the two addresses are sent to the
// right one, as the guard scripts the build puts first in every page would: a site page at the admin
// address goes to the Site address (content/site.json's `url`), and once Site Settings has checked
// the admin address (`checked: true`), the admin panel at the Site address goes there.
// This file uses only Node's own modules, since Vercel may read it before installing packages.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const config = {
  framework: null,
  installCommand: "npm ci",
  buildCommand: "npx goodfellow build",
  outputDirectory: "dist",
  redirects: [...adminRedirects(adminAddress(readConfig())), ...redirects()],
  headers: headers(),
  // Drafts, from the admin panel's Add to draft and from Claude, are kept on branches named
  // goodfellow-draft-…, and plugins' tasks answer on branches named goodfellow-task-…, which
  // visitors never see, so Vercel doesn't build previews of them.
  git: { deploymentEnabled: { "goodfellow-draft-*": false, "goodfellow-task-*": false } },
};

interface Redirect {
  from: string;
  to: string;
}

function readJson(file: string): Record<string, unknown> | undefined {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

/** Every file in a folder and its folders, as paths inside it. */
function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((file) => file.split("\\").join("/"));
}

/** The language an item is in, if it isn't the site's main one: `inLanguage` in its file, or its front matter. */
function itemLanguage(file: string): string | undefined {
  const text = readFileSync(file, "utf8");
  const language = file.endsWith(".md")
    ? /^inLanguage:\s*["']?([A-Za-z0-9-]+)/m.exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "")?.[1]
    : JSON.parse(text).inLanguage;
  return typeof language === "string" ? language : undefined;
}

/**
 * The addresses that have pages: `content/pages/about.json` is /about, and each collection item has its
 * own, under its language's code (`/es/…`) if it's in another of the site's languages.
 */
function pageAddresses(): Set<string> {
  const addresses = new Set<string>();
  for (const file of filesIn("content/pages")) {
    if (file.endsWith(".json")) addresses.add(`/${file.slice(0, -".json".length)}`.replace(/\/?index$/, "") || "/");
  }
  for (const id of filesIn("content/collections").filter((file) => file.endsWith("/_collection.json"))) {
    const folder = id.slice(0, -"/_collection.json".length);
    const settings = readJson(join("content/collections", id));
    const pattern = settings?.path;
    if (typeof pattern !== "string") continue;
    const languagePaths = (settings?.languagePaths ?? {}) as Record<string, string>;
    for (const file of readdirSync(join("content/collections", folder))) {
      const slug = /^(.+)\.(json|md)$/.exec(file)?.[1];
      if (!slug || file === "_collection.json") continue;
      const language = itemLanguage(join("content/collections", folder, file));
      const own = language ? (languagePaths[language] ?? `/${language.toLowerCase()}${pattern}`) : pattern;
      addresses.add(own.replace("{slug}", slug).replace(/\/+$/, ""));
    }
  }
  return addresses;
}

/** An address as Vercel matches it, with the characters its patterns use escaped. */
function source(path: string): string {
  return encodeURI(path).replace(/[()[\]{}+*?:!]/g, "\\$&");
}

function redirects() {
  const list = (readJson("content/redirects.json")?.redirects ?? []) as Redirect[];
  const pages = pageAddresses();
  return list.flatMap(({ from, to }) => {
    const path = from.replace(/\/+$/, "");
    if (pages.has(path)) return [];
    // With and without a trailing slash, as the other hosts serve the page there.
    return [path, `${path}/`].map((address) => ({ source: source(address), destination: to, permanent: true }));
  });
}

/**
 * Pages opened at the wrong address, as `vercelAdminRedirects()` in @goodfellow-cms/core writes them.
 * Only pages opened in a tab: the admin panel's frames and what pages load stay where they are.
 */
function adminRedirects(admin: { url: string; checked: boolean } | undefined) {
  const siteUrl = readJson("content/site.json")?.url;
  if (!admin || typeof siteUrl !== "string") return [];
  let site: URL;
  let origin: URL;
  try {
    site = new URL(siteUrl);
    origin = new URL(admin.url);
  } catch {
    return [];
  }
  if (site.origin === origin.origin) return [];
  const opened = { type: "header", key: "sec-fetch-dest", value: "document" };
  const atSite = [{ type: "host", value: site.host }, opened];
  return [
    {
      source: "/:path((?!admin/|admin$).*)",
      has: [{ type: "host", value: origin.host }, opened],
      destination: `${site.origin}/:path`,
      permanent: false,
    },
    ...(admin.checked
      ? [
          { source: "/admin", has: atSite, destination: `${origin.origin}/admin/`, permanent: false },
          {
            source: "/admin/:path((?!editor/|editor$|plugins/).*)",
            has: atSite,
            destination: `${origin.origin}/admin/:path`,
            permanent: false,
          },
        ]
      : []),
  ];
}

/** The site's header rules, as `vercelHeaders()` in @goodfellow-cms/core writes them. */
function headers() {
  const config = readConfig();
  const url = adminAddress(config)?.url;
  // A token broker (the config's `broker` line) shows the admin panel in its frame.
  const brokerLine = /^[ \t]*broker:[ \t]*\{[^\n]*\},?[ \t]*$/m.exec(config)?.[0];
  const broker = brokerLine && /url:\s*"([^"\\]+)"/.exec(brokerLine)?.[1];
  const list = (headers: Record<string, string>) => Object.entries(headers).map(([key, value]) => ({ key, value }));
  const adminPage = list({
    "Cross-Origin-Opener-Policy": "same-origin",
    "Content-Security-Policy": `frame-ancestors ${broker ? new URL(broker).origin : "'none'"}`,
    "Origin-Agent-Cluster": "?1",
  });
  const frames = list({ "Content-Security-Policy": "frame-ancestors 'self'", "Origin-Agent-Cluster": "?1" });
  const site = [
    {
      source: "/(.*)",
      headers: list({
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy": "object-src 'none'; base-uri 'self'",
      }),
    },
    { source: "/media/(.*)\\.(svg|SVG)", headers: list({ "Content-Security-Policy": "sandbox" }) },
  ];
  if (!url) {
    return [
      ...site,
      { source: "/admin/((?!editor/|editor$|plugins/).*)", headers: adminPage },
      { source: "/admin/editor/:path*", headers: frames },
      { source: "/admin/plugins/:path*", headers: frames },
    ];
  }
  const has = [{ type: "host", value: new URL(url).host }];
  return [
    ...site,
    { source: "/((?!admin/|admin$).*)", has, headers: list({ "Content-Security-Policy": "sandbox" }) },
    { source: "/admin/((?!editor/|editor$|plugins/).*)", has, headers: adminPage },
    { source: "/admin/editor/:path*", has, headers: frames },
    { source: "/admin/plugins/:path*", has, headers: frames },
  ];
}

/** The config's `admin` line: the admin address, and whether Site Settings has checked it. */
function adminAddress(config: string): { url: string; checked: boolean } | undefined {
  const line = /^[ \t]*admin:[ \t]*\{[^\n]*\},?[ \t]*$/m.exec(config)?.[0];
  const url = line && /url:\s*"([^"\\]+)"/.exec(line)?.[1];
  return url ? { url, checked: /checked:\s*true/.test(line) } : undefined;
}

function readConfig(): string {
  return existsSync("goodfellow.config.tsx") ? readFileSync("goodfellow.config.tsx", "utf8") : "";
}
