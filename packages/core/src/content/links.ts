/**
 * Links in a site's content: finding them, for the site checks, and changing
 * them, for moves. Both walk content the same way, so every link the checks
 * find is one a move updates.
 *
 * A whole value is a link when its field is a single line of text, as links
 * and media fields are; elsewhere, such as rich text and HTML, links are found
 * in the HTML's `href`, `src` and `poster` attributes, and in Markdown bodies,
 * in Markdown's links and images. Values with a template's `{placeholder}`
 * are filled in for each item, so they're left alone.
 */
import type { ComponentConfig, Field } from "@puckeditor/core";
import type { Collection } from "./collections.js";
import { allPages, type SiteContent } from "./load.js";
import { markdownToHtml } from "./markdown.js";
import { FOOTER_FILE, HEADER_FILE, MENUS_FILE, REDIRECTS_FILE, RESERVED_PAGE_PATHS, SITE_FILE } from "./paths.js";
import type { MenuItem } from "./schemas.js";

type Blocks = Record<string, ComponentConfig> | undefined;

/** What to do with each link: return it to keep it, or another address in its place. */
export interface LinkVisitor {
  link(link: string): string;
  /** A Markdown body, which is Markdown's own to read. Defaults to changing its links with `link`. */
  markdown?(markdown: string): string;
}

/** Addresses on the site that aren't pages or media, which links aren't checked or moved. */
const NOT_PAGES = ["/calendars/", "/pagefind/", "/__goodfellow/"];

/** Where a link goes on the site, or `undefined` for a link elsewhere, or to a file only the build knows about. */
export function linkTarget(link: string): { kind: "page" | "media"; path: string } | undefined {
  const raw = link.trim().split("#")[0]?.split("?")[0] ?? "";
  if (!raw.startsWith("/") || raw.startsWith("//") || /\s/.test(raw)) return undefined;
  let path: string;
  try {
    path = decodeURI(raw);
  } catch {
    path = raw;
  }
  if (path.startsWith("/media/")) return path.length > "/media/".length ? { kind: "media", path } : undefined;
  if (NOT_PAGES.some((prefix) => path.startsWith(prefix))) return undefined;
  if (RESERVED_PAGE_PATHS.some((reserved) => path === reserved || path.startsWith(`${reserved}/`))) return undefined;
  // Other files, such as /favicon.ico or a feed, are the site's code's: only the build knows they're there.
  if (/\.[a-z0-9]+$/i.test(path.split("/").at(-1) ?? "")) return undefined;
  const trimmed = path.replace(/\/+$/, "");
  return { kind: "page", path: trimmed || "/" };
}

const ATTRIBUTE = /\b(href|src|poster)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;

/** The links an HTML string has, such as rich text's links and images, each through `link`. */
function mapHtml(html: string, link: (link: string) => string): string {
  if (!html.includes("<")) return html;
  return html.replace(ATTRIBUTE, (match, name: string, equals: string, double?: string, single?: string) => {
    const value = (double ?? single ?? "").replaceAll("&amp;", "&");
    const next = link(value);
    if (next === value) return match;
    const quote = double === undefined ? "'" : '"';
    return `${name}${equals}${quote}${next.replaceAll("&", "&amp;")}${quote}`;
  });
}

const INLINE_LINK = /(\]\(\s*<?)([^\s)>]+)/g;
const REFERENCE = /^(\s{0,3}\[[^\]]+\]:\s*<?)(\S+?)(?=>|\s|$)/;

/** The links in Markdown, `[text](/about)`, `![alt](/media/photo.jpg)` and `[name]: /about`, outside code. */
function mapMarkdown(markdown: string, link: (link: string) => string): string {
  let fence: string | undefined;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker?.startsWith(fence)) fence = undefined;
        return line;
      }
      if (marker) {
        fence = marker;
        return line;
      }
      const reference = REFERENCE.exec(line);
      if (reference) {
        const [whole, before = "", target = ""] = reference;
        return `${before}${link(target)}${line.slice(whole.length)}`;
      }
      // Code spans are left as they're written.
      return line
        .split(/(`+[^`]*`+)/)
        .map((part) =>
          part.startsWith("`") ? part : part.replace(INLINE_LINK, (_, open, target) => open + link(target)),
        )
        .join("");
    })
    .join("\n");
}

/** Whether a whole value is an address on the site, such as `/about` or `/media/photo.jpg`. */
export function isSiteAddress(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !/\s/.test(value);
}

