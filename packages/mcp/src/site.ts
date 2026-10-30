/**
 * Opening a site for the tools: its backend, its settings, and the
 * description its build published (`goodfellow-site.json`), which says what
 * blocks it has, since the connector doesn't have the site's code.
 */
import {
  describedConfig,
  type GitBackend,
  GOODFELLOW_VERSION,
  parseSiteDescription,
  SITE_DESCRIPTION_PATH,
  type SiteDescription,
  type SiteSettings,
  siteVersionProblem,
} from "@goodfellow-cms/core";
import type { Config } from "@puckeditor/core";
import { readSettings, ToolError } from "./content.js";

/** Where the tools find the sites they may edit, and sign in to them. */
export interface ConnectorContext {
  /** The sites this connection may edit, such as `github:parish/site`. */
  sites(): Promise<Array<{ id: string; label?: string }>>;
  /** Signs in to a site's repository. Throws `ToolError` for a site this connection may not edit. */
  backend(site: string): Promise<GitBackend>;
  /**
   * Where a site is served, where that isn't its address in Site settings:
   * a site in a folder on this computer is read from its development server.
   * Throws `ToolError` where it isn't being served.
   */
  served?(site: string): Promise<string | undefined>;
  /** Fetches the live site's description. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Takes screenshots, where this server can. */
  screenshots?: Screenshotter;
  /**
   * Whether `publish` runs the admin panel's checks first, which read the
   * whole site twice: on unless turned off, as the connector service does on
   * Workers' free plan, whose requests have 10 ms of CPU.
   */
  siteChecks?: boolean;
  /** For tests. */
  now?: () => Date;
}

export interface Screenshotter {
  /**
   * A PNG of a page at `url`, `width` pixels wide and as tall as the page. With
   * `preview`, `url` is the site's preview page (`/admin/#/preview`), which is
   * handed a draft's content files and shows the page at `preview.path`.
   */
  take(options: {
    url: string;
    width: number;
    preview?: { files: Record<string, string>; path: string; dark?: boolean };
    /** `url` is an image's, shown on a page of its own (`imagePage()`), no wider than `width`. */
    image?: boolean;
    /** Shows the page as a computer set to dark sees it, for sites with dark mode. */
    dark?: boolean;
  }): Promise<Uint8Array>;
}

export interface OpenedSite {
  id: string;
  backend: GitBackend;
  settings: SiteSettings;
  /** The live site's address, without a trailing slash. */
  url: string;
  description: SiteDescription;
  /** Puck's config as far as the description tells: blocks for pages, the header and the footer. */
  pageConfig: Config;
  /** Every block, for collections' templates. */
  templateConfig: Config;
  /** Why changes can't be written to this site, if they can't. */
  versionProblem?: string;
}

const VERSION_PROBLEMS = {
  "site-too-old": (site: string) =>
    `The site was built with Goodfellow ${site}, which is too old for Claude to change it. Ask the site's owner to update it on the admin panel's Updates screen; reading it still works.`,
  "tool-too-old": (site: string) =>
    `The site was built with Goodfellow ${site}, which is newer than this connector (${GOODFELLOW_VERSION}). Update the connector to change it; reading it still works.`,
};

/** The site's description, from its address, or `undefined` where it can't be read there. */
async function readDescription(context: ConnectorContext, url: string): Promise<SiteDescription | undefined> {
  const response = await (context.fetch ?? fetch)(`${url}/${SITE_DESCRIPTION_PATH}`, {
    headers: { accept: "application/json" },
  }).catch(() => undefined);
  const result = response?.ok ? parseSiteDescription(await response.text()) : { ok: false as const };
  return result.ok ? result.description : undefined;
}

/** Where the host's own Pages publishes the site: its custom domain first, then its address there, such as `name.gitlab.io`. */
async function pagesAddresses(backend: GitBackend): Promise<string[]> {
  const found = await backend.pages?.site().catch(() => undefined);
  return [found?.domain && `https://${found.domain}`, found?.url].filter((url): url is string => Boolean(url));
}

/**
 * Opens a site. Its blocks come from the description its build published, so
 * it's read from the site's address in Site settings, or, where that's empty,
 * from where the host's Pages publishes it. `addresses` remembers what was
 * found, by site, so the host is asked once.
 */
export async function openSite(
  context: ConnectorContext,
  id: string,
  addresses: Map<string, string> = new Map(),
): Promise<OpenedSite> {
  const backend = await context.backend(id);
  await backend.revision();
  const settings = await readSettings(backend);
  const served = await context.served?.(id);
  const own = (served ?? settings.url)?.replace(/\/+$/, "");
  const known = addresses.get(id);
  const candidates = own
    ? [own]
    : known
      ? [known]
      : (await pagesAddresses(backend)).map((url) => url.replace(/\/+$/, ""));
  if (candidates.length === 0) {
    throw new ToolError(
      "Claude needs the site's address to see what blocks it has, and the site doesn't have one in Site settings, nor does its host say where it's published. Set it in the admin panel: Site settings, General → Site address.",
    );
  }
  let url = candidates[0] ?? "";
  let description: SiteDescription | undefined;
  for (const candidate of candidates) {
    description = await readDescription(context, candidate);
    url = candidate;
    if (description) break;
  }
  if (!description) {
    throw new ToolError(
      `Claude couldn't read what blocks the site has from ${url}/${SITE_DESCRIPTION_PATH}. The site may not be online yet, or was built before Goodfellow could work with Claude: publish any change in the admin panel to rebuild it.`,
    );
  }
  if (!own) addresses.set(id, url);
  const problem = siteVersionProblem(description);
  return {
    id,
    backend,
    settings,
    url,
    description,
    pageConfig: describedConfig(description, "page"),
    templateConfig: describedConfig(description, "template"),
    ...(problem && { versionProblem: VERSION_PROBLEMS[problem](description.goodfellow) }),
  };
}
