import type { ComponentConfig, Config } from "@puckeditor/core";
import type { AdminAddress } from "./admin-domain.js";
import type { GitHost } from "./git.js";

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
   * Turns the admin panel into a demo anyone can try without signing in. It
   * starts from the site's content as last built, and keeps each visitor's
   * changes in their own browser: nothing is ever published, and `backend` is
   * ignored. Builds include a copy of the site's content for it to read.
   */
  demo?: boolean;
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

/** Declares a site config with full type checking. Returns it unchanged. */
export function defineConfig<const T extends GoodfellowConfig>(config: T): T {
  return config;
}
