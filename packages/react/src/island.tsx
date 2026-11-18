import {
  type ComponentType,
  createContext,
  createElement,
  isValidElement,
  type ReactNode,
  use,
  useContext,
  useId,
} from "react";
import { prerender } from "react-dom/static";
import { asciiLower, commentEnd, isHtmlSpace, RAW_TEXT, rawTextEnd, tagEnd } from "./html-scan.js";
import { domId, ISLAND_TAG, identifierPrefix, SLOT_MARKER, SLOT_TAG, slotId } from "./island-shared.js";
import { SiteProvider, useSite } from "./site-context.js";
import type { SiteContextValue } from "./site-types.js";

/** True inside an island's own HTML, where other Client Components are part of it rather than islands of their own. */
const InsideIsland = createContext(false);

/** A problem with what a block passes to a Client Component, which only plain values can cross. */
export class IslandPropsError extends Error {
  override name = "IslandPropsError";
}

interface Encoded {
  /** The props as they're written into the page, with content replaced by slot markers. */
  json: unknown;
  /** The props the island is rendered with on the server, with content replaced by empty slots. */
  props: Record<string, unknown>;
  /** Content passed to the island, rendered into its slots. */
  slots: Array<{ id: string; node: ReactNode }>;
}

function isContent(value: unknown): boolean {
  return isValidElement(value) || (Array.isArray(value) && value.some(isContent));
}

function describe(path: string[]): string {
  return path.length === 1 ? `its "${path[0]}" prop` : `"${path.join(".")}" in its props`;
}

/**
 * Splits a Client Component's props into JSON for the browser and content for
 * its slots. Throws for anything else, such as functions, which can't be sent
 * to the browser.
 */
function encodeProps(props: Record<string, unknown>, islandId: string, where: string): Encoded {
  const slots: Encoded["slots"] = [];

  const encode = (value: unknown, path: string[]): { json: unknown; prop: unknown } => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return { json: value, prop: value };
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw problem(path, "a number that isn't finite");
      return { json: value, prop: value };
    }
    // Content, including lists with content in them, becomes one slot, so lists keep their keys.
    if (isContent(value)) {
      const id = slotId(islandId, slots.length);
      slots.push({ id, node: value as ReactNode });
      return {
        json: { [SLOT_MARKER]: id },
        prop: createElement(SLOT_TAG, { "data-gf-slot": id, style: { display: "contents" } }),
      };
    }
    if (Array.isArray(value)) {
      const items = value.map((item, index) => encode(item === undefined ? null : item, [...path, String(index)]));
      return { json: items.map((item) => item.json), prop: items.map((item) => item.prop) };
    }
    if (
      typeof value === "object" &&
      (Object.getPrototypeOf(value) === Object.prototype || !Object.getPrototypeOf(value))
    ) {
      const json: Record<string, unknown> = {};
      const prop: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (item === undefined) continue;
        const encoded = encode(item, [...path, key]);
        json[key] = encoded.json;
        prop[key] = encoded.prop;
      }
      return { json, prop };
    }
    if (typeof value === "function") throw problem(path, "a function");
    throw problem(
      path,
      typeof value === "object" ? `a ${value.constructor?.name ?? "special"} object` : `a ${typeof value}`,
    );
  };

  const problem = (path: string[], what: string) =>
    new IslandPropsError(
      `${where} was given ${what} as ${describe(path)}. Client Components in blocks can only be given ` +
        "text, numbers, true or false, lists and objects of these, and content such as children.",
    );

  const json: Record<string, unknown> = {};
  const serverProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    // Refs belong to the server's copy of the component, which the browser replaces.
    if (value === undefined || key === "ref") continue;
    const encoded = encode(value, [key]);
    json[key] = encoded.json;
    serverProps[key] = encoded.prop;
  }
  return { json, props: serverProps, slots };
}

/** Each island's HTML, by its props, since React renders a component again after it waits. */
const rendered = new WeakMap<object, Promise<string>>();

/** What a renderer of islands other than React's is given for each island. */
export interface IslandToRender {
  /** The Client Component's module, by the name pages refer to it by (`blocks/installed/faq/faq-list.tsx`). */
  module: string;
  /** The export the island uses. */
  name: string;
  /** The props as they're written into the page, with content replaced by `{ [slots.marker]: "<slot id>" }`. */
  props: unknown;
  site: SiteContextValue;
  /** Its `useId()` prefix, the same the browser gives it. */
  prefix: string;
  /** Where content goes: an empty `<slots.tag data-gf-slot="<slot id>" style="display:contents">`. */
  slots: { marker: string; tag: string };
}

/** Renders an island's own HTML some other way than React's, such as with Preact. */
export type IslandRenderer = (island: IslandToRender) => Promise<string>;

let renderer: IslandRenderer | undefined;

