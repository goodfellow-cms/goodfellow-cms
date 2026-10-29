/**
 * React, as Client Components see it where a site's islands run with Preact
 * (`preact/compat`), with one difference: `useId()` starts with the island's
 * prefix, as React's `identifierPrefix` makes it, so two islands on a page
 * never give two elements the same id. Preact counts ids for each root, and
 * every island is a root of its own.
 */
import { createContext } from "preact";
import compat from "preact/compat";
import { useContext, useId as preactId } from "preact/hooks";

// @ts-ignore: its types are `export =`, which TypeScript won't re-export this way; the module itself is ESM
export * from "preact/compat";

/** The island's `useId()` prefix, given by `hydrateRoot()` in the browser and by `renderIsland()` on the server. */
export const IdPrefix = createContext("");

export function useId(): string {
  return useContext(IdPrefix) + preactId();
}

export default { ...compat, useId };
