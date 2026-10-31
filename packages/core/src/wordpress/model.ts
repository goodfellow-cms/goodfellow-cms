/**
 * A WordPress site as Goodfellow reads it, from an export file
 * (`readWordPressExport()`) or from the site's own address
 * (`fetchWordPressSite()`): its pages and posts, their categories and tags,
 * its menus and its media library.
 */

/** A WordPress site's content. */
export interface WordPressSite {
  title: string;
  /** Its tagline. */
  description: string;
  /** The site's address, such as `https://example.org` or `https://example.org/blog`, without a trailing slash. */
  url: string;
  /** Its language, such as `en-US`, where the source says. */
  language?: string;
  /** Pages and posts, whatever their status. */
  items: WordPressItem[];
  categories: WordPressTerm[];
  tags: WordPressTerm[];
  /** Menus, where the source has them: export files do, and sites' addresses don't. */
  menus?: WordPressMenu[];
  /** The media library. */
  media: WordPressMedia[];
  /** Reusable blocks' content, by id, which `<!-- wp:block {"ref":…} /-->` puts in place. */
  reusableBlocks: Record<number, string>;
  /**
   * Synced patterns' names and titles, by id: the reusable blocks WordPress keeps in step everywhere they're
   * placed, which pages place as synced blocks. Unsynced patterns are copied where they're put, so aren't here.
   */
  syncedPatterns?: Record<number, { name: string; title: string }>;
  /** What the source had that's never imported, such as comments or products, with how many. */
  other: Record<string, number>;
  /** Where it came from. */
  source: "export-file" | "address";
}

export type WordPressItemType = "page" | "post";

/** One page or post. */
export interface WordPressItem {
  id: number;
  type: WordPressItemType;
  /** `publish`, `future` (scheduled), `draft`, `pending`, `private`, `trash` and so on. */
  status: string;
  /** Plain text. */
  title: string;
  /** Its address's last part, as WordPress spells it (`%` codes decoded). */
  slug: string;
  /** Its full address on the WordPress site. */
  link: string;
  /** When it was published, in the site's own time: `YYYY-MM-DDTHH:MM`. */
  date: string;
  /** The page it's under, or 0. */
  parent: number;
  /** Its place among its siblings in WordPress's page order. */
  order: number;
  /** Its content: as saved, with block comments, from an export file, or as WordPress shows it, from an address. */
  content: string;
  /** Whether `content` is WordPress's shown HTML, without block comments or shortcodes. */
  rendered: boolean;
  /** A summary written for it, as HTML, or `""`. */
  excerpt: string;
  /** Its categories' and tags' slugs. */
  categories: string[];
  tags: string[];
  /** Its featured image's id in the media library. */
  image?: number;
}

/** A category or tag. */
export interface WordPressTerm {
  name: string;
  slug: string;
  /** The category it's under, by slug. */
  parent?: string;
  /** Its archive's address, where the source says. */
  link?: string;
}

/** A file in the media library. */
export interface WordPressMedia {
  id: number;
  url: string;
  title: string;
  /** Its description for people who can't see it. */
  alt: string;
  /** Its caption, as plain text. */
  caption: string;
}

export interface WordPressMenu {
  name: string;
  slug: string;
  items: WordPressMenuItem[];
}

export interface WordPressMenuItem {
  id: number;
  /** The item it's under, or 0. */
  parent: number;
  order: number;
  /** Its label, or `""` for the title of what it links to. */
  label: string;
  /** Its address, where it has one of its own. */
  url: string;
  /** What it links to, where it's something on the site rather than an address. */
  target?: { kind: "item" | "category" | "tag"; id: number };
}

/** Why a WordPress site couldn't be read. */
export type WordPressReadProblem =
  /** The file isn't a WordPress export file. */
  | "not-export-file"
  /** Nothing answered at the address, or its answer couldn't be read, such as when it doesn't allow other sites' requests. */
  | "unreachable"
  /** Something answered, but not WordPress's API. */
  | "not-wordpress";

export class WordPressReadError extends Error {
  override name = "WordPressReadError";

  constructor(
    readonly problem: WordPressReadProblem,
    message: string,
  ) {
    super(message);
  }
}

/** `2024-05-01 10:00:00` or `2024-05-01T10:00:00` → `2024-05-01T10:00`, or `""`. */
export function wordPressDate(text: string | undefined): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(text?.trim() ?? "");
  return match && match[1] !== "0000-00-00" ? `${match[1]}T${match[2]}` : "";
}

/** A slug as WordPress stores it, with `%` codes spelled out. */
export function decodedSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
