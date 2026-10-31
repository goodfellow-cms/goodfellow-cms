import type { ComponentConfig, Config } from "@puckeditor/core";
import type { AdminAddress } from "./admin-domain.js";
import type { BrokerAddress } from "./broker.js";
import type { GitHost } from "./git.js";
import { type GoodfellowPlugin, withPlugins } from "./plugins.js";

/**
 * A site's `goodfellow.config.tsx`. The site build and its `/admin` page both
 * import this, so the editor always offers exactly the blocks the site renders.
 */
export interface GoodfellowConfig {
  /** Blocks available in the editor, keyed by the name stored in content files. */
  // biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
  blocks: Record<string, ComponentConfig<any>>;
  /** Groups blocks in the editor's block list. */
  categories?: Config["categories"];
  /** The site's stylesheet, relative to the site root. Defaults to `src/styles.css`. */
  styles?: string;
  /**
   * The URL path the site is served from, for hosts that serve it from a
   * subfolder (for example `/my-repo/` on GitHub Pages). Defaults to `/`.
   */
  base?: string;
  /**
   * Where the site's repository lives, such as `github({ repo: "owner/name" })`.
   * Builds include the admin panel at `/admin` only when this or `demo` is set.
   */
  backend?: GitHost;
  /**
   * Where the admin panel starts and editors sign in, an address of its own
   * such as `{ url: "https://admin.example.com" }`, serving the same build,
   * so the site's pages can't reach the admin panel's storage. Site Settings'
   * Domain screen sets it, on a line of its own: first the address, then,
   * once it has checked a site page there, `checked: true`. Not for GitHub
   * Pages, which serves one domain for each site.
   */
  admin?: AdminAddress;
  /**
   * The site's token broker, such as `{ url: "https://broker.example.org" }`:
   * a page on an address of its own that keeps editors' tokens and AI keys and
   * shows the admin panel in a frame, so nothing on the site's or the admin
   * panel's address can read them. Editors sign in there. Set by Site
   * Settings' Security tab, on a line of its own.
   */
  broker?: BrokerAddress;
  /**
   * The addresses of other copies of the site built from its repository, such
   * as a staging site at `https://staging.example.org` built from a `staging`
   * branch, with their admin addresses if they have their own. The sign-in
   * service also signs editors in at these, as it does at the Site address.
   * Each copy says what it has of its own where it's built, with
   * `GOODFELLOW_SITE_URL` and `GOODFELLOW_NO_INDEX`; its branch is the
   * backend's `branch`, such as `branch: process.env.SITE_BRANCH`.
   */
  copies?: readonly string[];
  /**
   * Turns the admin panel into a demo anyone can try without signing in. It
   * starts from the site's content as last built, and keeps each visitor's
   * changes in their own browser: nothing is ever published, and `backend` is
   * ignored. Builds include a copy of the site's content for it to read.
   */
  demo?: boolean;
  /**
   * The content API, which builds write at `/api/`: the site's content as
   * static JSON, each page as it's shown, so apps and other sites can show it
   * without a server. On by default, since it shows nothing the pages don't;
   * `false` leaves it out, for sites that don't want their content read as data.
   */
  api?: false;
  /**
   * Whether `goodfellow build` may run the site's Client Components with
   * Preact (`preact/compat`, about a tenth of React's size) rather than React.
   * It does only where every one of them says it works with Preact
   * (`export const worksWithPreact = true` in its `"use client"` module), so a
   * site's own and other packages' components keep React until they say so.
   * `false` always uses React. `goodfellow dev` and Next.js always use React.
   */
  preact?: false;
  /**
   * Whether pages' full addresses end with `/`, as `https://example.org/about/`:
   * their canonical address, the sitemap's, `hreflang`'s, link previews',
   * feeds' and structured data's, and where redirects send visitors. Builds
   * write each page as a folder (`about/index.html`), which most hosts serve at
   * the address with a `/` and redirect the one without to, so it's `true`
   * where it's missing. Set `false` where the host serves pages without one
   * and redirects the other way. `GOODFELLOW_TRAILING_SLASH` where the site is
   * built overrides it. Next.js sites use Next.js's own `trailingSlash`.
   */
  trailingSlash?: boolean;
  /**
   * The AI assistant in the editor, which drafts and rewrites content with an
   * AI service each editor chooses. On by default; `false` removes it.
   */
  ai?: false | AiConfig;
  /**
   * Block registries the admin panel's Blocks screen offers blocks from,
   * besides Goodfellow's own, by namespace:
   * `{ "@acme": "https://acme.example/r/{name}.json" }`. List only registries
   * you trust: installed blocks' code runs in the admin panel.
   */
  registries?: Record<string, string>;
  /**
   * What Claude may do through Goodfellow's Claude connector. By default it
   * publishes its drafts when the editor says to; `{ publish: false }` leaves
   * it only submitting them for review, for someone to publish on GitHub or
   * GitLab. Builds put this in the site's description, so it takes effect
   * once the site has been rebuilt.
   */
  claude?: ClaudeConfig;
  /**
   * Plugins, such as `s3({ … })` from `goodfellow-plugin-s3`, which add what
   * blocks can't: code and screens in the admin panel, steps in the build and
   * routes on full-stack sites' servers, as well as blocks of their own,
   * which `defineConfig()` adds to `blocks`. Each gets only the permissions it
   * declares, where Goodfellow can enforce them.
   */
  plugins?: GoodfellowPlugin[];
}

export interface ClaudeConfig {
  /** Whether Claude can publish its drafts. On by default. */
  publish?: boolean;
}

export interface AiConfig {
  /**
   * The AI services editors can choose from, by id, such as `["anthropic", "manual"]`.
   * Defaults to all of them. See `PROVIDER_IDS` in `@goodfellow-cms/ai`.
   */
  providers?: string[];
  /**
   * Whether the AI assistant can add openly licensed photos from Openverse to
   * the media library when it has none that fit, which editors turn on or off
   * for each request. On by default; `false` turns it off for everyone.
   */
  stockPhotos?: boolean;
}

/**
 * Declares a site config with full type checking. Returns it with its
 * plugins' blocks and categories added to its own, and throws a
 * `PluginError` if a plugin is named wrongly or two blocks share a name.
 */
export function defineConfig<const T extends GoodfellowConfig>(config: T): T {
  return withPlugins(config);
}
