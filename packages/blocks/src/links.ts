// Small rules about links that blocks share on the web and in apps.

/** Whether a link is to the page shown, or to the section it's in. */
export function isCurrentLink(href: string, path: string): boolean {
  return href === path || (href !== "/" && path.startsWith(`${href}/`));
}

/** A phone number as a `tel:` link: digits and a leading plus only. */
export function phoneHref(phone: string): string {
  return `tel:${phone.replace(/(?!^\+)[^\d]/g, "")}`;
}
