/**
 * What islands look like in a page's HTML, shared by the server, which writes
 * them, and the browser, which brings them to life.
 *
 * An island is one use of a Client Component in a page rendered without
 * Next.js: `<gf-island>` holds its HTML, the module and export it comes from,
 * and its props as JSON. Content a block passes to it, such as `children`, is
 * rendered on the server into `<gf-slot>` elements, which the browser keeps as
 * they are.
 */

export const ISLAND_TAG = "gf-island";
export const SLOT_TAG = "gf-slot";

/** The id of the `<script type="application/json">` holding the page's `useSite()`. */
export const SITE_DATA_ID = "gf-site";

/** Stands for content passed to a Client Component in its JSON props: `{ "$gfSlot": "<slot id>" }`. */
export const SLOT_MARKER = "$gfSlot";

/** The id of an island's slot `n`, also used to find its HTML. */
export function slotId(islandId: string, n: number): string {
  return `${islandId}.${n}`;
}

/** Turns a `useId()` value into one that's safe in attributes and selectors: letters, digits, underscores, and dashes only. */
export function domId(id: string): string {
  return Array.from(id, (char) => (/[A-Za-z0-9_]/.test(char) ? char : `-${char.codePointAt(0)}-`)).join("");
}

/** The `useId()` prefix inside an island, the same on the server and in the browser. */
export function identifierPrefix(islandId: string): string {
  return `${islandId}-`;
}