/**
 * Has islands rendered by `render` instead of React, or by React again with
 * `undefined`. `goodfellow build` renders them with Preact where the browser
 * runs them with Preact, so both give the same ids.
 */
export function setIslandRenderer(render: IslandRenderer | undefined): void {
  renderer = render;
}

/** Renders an island's own HTML as its own React root, as the browser will, so `useId()` gives the same ids. */
async function renderIsland(component: ComponentType, props: object, site: SiteContextValue, id: string) {
  const element = (
    <SiteProvider value={site}>
      <InsideIsland.Provider value={true}>{createElement(component, props)}</InsideIsland.Provider>
    </SiteProvider>
  );
  const { prelude } = await prerender(element, {
    identifierPrefix: identifierPrefix(id),
    // Written whole, as pages are (`WHOLE_PAGE` in server.tsx).
    progressiveChunkSize: Number.MAX_SAFE_INTEGER,
  });
  return new Response(prelude).text();
}

/** Components made with `memo()`, `forwardRef()` and `lazy()`, which are objects rather than functions. */
const COMPONENT_OBJECTS = new Set([
  Symbol.for("react.memo"),
  Symbol.for("react.forward_ref"),
  Symbol.for("react.lazy"),
]);

/** Whether a module's export is a component. Others, such as contexts and constants, are left as they are. */
function isComponent(value: unknown): boolean {
  if (typeof value === "function") return true;
  const type = typeof value === "object" && value !== null ? (value as { $$typeof?: symbol }).$$typeof : undefined;
  return type !== undefined && COMPONENT_OBJECTS.has(type);
}

/**
 * Wraps a Client Component's export for pages rendered without Next.js
 * (`goodfellow build` and `goodfellow dev`). Where a block uses it, the page
 * gets an island: the component's HTML, plus what the browser needs to run it.
 * Inside another island it renders as it is. `goodfellow`'s Vite plugin wraps
 * the exports of `"use client"` modules in it where server-rendered modules
 * import them; nothing else calls it.
 */
export function island<T>(component: T, module: string, name: string): T {
  if (!isComponent(component)) return component;
  const Component = component as ComponentType<Record<string, unknown>>;
  const where = `The Client Component ${name} in ${module}`;

  function IslandRoot(props: Record<string, unknown>) {
    const id = domId(useId());
    const site = useSite();
    const encoded = encodeProps(props, id, where);
    let html = rendered.get(props);
    if (!html) {
      html = renderer
        ? renderer({
            module,
            name,
            props: encoded.json,
            site,
            prefix: identifierPrefix(id),
            slots: { marker: SLOT_MARKER, tag: SLOT_TAG },
          })
        : renderIsland(Component, encoded.props, site, id);
      rendered.set(props, html);
    }
    return (
      <>
        {createElement(ISLAND_TAG, {
          "data-gf-island": module,
          "data-gf-export": name,
          "data-gf-id": id,
          "data-gf-props": JSON.stringify(encoded.json),
          style: { display: "contents" },
          // biome-ignore lint/security/noDangerouslySetInnerHtml: React's own rendering of the component
          dangerouslySetInnerHTML: { __html: use(html) },
        })}
        {/* Moved into the island's slots once the page is rendered; see fillSlots(). */}
        {encoded.slots.map((slot) => createElement("template", { key: slot.id, "data-gf-slot": slot.id }, slot.node))}
      </>
    );
  }

  // A separate component, so that inside an island no extra useId() changes the ids the component's own children get.
  function Island(props: Record<string, unknown>) {
    return useContext(InsideIsland) ? <Component {...props} /> : <IslandRoot {...props} />;
  }

  // Keeps statics such as compound components (`Tabs.Item`) and the name React shows.
  if (typeof component === "function") Object.assign(Island, component);
  Object.defineProperty(Island, "name", { value: name });
  (Island as { displayName?: string }).displayName = (Component as { displayName?: string }).displayName ?? name;
  return Island as T;
}

/** Where in SVG and MathML a browser reads the content by HTML's rules again: their HTML integration points. */
const INTEGRATION_POINTS: Record<string, Set<string>> = {
  svg: new Set(["foreignobject", "desc", "title"]),
  math: new Set(["mi", "mo", "mn", "ms", "mtext"]),
};

/** Start tags that end SVG and MathML where they're met in them, as the standard's foreign content rules say. */
const BREAKS_OUT = new Set(
  (
    "b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu " +
    "meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var"
  ).split(" "),
);

/** A template React wrote for an island's content: exactly this, as `island()` renders it. */
const SLOT_TEMPLATE = /^<template data-gf-slot="([^"]+)">$/;

/**
 * Finds `<template data-gf-slot>` elements that aren't inside other templates, with their contents. The page holds
 * what the site's owners wrote as they wrote it (head and body code, Custom HTML used as written), so it's read as a
 * browser reads it (html-scan.ts), never by counting text that looks like a template: comments, bogus comments
 * (`<!x>`, `<?x>`), the content of elements whose content is text (`RAW_TEXT`), and attributes' values, end tags'
 * too, are passed over, and an end tag that closes nothing is text. Each character is read a bounded number of times,
 * however the page is written: a comment, element or tag that never ends ends the reading.
 */
