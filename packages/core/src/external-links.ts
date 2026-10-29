/** What a link that opens in a new tab gets: `noopener` so the new page can't control this one. */
export const NEW_TAB = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * Addresses that can't run code: the site's own, the web's, email and phone.
 * Anything with another scheme, such as `javascript:`, `data:` or `blob:`, isn't.
 */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^(?:https?:|mailto:|tel:)/i.test(trimmed)) return true;
  // No scheme at all: relative, root-relative or a fragment. Anything with a colon before the first slash has one.
  return !/^[^/?#]*:/.test(trimmed);
}

/** Schemes whose addresses run code, or show what's in them, wherever a link opens them. */
const SCRIPT_SCHEMES = new Set(["javascript", "vbscript", "data", "blob", "file"]);

/**
 * Whether an address would run code or show something of its own instead of
 * going somewhere: `javascript:`, `vbscript:`, `data:`, `blob:` and `file:`,
 * however it's spelled. Browsers leave out spaces, tabs, line breaks and
 * control characters before reading a scheme, and so does this. Links to
 * other kinds of addresses, such as `webcal:`, still work; rich text keeps
 * the stricter `isSafeUrl()`.
 */
export function isScriptUrl(url: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers leave control characters out of a scheme, so this does too
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\u0000-\u0020\u007f]/g, ""))?.[1];
  return scheme !== undefined && SCRIPT_SCHEMES.has(scheme.toLowerCase());
}

/**
 * Whether a link goes to another site: an `http` or `https` address that isn't
 * on the site's own address (`siteUrl`, such as `https://example.org`).
 * Root-relative links, `mailto:` and `tel:` links are the site's own or open an app.
 */
export function isExternalLink(href: string, siteUrl?: string): boolean {
  if (!/^https?:\/\//i.test(href.trim())) return false;
  if (!siteUrl) return true;
  try {
    return new URL(href.trim()).origin !== new URL(siteUrl).origin;
  } catch {
    return true;
  }
}

export interface LinkTargetOptions {
  /** Whether links to other sites open in a new tab. */
  newTab: boolean;
  /** The site's own address, whose links are never other sites'. */
  siteUrl?: string;
}

/**
 * Says where each link in rendered HTML, such as rich text, opens: links to
 * other sites in a new tab if `newTab` is set, and every other link in the same
 * tab. Puck's rich text would otherwise open every link in a new tab, marked
 * `nofollow`, including links to the site's own pages. Links that already say
 * where they open are left as they are.
 */
export function setLinkTargets(html: string, { newTab, siteUrl }: LinkTargetOptions): string {
  return html.replace(/<a\s[^<>]*>/gi, (tag) => {
    const href = /\shref="([^"]*)"/i.exec(tag)?.[1];
    if (href === undefined || /\starget=/i.test(tag)) return tag;
    const external = newTab && isExternalLink(decodeEntities(href), siteUrl);
    const rel = /\srel=/i.test(tag) ? "" : ` rel="${external ? NEW_TAB.rel : ""}"`;
    return `${tag.slice(0, -1)} target="${external ? NEW_TAB.target : "_self"}"${rel}>`;
  });
}

/** Decodes the entities addresses use, in one pass, so `&amp;#47;` stays `&#47;`. */
function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|#x2f|#47);/gi, (entity) => (entity.toLowerCase() === "&amp;" ? "&" : "/"));
}
