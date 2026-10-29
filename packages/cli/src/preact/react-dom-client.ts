/**
 * `react-dom/client` where a site's islands run with Preact: `preact/compat`'s
 * roots, which take `identifierPrefix` as React's do (see `react.ts`).
 */
import { type ComponentChildren, h } from "preact";
import { hydrate, render, unmountComponentAtNode } from "preact/compat";
import { IdPrefix } from "./react.js";

interface RootOptions {
  identifierPrefix?: string;
}

function root(container: Element, prefix: string) {
  return {
    render(children: ComponentChildren) {
      render(h(IdPrefix.Provider, { value: prefix }, children), container);
    },
    unmount() {
      unmountComponentAtNode(container);
    },
  };
}

export function createRoot(container: Element, options: RootOptions = {}) {
  return root(container, options.identifierPrefix ?? "");
}

export function hydrateRoot(container: Element, children: ComponentChildren, options: RootOptions = {}) {
  const prefix = options.identifierPrefix ?? "";
  hydrate(h(IdPrefix.Provider, { value: prefix }, children), container);
  return root(container, prefix);
}

export default { createRoot, hydrateRoot };
