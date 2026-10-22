"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { SiteContextValue } from "./site-types.js";

export type { SiteContextValue } from "./site-types.js";

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ value, children }: { value: SiteContextValue; children: ReactNode }) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Site settings, menus, collections and the current page. Must be used inside a Goodfellow page. */
export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) {
    throw new Error("useSite() was called outside a Goodfellow page. Render blocks with <PageBody> or <SiteProvider>.");
  }
  return value;
}

const CurrentPathContext = createContext<string | undefined>(undefined);

/**
 * The address of the page being shown, for blocks in a layout shared by every
 * page, such as Next.js's, which can't know it when it's rendered.
 */
export function CurrentPathProvider({ path, children }: { path: string; children: ReactNode }) {
  return <CurrentPathContext.Provider value={path}>{children}</CurrentPathContext.Provider>;
}

/** The address `CurrentPathProvider` gives, if a layout has one. */
export function useCurrentPath(): string | undefined {
  return useContext(CurrentPathContext);
}
