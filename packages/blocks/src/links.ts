// Small rules about links that blocks share on the web and in apps.

import { type MenuItem, type PageLink, pageTree } from "@goodfellow-cms/core";

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
