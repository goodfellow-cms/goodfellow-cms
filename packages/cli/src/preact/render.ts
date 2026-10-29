/**
 * Renders an island with Preact where pages are built, as the browser will
 * bring it to life, so `useId()` gives the same ids on both sides. Loaded by
 * the build's Preact server (`preactIslands()`), where `react` is
 * `preact/compat`, with the island's own module.
 */
import { SiteProvider } from "@goodfellow-cms/react";
import { type ComponentType, h } from "preact";
import { renderToStringAsync } from "preact-render-to-string";
import { IdPrefix } from "./react.js";

/** Where content passed to the island goes, as `island()` marks it in the island's JSON props. */
export interface IslandSlots {
  /** The key that stands for content: `{ [marker]: "<slot id>" }`. */
  marker: string;
  /** The element the content is put in once the page is rendered (`fillSlots()`). */
  tag: string;
}

function decode(value: unknown, slots: IslandSlots): unknown {
  if (Array.isArray(value)) return value.map((item) => decode(item, slots));
  if (value && typeof value === "object") {
    const marker = (value as Record<string, unknown>)[slots.marker];
    // An empty slot, as React's renderer writes it, so `fillSlots()` finds it.
    if (typeof marker === "string") return h(slots.tag, { "data-gf-slot": marker, style: "display:contents" });
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, slots)]));
  }
  return value;
}

/** An island's HTML, as Preact renders it with the page's site and the island's `useId()` prefix. */
export function renderIsland(
  component: ComponentType<Record<string, unknown>>,
  props: Record<string, unknown>,
  site: unknown,
  prefix: string,
  slots: IslandSlots,
): Promise<string> {
  const element = h(component, decode(props, slots) as Record<string, unknown>);
  // biome-ignore lint/suspicious/noExplicitAny: the site's context value, as React's renderer gives it
  return Promise.resolve(renderToStringAsync(h(IdPrefix.Provider, { value: prefix }, h(SiteProvider as any, { value: site }, element))));
}