function topLevelSlots(html: string) {
  const found: Array<{ id: string; start: number; end: number; inner: string }> = [];
  const lower = asciiLower(html);
  let depth = 0;
  let open: { id: string; start: number; innerStart: number } | undefined;
  // The SVG and MathML open, and the integration points open in them, innermost last: in SVG or MathML, a `<title>`
  // or `<textarea>` is an element like any other, whose content is markup.
  const foreign: Array<{ kind: "svg" | "math" | "html"; name: string }> = [];
  const inForeign = () => {
    const top = foreign.at(-1);
    return top !== undefined && top.kind !== "html";
  };
  let i = html.indexOf("<");
  while (i !== -1) {
    if (html.startsWith("<!--", i)) {
      const end = commentEnd(html, i);
      if (end === -1) break;
      i = html.indexOf("<", end);
      continue;
    }
    const closing = html[i + 1] === "/";
    const nameStart = closing ? i + 2 : i + 1;
    if (!/[a-z]/i.test(html[nameStart] ?? "")) {
      // `<!x>`, `<?x>` and `</ x>` are comments to the first >; `</>` is nothing; any other `<` is text.
      if (html[i + 1] === "!" || html[i + 1] === "?" || (closing && html[nameStart] !== ">")) {
        const end = html.indexOf(">", i + 2);
        if (end === -1) break;
        i = html.indexOf("<", end + 1);
      } else i = html.indexOf("<", i + 1);
      continue;
    }
    // A tag: its name, then its attributes to the > that ends it.
    let j = nameStart;
    while (j < html.length && !isHtmlSpace(html[j]) && html[j] !== "/" && html[j] !== ">") j++;
    const name = lower.slice(nameStart, j);
    const close = tagEnd(html, j);
    if (close === -1) break;
    const end = close + 1;
    if (closing) {
      const at = foreign.findLastIndex((frame) => frame.name === name);
      if (at !== -1) foreign.length = at;
      if (name === "template" && depth > 0) {
        depth--;
        if (depth === 0 && open) {
          found.push({ id: open.id, start: open.start, end, inner: html.slice(open.innerStart, i) });
          open = undefined;
        }
      }
      i = html.indexOf("<", end);
      continue;
    }
    const selfClosing = html[close - 1] === "/";
    if (inForeign() && BREAKS_OUT.has(name)) {
      while (inForeign()) foreign.pop();
    }
    if (inForeign()) {
      const top = foreign.at(-1);
      if (!selfClosing && (name === "svg" || name === "math")) foreign.push({ kind: name, name });
      else if (!selfClosing && top && INTEGRATION_POINTS[top.kind]?.has(name)) foreign.push({ kind: "html", name });
      i = html.indexOf("<", end);
      continue;
    }
    if (name === "svg" || name === "math") {
      if (!selfClosing) foreign.push({ kind: name, name });
      i = html.indexOf("<", end);
      continue;
    }
    if (RAW_TEXT.has(name)) {
      const textEnd = rawTextEnd(lower, name, end);
      if (textEnd === -1) break;
      i = textEnd;
      continue;
    }
    if (name === "template") {
      const id = SLOT_TEMPLATE.exec(html.slice(i, end))?.[1];
      if (depth === 0 && id) open = { id, start: i, innerStart: end };
      depth++;
    }
    i = html.indexOf("<", end);
  }
  return found;
}

/**
 * Moves content passed to islands into their slots, in a rendered page's HTML.
 * Content of slots a component didn't render stays in its `<template>`, for
 * the browser to use if the component shows it later.
 */
export function fillSlots(html: string): string {
  const templates = topLevelSlots(html);
  if (templates.length === 0) return html;

  const parts: string[] = [];
  let position = 0;
  for (const template of templates) {
    parts.push(html.slice(position, template.start));
    position = template.end;
  }
  parts.push(html.slice(position));
  let rest = parts.join("\u0000");

  const kept = new Map<number, string>();
  templates.forEach((template, index) => {
    const inner = fillSlots(template.inner);
    const empty = `<${SLOT_TAG} data-gf-slot="${template.id}" style="display:contents"></${SLOT_TAG}>`;
    if (rest.includes(empty)) {
      rest = rest
        .split(empty)
        .join(`<${SLOT_TAG} data-gf-slot="${template.id}" style="display:contents">${inner}</${SLOT_TAG}>`);
    } else {
      kept.set(index, `<template data-gf-slot="${template.id}">${inner}</template>`);
    }
  });

  return rest
    .split("\u0000")
    .map((part, index) => (index === 0 ? part : (kept.get(index - 1) ?? "") + part))
    .join("");
}
