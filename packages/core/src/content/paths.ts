/** Where everything lives in a site's repository. Paths are relative to the repo root. */
export const CONTENT_DIR = "content";
export const PAGES_DIR = "content/pages";
export const SITE_FILE = "content/site.json";
export const MENUS_FILE = "content/menus.json";
/** Old addresses that send visitors on to new ones. */
export const REDIRECTS_FILE = "content/redirects.json";
/** What the site knows about its media files, such as photos' credits. */
export const MEDIA_FILE = "content/media.json";
export const HEADER_FILE = "content/layout/header.json";
export const FOOTER_FILE = "content/layout/footer.json";

/** The header or footer in one of the site's other languages, which replaces the main one there: `content/layout/header.es.json`. */
export function languageLayoutFile(part: "header" | "footer", language: string): string {
  return `content/layout/${part}.${language}.json`;
}
export const CUSTOM_CSS_FILE = "content/styles/custom.css";
/** Which theme the site's look came from, and what it installed, so an update keeps what owners changed since. */
export const THEME_FILE = "content/styles/theme.json";
/** Admin-written code for every page: in the `<head>`, and at the end of the `<body>`. */
export const HEAD_CODE_FILE = "content/code/head.html";
export const BODY_CODE_FILE = "content/code/body.html";
/** Whether Goodfellow's fixes install on their own, and releases they never install. */
export const UPDATES_FILE = "content/updates.json";
export const MEDIA_DIR = "public/media";
export const COLLECTIONS_DIR = "content/collections";
/** Where blocks installed from block registries go, with the record of what's installed and the list the config imports. */
export const INSTALLED_BLOCKS_DIR = "blocks/installed";
export const INSTALLED_RECORD_FILE = "blocks/installed/installed.json";
export const INSTALLED_INDEX_FILE = "blocks/installed/index.ts";
/** Where the record of plugins installed from the admin panel's Plugins screen is kept, with the list the config imports. */
export const INSTALLED_PLUGINS_DIR = "plugins/installed";
export const INSTALLED_PLUGINS_FILE = "plugins/installed/installed.json";
export const INSTALLED_PLUGINS_INDEX = "plugins/installed/index.ts";
/** Folders blocks' shared code is installed into, as the shadcn CLI's defaults put it. */
export const COMPONENTS_DIR = "components";
export const LIB_DIR = "lib";
export const HOOKS_DIR = "hooks";
/**
 * Where a site whose content is kept in a repository of its own has that
 * repository, inside the site's folder: `content/` and `public/media/` are
 * links into it on a developer's computer, and copies of it in builds.
 */
export const CONTENT_REPOSITORY_DIR = "content-repository";
/** The file in each collection's folder that holds its fields, address pattern and template. */
export const COLLECTION_SETTINGS_FILE = "_collection.json";

/** A URL path segment: lowercase letters, digits and single hyphens. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class InvalidPathError extends Error {
  override name = "InvalidPathError";
}

/** `"/about/team"` → `["about", "team"]`; `"/"` → `[]`. Throws on invalid paths. */
export function pathSegments(path: string): string[] {
  if (!path.startsWith("/")) {
    throw new InvalidPathError(`Page addresses must start with "/" (got "${path}").`);
  }
  const segments = path.split("/").filter((segment) => segment !== "");
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      throw new InvalidPathError(
        `"${segment}" can't be part of a page address. Use lowercase letters, numbers and hyphens only.`,
      );
    }
  }
  return segments;
}

/** Whether text can be one part of an address, such as a page's last part or an entry's name in its file. */
export function isAddressSegment(text: string): boolean {
  return SEGMENT.test(text);
}

/** Addresses used by Goodfellow itself, which pages can't use. */
export const RESERVED_PAGE_PATHS = ["/admin"];

/** Whether a page path is, or is inside, an address Goodfellow reserves. */
export function isReservedPagePath(path: string): boolean {
  return RESERVED_PAGE_PATHS.some((reserved) => path === reserved || path.startsWith(`${reserved}/`));
}

/** Normalizes a page path: `"/about/"` → `"/about"`. */
export function normalizePagePath(path: string): string {
  return `/${pathSegments(path).join("/")}`;
}

/** The content file for a page: `"/"` → `content/pages/index.json`, `"/about"` → `content/pages/about.json`. */
export function pagePathToFile(path: string): string {
  const segments = pathSegments(path);
  return segments.length === 0 ? `${PAGES_DIR}/index.json` : `${PAGES_DIR}/${segments.join("/")}.json`;
}

/**
 * The page a content file serves. `index.json` serves its folder, so
 * `content/pages/index.json` → `"/"` and `content/pages/news/index.json` → `"/news"`.
 */
export function pageFileToPath(file: string): string {
  const prefix = `${PAGES_DIR}/`;
  if (!file.startsWith(prefix) || !file.endsWith(".json")) {
    throw new InvalidPathError(`${file} is not a page file. Pages are .json files in ${PAGES_DIR}/.`);
  }
  const segments = file.slice(prefix.length, -".json".length).split("/");
  if (segments.at(-1) === "index") segments.pop();
  return normalizePagePath(`/${segments.join("/")}`);
}

/** The HTML file a page builds to: `"/"` → `index.html`, `"/about"` → `about/index.html`, `"/404"` → `404.html`. */
export function pageOutputFile(path: string): string {
  const segments = pathSegments(path);
  if (segments.length === 0) return "index.html";
  if (segments.length === 1 && segments[0] === "404") return "404.html";
  return `${segments.join("/")}/index.html`;
}

/** A collection's settings file: `"videos"` → `content/collections/videos/_collection.json`. */
export function collectionSettingsFile(collection: string): string {
  return `${COLLECTIONS_DIR}/${collection}/${COLLECTION_SETTINGS_FILE}`;
}

/**
 * An entry's file: `("videos", "easter-vigil")` → `content/collections/videos/easter-vigil.json`,
 * or `easter-vigil.md` in a collection whose entries are Markdown files.
 */
export function entryFile(collection: string, slug: string, format: "json" | "markdown" = "json"): string {
  return `${COLLECTIONS_DIR}/${collection}/${slug}${format === "markdown" ? ".md" : ".json"}`;
}

/** The placeholder an entry's address pattern must contain, such as `/videos/{slug}`. */
export const SLUG_PLACEHOLDER = "{slug}";

/**
 * Checks a collection's address pattern, such as `/videos/{slug}` or
 * `/events/{slug}/details`. It must contain `{slug}` exactly once, as a whole
 * part of the address. Returns why it can't be used, or `undefined` if it can.
 */
export function addressPatternProblem(pattern: string): string | undefined {
  if (!pattern.startsWith("/")) return 'must start with "/".';
  const segments = pattern.split("/").filter((segment) => segment !== "");
  const slugs = segments.filter((segment) => segment === SLUG_PLACEHOLDER).length;
  if (slugs !== 1) return `must contain ${SLUG_PLACEHOLDER} exactly once, such as /videos/${SLUG_PLACEHOLDER}.`;
  const bad = segments.find((segment) => segment !== SLUG_PLACEHOLDER && !SEGMENT.test(segment));
  if (bad !== undefined) return `can't contain "${bad}". Use lowercase letters, numbers and hyphens only.`;
  return undefined;
}

/** An entry's address: `("/videos/{slug}", "easter-vigil")` → `/videos/easter-vigil`. */
export function entryAddress(pattern: string, slug: string): string {
  return normalizePagePath(pattern.replace(SLUG_PLACEHOLDER, slug));
}
