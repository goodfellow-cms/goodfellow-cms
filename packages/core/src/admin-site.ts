/**
 * What the admin panel's own page knows about a site. That page never loads the
 * site's config, whose blocks run only in frames of their own, so it gets this
 * instead, made where the config is: by `goodfellow build`, the dev servers, or
 * a Next.js server component (`adminSite()` in `@goodfellow-cms/react`).
 */
import type { AdminAddress } from "./admin-domain.js";
import type { AiConfig } from "./config.js";
import type { HostSource } from "./git.js";
import type { SiteDescription } from "./site-description.js";

export interface AdminSite {
  /** The site's blocks and their fields, as JSON. */
  description: SiteDescription;
  /** The git host the site is stored on, made again in the admin panel's page (`GitHost.source`). */
  backend?: HostSource;
  /** The config's `admin`. */
  admin?: AdminAddress;
  /** The config's `demo`. */
  demo?: boolean;
  /** The config's `ai`. */
  ai?: false | AiConfig;
  /** The config's `registries`. */
  registries?: Record<string, string>;
}
