/**
 * A page's headings, which its table of contents (the On this page block)
 * lists and links to: each heading block's text and level, and a link name
 * of its own on the page, made from what the block says or its text.
 */
import { slugify } from "./changes.js";

export interface PageHeading {
  /** The heading block's id. */
  block: string;
  /** Its link name, unique on the page, which it carries as its `id` and links to it use after `#`. */
  anchor: string;
  text: string;
  /** 1 for a page's title, 2 for a section, and so on. */
  level: number;
}

/** What a heading block says about itself: its text, level and the link name an editor gave it, if any. */
export interface HeadingDetails {
  text: string;
  level: number;
  anchor?: string;
}

/** Link names for headings, each unique on the page: the name given, or else the text, made address-safe, numbered after the first. */
export function headingAnchors(
  headings: ReadonlyArray<{ block: string } & HeadingDetails>,
  taken: Iterable<string> = [],
): PageHeading[] {
  const used = new Set(taken);
  return headings.map(({ block, text, level, anchor }) => {
    const base = slugify(anchor?.trim() || text) || "section";
    let unique = base;
    for (let n = 2; used.has(unique); n++) unique = `${base}-${n}`;
    used.add(unique);
    return { block, anchor: unique, text: text.trim(), level };
  });
}
