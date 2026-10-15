/**
 * Opening a site for the tools: its backend, its settings, and the
 * description its build published (`goodfellow-site.json`), which says what
 * blocks it has, since the connector doesn't have the site's code.
 */
import {
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
  /** Fetches the live site's description. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Takes screenshots, where this server can. */
  screenshots?: Screenshotter;
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

function configFrom(description: SiteDescription, templates: boolean): Config {
  return {
    components: Object.fromEntries(
      Object.entries(description.blocks)
        .filter(([, block]) => templates || !block.templateOnly)
        .map(([name, block]) => [
          name,
          {
            ...(block.label && { label: block.label }),
            fields: block.fields,
            ...(block.defaultProps && { defaultProps: block.defaultProps }),
            render: () => null,
          },
        ]),
    ),
    root: { fields: description.root.fields },
  } as unknown as Config;
}

const VERSION_PROBLEMS = {
  "site-too-old": (site: string) =>
    `The site was built with Goodfellow ${site}, which is too old for Claude to change it. Ask the site's owner to update it on the admin panel's Updates screen; reading it still works.`,
  "tool-too-old": (site: string) =>
    `The site was built with Goodfellow ${site}, which is newer than this connector (${GOODFELLOW_VERSION}). Update the connector to change it; reading it still works.`,
};

export async function openSite(context: ConnectorContext, id: string): Promise<OpenedSite> {
  const backend = await context.backend(id);
  await backend.revision();
  const settings = await readSettings(backend);
  if (!settings.url) {
    throw new ToolError(
      "The site doesn't have its address in Site settings yet, and Claude needs it to see what blocks the site has. Set it in the admin panel's Site settings.",
    );
  }
  const url = settings.url.replace(/\/+$/, "");
  const response = await (context.fetch ?? fetch)(`${url}/${SITE_DESCRIPTION_PATH}`, {
    headers: { accept: "application/json" },
  }).catch(() => undefined);
  const result = response?.ok ? parseSiteDescription(await response.text()) : { ok: false as const };
  if (!result.ok) {
    throw new ToolError(
      `Claude couldn't read what blocks the site has from ${url}/${SITE_DESCRIPTION_PATH}. The site may not be online yet, or was built before Goodfellow could work with Claude: publish any change in the admin panel to rebuild it.`,
    );
  }
  const { description } = result;
  const problem = siteVersionProblem(description);
  return {
    id,
    backend,
    settings,
    url,
    description,
    pageConfig: configFrom(description, false),
    templateConfig: configFrom(description, true),
    ...(problem && { versionProblem: VERSION_PROBLEMS[problem](description.goodfellow) }),
  };
}
