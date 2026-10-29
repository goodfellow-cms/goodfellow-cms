// Small rules about links that blocks share on the web and in apps.

import {
  type Breadcrumbs,
  breadcrumbs,
  type Entry,
  entryTitle,
  type MenuItem,
  type PageLink,
  type PageView,
  pageTree,
} from "@goodfellow-cms/core";

/** Whether a link is to the page shown, or to the section it's in. */
export function isCurrentLink(href: string, path: string): boolean {
  return href === path || (href !== "/" && path.startsWith(`${href}/`));
}

/** A phone number as a `tel:` link: digits and a leading plus only. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/(?!^\+)[^\d]/g, "")}`;
}

/**
 * The pages directly under a menu link's page, as links, for menus that show
 * them as another level: a section's pages need no menu entries of their own.
 * None for the home page, or for links elsewhere.
 */
export function subpageLinks(href: string, pages: PageLink[] | undefined): Array<{ label: string; href: string }> {
  if (!href.startsWith("/") || href.startsWith("//") || href === "/" || !pages) return [];
  const path = href.split(/[?#]/)[0]?.replace(/\/$/, "") ?? "";
  return path ? pageTree(pages, path).map((page) => ({ label: page.title, href: page.path })) : [];
}

/** When a Menu shows its links behind a button: never, below one of Tailwind's breakpoints, or always. */
export type MenuButton = "never" | "sm" | "md" | "lg" | "always";

/**
 * Whether a menu has links under its links (and so, with `subpages`, the pages
 * under them too). Across a page, they open when the pointer is over them,
 * which phones and tablets don't have, so such menus need the menu button there.
 */
export function hasSubmenus(items: MenuItem[]): boolean {
  return items.some((item) => (item.children?.length ?? 0) > 0);
}

export type BreadcrumbSeparator = "chevron" | "slash" | "arrow";

/** What goes between breadcrumbs, for each choice. */
export const BREADCRUMB_SEPARATORS: Record<BreadcrumbSeparator, string> = { chevron: "›", slash: "/", arrow: "→" };

/**
 * The Breadcrumbs block's way to the page shown, from what the site's context
 * says about it, with the home page called `homeLabel` where that isn't empty.
 */
export function pageBreadcrumbs(
  site: { pages?: PageLink[]; path: string; home?: string; entry?: Entry; view?: PageView },
  homeLabel: string,
): Breadcrumbs {
  // The header and footer of a Next.js site are shared between pages, so they don't know the page.
  if (!site.path) return { links: [], current: "" };
  const home = site.home ?? "/";
  const trail = breadcrumbs(site.pages ?? [], {
    path: site.path,
    home,
    title: site.entry ? entryTitle(site.entry) : undefined,
    view: site.view,
  });
  const label = homeLabel.trim();
  if (!label) return trail;
  return { ...trail, links: trail.links.map((link) => (link.path === home ? { ...link, title: label } : link)) };
}
