/**
 * Copies of a site built from other branches of its repository, such as a
 * staging site: the same content, at another address, kept out of search
 * engines. What differs is set where the copy is built, in environment
 * variables, never in content, so merging the copy's branch into the main
 * one brings nothing of the copy's with it. Only builds read them
 * (`builtSiteSource()` in `@goodfellow-cms/core/node`); the admin panel shows
 * them but never saves them.
 */

import type { AdminSite } from "./admin-site.js";
import type { SiteDescription } from "./site-description.js";

/** The copy's own address, such as `https://staging.example.org`, in place of Site settings' address. */
export const SITE_URL_VARIABLE = "GOODFELLOW_SITE_URL";

/** Set to `true` (or `1`) to ask search engines not to list any of the copy's pages. */
export const NO_INDEX_VARIABLE = "GOODFELLOW_NO_INDEX";

/**
 * Set to `false` where the host serves pages at addresses without a `/` at
 * the end, such as `/about`, and redirects `/about/` there: pages' full
 * addresses then end without one. `true`, the default, ends them with one, as
 * hosts serve the folders builds write (`about/index.html`). Builds set it
 * from the config's `trailingSlash`, and Next.js sites from Next.js's.
 */
export const TRAILING_SLASH_VARIABLE = "GOODFELLOW_TRAILING_SLASH";

/** What `GOODFELLOW_TRAILING_SLASH` says, or `undefined` where it isn't set. Throws, in words, for values it can't use. */
export function trailingSlashFrom(env: Readonly<Record<string, string | undefined>>): boolean | undefined {
  const value = env[TRAILING_SLASH_VARIABLE]?.trim().toLowerCase() ?? "";
  if (value === "") return undefined;
  if (YES.has(value)) return true;
  if (NO.has(value)) return false;
  throw new Error(`${TRAILING_SLASH_VARIABLE} is "${env[TRAILING_SLASH_VARIABLE]}": set it to true or false.`);
}

/**
 * The environment a build reads the site with: `GOODFELLOW_TRAILING_SLASH`
 * from the config's `trailingSlash` where the environment doesn't set it.
 */
export function withConfiguredTrailingSlash(
  env: Readonly<Record<string, string | undefined>>,
  trailingSlash: boolean | undefined,
): Readonly<Record<string, string | undefined>> {
  if (trailingSlash === undefined || env[TRAILING_SLASH_VARIABLE]?.trim()) return env;
  return { ...env, [TRAILING_SLASH_VARIABLE]: String(trailingSlash) };
}

/** `content/site.json`'s text as a build shows the site, with how pages' addresses end (`trailingSlash`) set. */
export function withTrailingSlash(text: string, trailingSlash: boolean | undefined): string {
  if (trailingSlash === undefined) return text;
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return text;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return text;
  return JSON.stringify({ ...settings, trailingSlash });
}

/** What a copy of the site has of its own. */
export interface SiteCopy {
  /** Its address, in place of Site settings' `url`. */
  url?: string;
  /** Whether search engines are asked not to list it. */
  noIndex?: boolean;
}

const YES = new Set(["1", "true", "yes"]);
const NO = new Set(["", "0", "false", "no"]);

/** An address a copy can be at: `http://` or `https://`, as Site settings' address. */
function isSiteAddress(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "https:" || protocol === "http:") && hostname !== "";
  } catch {
    return false;
  }
}

/** The copy of the site the environment describes; nothing for the main site. Throws, in words, for values it can't use. */
export function siteCopyFrom(env: Readonly<Record<string, string | undefined>>): SiteCopy {
  const url = env[SITE_URL_VARIABLE]?.trim();
  if (url && !isSiteAddress(url)) {
    throw new Error(
      `${SITE_URL_VARIABLE} is "${url}", which isn't a web address, such as https://staging.example.org.`,
    );
  }
  const hide = env[NO_INDEX_VARIABLE]?.trim().toLowerCase() ?? "";
  if (!YES.has(hide) && !NO.has(hide)) {
    throw new Error(`${NO_INDEX_VARIABLE} is "${env[NO_INDEX_VARIABLE]}": set it to true or false.`);
  }
  return { ...(url && { url: url.replace(/\/+$/, "") }), ...(YES.has(hide) && { noIndex: true }) };
}

/** Whether a copy has anything of its own. */
export function isSiteCopy(copy: SiteCopy | undefined): copy is SiteCopy {
  return Boolean(copy && (copy.url || copy.noIndex));
}

/** `content/site.json`'s text as the copy is built: its address, and its search engine setting, in place of the file's. */
export function withSiteCopy(text: string, copy: SiteCopy): string {
  if (!isSiteCopy(copy)) return text;
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    // Loading the site says what's wrong with the file.
    return text;
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return text;
  return JSON.stringify({
    ...settings,
    ...(copy.url && { url: copy.url }),
    ...(copy.noIndex && { noIndex: true }),
  });
}

/**
 * The site's description as a copy is built. A copy at an address of its own
 * leaves out the main site's admin address, which the config names: its
 * admin panel is at the copy's own address, as on a site without one, and the
 * main site's would publish to the main site.
 */
export function describedForCopy(description: SiteDescription, copy: SiteCopy): SiteDescription {
  if (!copy.url || !description.admin) return description;
  const { admin: _, ...rest } = description;
  return rest;
}

/** What the admin panel's page knows as a copy is built: the copy's own details, without the main site's admin address. */
export function adminSiteForCopy(site: AdminSite, copy: SiteCopy): AdminSite {
  if (!isSiteCopy(copy)) return site;
  const { admin: _, ...rest } = site;
  return {
    ...(copy.url ? rest : site),
    description: describedForCopy(site.description, copy),
    copy,
  };
}
