// Small rules about links that blocks share on the web and in apps.

import { type PageLink, pageTree } from "@goodfellow-cms/core";

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
