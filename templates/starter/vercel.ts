// Vercel's settings for this site, which Vercel reads when it builds the site.
//
// Vercel also sends the redirects from Site Settings → Redirects (content/redirects.json) itself,
// so visitors go straight to the new address. Like the pages the build writes at old addresses
// for other hosts, a redirect from an address a page has is left out: pages always win.
// This file uses only Node's own modules, since Vercel may read it before installing packages.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const config = {
  framework: null,
  installCommand: "npm ci",
  buildCommand: "npx goodfellow build",
  outputDirectory: "dist",
  redirects: redirects(),
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
