import { cx } from "./cx.js";
import type { SiteContextValue } from "./site-types.js";

export type ClassValue = string | false | null | undefined;

/**
 * A block's part's classes: its name (`gf-card-title`), then the block's own
 * classes, then the theme's for that part, then what an editor chose, such as
 * an alignment and the classes typed into "CSS classes", so a theme changes a
 * block's look and an editor's choices still win over it.
 */
export type PartClasses = (name: string, own?: ClassValue | ClassValue[], ...chosen: ClassValue[]) => string;

/** Gives parts the theme's classes (`theme.parts` in `content/site.json`). */
export function partClasses(parts: Readonly<Record<string, string>> | undefined): PartClasses {
  return (name, own, ...chosen) => cx(name, ...(Array.isArray(own) ? own : [own]), parts?.[name], ...chosen);
}

/** Builds `useParts` on a `useSite()`: the browser's, or the Server Components' version. */
export function createUseParts(useSite: () => SiteContextValue) {
  /**
   * The classes for a block's named parts, with the site's theme's for each.
   * Call it at the start of a block's `render` or a component it renders, as
   * you would `useSite()`, then give every part of the block its name:
   * `className={part("gf-heading", "text-balance", alignClasses[align], className)}`.
   */
  return function useParts(): PartClasses {
    return partClasses(useSite().settings?.theme?.parts);
  };
}