/** A value with a template's `{placeholder}`, filled in for each item, which can't be read as written. */
function hasPlaceholder(value: string): boolean {
  return /\{[a-z][a-z0-9-]*\}/.test(value);
}

/** A text value that may be an address itself, or HTML with addresses in it. */
function mapText(value: string, whole: boolean, visitor: LinkVisitor): string {
  if (hasPlaceholder(value)) return value;
  if (whole && isSiteAddress(value)) return visitor.link(value);
  return mapHtml(value, visitor.link);
}

interface ComponentLike {
  type: string;
  props: Record<string, unknown>;
}

function isComponent(value: unknown): value is ComponentLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    typeof (value as { props?: unknown }).props === "object"
  );
}

function mapValue(value: unknown, field: Field | undefined, blocks: Blocks, visitor: LinkVisitor): unknown {
  // Without a field to say what it holds, a value is only searched for HTML links.
  if (typeof value === "string") return mapText(value, field?.type === "text", visitor);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (isComponent(item)) return mapComponent(item, blocks, visitor);
      if (field?.type === "array") return mapObject(item, field.arrayFields, blocks, visitor);
      return mapValue(item, undefined, blocks, visitor);
    });
  }
  if (typeof value === "object" && value !== null) {
    return mapObject(value, field?.type === "object" ? field.objectFields : undefined, blocks, visitor);
  }
  return value;
}

function mapObject(
  value: unknown,
  fields: Record<string, Field> | undefined,
  blocks: Blocks,
  visitor: LinkVisitor,
): unknown {
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapValue(item, fields?.[key], blocks, visitor)]),
  );
}

function mapComponent(component: ComponentLike, blocks: Blocks, visitor: LinkVisitor): ComponentLike {
  const fields = blocks?.[component.type]?.fields as Record<string, Field> | undefined;
  const props = Object.fromEntries(
    Object.entries(component.props).map(([key, value]) => [
      key,
      key === "id" || key === "className" ? value : mapValue(value, fields?.[key], blocks, visitor),
    ]),
  );
  return { ...component, props };
}

interface DataLike {
  root?: { props?: Record<string, unknown> };
  content?: unknown[];
}

/** Puck data with its links visited: its root's settings, such as a page's social image, and every block. */
function mapData<T extends DataLike>(data: T, blocks: Blocks, visitor: LinkVisitor): T {
  const props = data.root?.props;
  return {
    ...data,
    ...(data.root && {
      root: {
        ...data.root,
        ...(props && {
          props: Object.fromEntries(
            Object.entries(props).map(([key, value]) => [
              key,
              typeof value === "string" ? mapText(value, true, visitor) : value,
            ]),
          ),
        }),
      },
    }),
    ...(data.content && {
      content: data.content.map((item) => (isComponent(item) ? mapComponent(item, blocks, visitor) : item)),
    }),
  };
}

function mapEntryFields(
  collection: Collection,
  fields: Record<string, unknown>,
  visitor: LinkVisitor,
): Record<string, unknown> {
  const out = { ...fields };
  for (const field of collection.settings.fields) {
    const value = fields[field.name];
    if (typeof value !== "string" || value === "") continue;
    if (field.type === "link" || field.type === "image") {
      out[field.name] = isSiteAddress(value) ? visitor.link(value) : value;
    } else if (collection.settings.markdown?.body === field.name) {
      out[field.name] = visitor.markdown ? visitor.markdown(value) : mapMarkdown(value, visitor.link);
    } else {
      out[field.name] = mapHtml(value, visitor.link);
    }
  }
  return out;
}

function mapMenuItem(item: MenuItem, visitor: LinkVisitor): MenuItem {
  return {
    ...item,
    href: visitor.link(item.href),
    ...(item.children && { children: item.children.map((child) => mapMenuItem(child, visitor)) }),
  };
}

/**
 * The site with every link visited, and the files whose links changed. The
 * links each file has are visited together, in the order they're in, with
 * `file` saying which file they're in.
 */
