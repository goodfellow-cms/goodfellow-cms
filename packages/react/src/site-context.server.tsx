import { cache, type ReactNode } from "react";
import { browserSite } from "./browser-site.js";
// A Client Component module ("use client"): Next.js passes the site to the browser for client components in blocks.
import { SiteProvider as ClientSiteProvider } from "./site-context.js";
import type { SiteContextValue } from "./site-types.js";

export type { SiteContextValue } from "./site-types.js";

/**
 * Server Components have no context, so the site is kept in React's
 * per-request cache instead: each page rendered on the server gets its own.
 */
const current = cache((): { value: SiteContextValue | null } => ({ value: null }));

/**
 * Makes the site available to blocks rendered as Server Components, and to
 * the Client Components inside them, which get it through React context,
 * without what's for members only (`browserSite()`), since Next.js sends it
 * to the browser.
 */
export function SiteProvider({ value, children }: { value: SiteContextValue; children: ReactNode }) {
  current().value = value;
  return <ClientSiteProvider value={browserSite(value)}>{children}</ClientSiteProvider>;
}

/**
 * Makes `site` the one `useSite()` returns until another is set. Next.js renders
 * its "not found" page in the same request as every other page, so each block
 * sets its own page's site just before rendering: a block and the components
 * it renders run in one go, so they always see their own page.
 */
export function setSite(site: SiteContextValue): void {
  current().value = site;
}

/** Site settings, menus, collections, and the current page. Must be used inside a Goodfellow page. */
export function useSite(): SiteContextValue {
  const { value } = current();
  if (!value) {
    throw new Error("useSite() was called outside a Goodfellow page. Render blocks with <PageBody> or <SiteProvider>.");
  }
  return value;
}