export function mapSiteLinks(
  content: SiteContent,
  blocks: Blocks,
  visit: (file: string) => LinkVisitor,
): { content: SiteContent; files: string[] } {
  const files: string[] = [];
  const changed = <T>(file: string, before: T, after: T): T => {
    if (JSON.stringify(before) !== JSON.stringify(after)) files.push(file);
    return after;
  };
  const pages = content.pages.map((page) => {
    const visitor = visit(page.file);
    const data = mapData(page.content.data, blocks, visitor);
    return changed(page.file, page, { ...page, content: { ...page.content, data } });
  });
  const header = changed(HEADER_FILE, content.header, {
    ...content.header,
    data: mapData(content.header.data, blocks, visit(HEADER_FILE)),
  });
  const footer = changed(FOOTER_FILE, content.footer, {
    ...content.footer,
    data: mapData(content.footer.data, blocks, visit(FOOTER_FILE)),
  });
  const collections = content.collections.map((collection) => {
    const template = mapData(collection.settings.template, blocks, visit(collection.file));
    const settings = changed(collection.file, collection.settings, { ...collection.settings, template });
    const entries = collection.entries.map((entry) => {
      const fields = mapEntryFields(collection, entry.content.fields, visit(entry.file));
      return changed(entry.file, entry, { ...entry, content: { ...entry.content, fields } });
    });
    return { ...collection, settings, entries };
  });
  const menusVisitor = visit(MENUS_FILE);
  const menus = changed(
    MENUS_FILE,
    content.menus,
    Object.fromEntries(
      Object.entries(content.menus).map(([name, items]) => [
        name,
        items.map((item) => mapMenuItem(item, menusVisitor)),
      ]),
    ),
  );
  const { settings } = content;
  const settingsVisitor = visit(SITE_FILE);
  const media = (value: string | undefined) => (value ? settingsVisitor.link(value) : value);
  const site = changed(SITE_FILE, settings, {
    ...settings,
    ...(settings.favicon !== undefined && { favicon: media(settings.favicon) }),
    ...(settings.logo && {
      logo: {
        ...settings.logo,
        src: media(settings.logo.src) ?? settings.logo.src,
        ...(settings.logo.darkSrc !== undefined && { darkSrc: media(settings.logo.darkSrc) }),
      },
    }),
    ...(settings.socialImage !== undefined && { socialImage: media(settings.socialImage) }),
  });
  const redirectsVisitor = visit(REDIRECTS_FILE);
  const redirects =
    content.redirects &&
    changed(
      REDIRECTS_FILE,
      content.redirects,
      content.redirects.map((redirect) => ({ ...redirect, to: redirectsVisitor.link(redirect.to) })),
    );
  return {
    content: {
      ...content,
      pages,
      header,
      footer,
      collections,
      menus,
      settings: site,
      ...(redirects && { redirects }),
    },
    files,
  };
}

/** Every content file's links, by file. */
export function siteLinks(content: SiteContent, blocks?: Blocks): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const found = (file: string): LinkVisitor => {
    const add = (link: string) => {
      if (link !== "") links.set(file, [...(links.get(file) ?? []), link]);
      return link;
    };
    return {
      link: add,
      // Read as the site shows it, so links are found as Markdown sees them.
      markdown: (markdown) => {
        mapHtml(markdownToHtml(markdown), add);
        return markdown;
      },
    };
  };
  mapSiteLinks(content, blocks, found);
  return links;
}

/** An address that changes, such as a page moving from `/about` to `/about-us`. */
export interface AddressMove {
  from: string;
  to: string;
}

/**
 * The site with every link to moved addresses pointing at their new ones,
 * keeping each link's `?…` and `#…`, and the files whose links changed.
 * Addresses under a moved one, such as a list's `/news/page/2`, move with it,
 * unless they're pages of their own.
 */
export function relinkSite(
  content: SiteContent,
  moves: readonly AddressMove[],
  blocks?: Blocks,
): { content: SiteContent; files: string[] } {
  const moved = new Map(moves.filter((move) => move.from !== move.to).map((move) => [move.from, move.to]));
  if (moved.size === 0) return { content, files: [] };
  const staying = new Set(
    allPages(content)
      .map((page) => page.path)
      .filter((path) => !moved.has(path)),
  );
  const newAddress = (path: string): string | undefined => {
    const exact = moved.get(path);
    if (exact !== undefined) return exact;
    if (staying.has(path)) return undefined;
    for (const [from, to] of moved) {
      if (from !== "/" && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
    }
    return undefined;
  };
  const link = (value: string): string => {
    const target = linkTarget(value);
    const to = target?.kind === "page" ? newAddress(target.path) : undefined;
    if (to === undefined) return value;
    const rest = value.search(/[?#]/);
    return encodeURI(to) + (rest === -1 ? "" : value.slice(rest));
  };
  return mapSiteLinks(content, blocks, () => ({ link }));
}
