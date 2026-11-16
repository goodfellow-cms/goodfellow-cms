import {
  type Collection,
  type Entry,
  entryTitle,
  formatFieldValue,
  isSafeUrl,
  isScriptUrl,
  itemTitleIn,
} from "@goodfellow-cms/core";
import type { ComponentData, Config, Data, Fields } from "@puckeditor/core";
import type { SiteContextValue } from "./site-types.js";

/** `{title}`, `{event-date}`: a field's name in braces. */
const PLACEHOLDER = /\{([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\}/g;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A value escaped for any attribute value, quoted with either quote or not at all: an unquoted value ends at
 * whitespace, and a backtick or `=` ends one in some browsers.
 */
function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/[`=\s]/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Attributes whose value is an address a browser follows or loads, so one of its own scheme could run script. */
const ADDRESS_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "codebase",
  "data",
  "formaction",
  "href",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "src",
  "xlink:href",
]);

/** Elements whose content is never markup, so no escaping keeps a value in them from being code. */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes", "noscript", "plaintext"]);

/**
 * HTML a block shows as it is, such as Custom HTML's, with an item's values put in where its placeholders are, each
 * by where it sits in the owners' HTML: escaped between tags and in attributes' values, and an address at the start
 * of one that's followed or loaded only where it's a safe one. Where no escaping would keep a value from being
 * markup or script, in a tag outside an attribute's value, an `on…` handler, `srcdoc`, or a script or style, it's
 * left out.
 */
function fillHtml(text: string, values: Values): string {
  type State = "text" | "comment" | "tag" | "attribute" | "afterAttribute" | "beforeValue" | "value" | "raw";
  let state: State = "text";
  let out = "";
  let tag = "";
  let closing = false;
  let attribute = "";
  let quote = "";
  // Whether the attribute's value so far is only spaces, for an address at its start.
  let atStart = true;
  const placeholder = new RegExp(PLACEHOLDER.source, "y");
  let i = 0;
  while (i < text.length) {
    placeholder.lastIndex = i;
    const match = placeholder.exec(text);
    const value = match ? values.get(match[1] ?? "") : undefined;
    if (match && value !== undefined) {
      if (state === "beforeValue") {
        state = "value";
        quote = "";
        atStart = true;
      }
      if (state === "text" || state === "comment") out += escapeHtml(value);
      else if (state === "value") {
        const name = attribute.toLowerCase();
        const unsafe =
          name.startsWith("on") ||
          name === "srcdoc" ||
          (ADDRESS_ATTRIBUTES.has(name) && atStart && (!isSafeUrl(value) || isScriptUrl(value)));
        if (!unsafe) out += escapeAttribute(value);
        if (value.trim() !== "") atStart = false;
      }
      i += match[0].length;
      continue;
    }
    const char = text[i] ?? "";
    out += char;
    i++;
    switch (state) {
      case "text":
        if (char === "<" && text.startsWith("!--", i)) {
          out += "!--";
          i += 3;
          state = "comment";
        } else if (char === "<" && /[a-zA-Z/]/.test(text[i] ?? "")) {
          closing = text[i] === "/";
          tag = "";
          state = "tag";
        }
        break;
      case "comment":
        if (char === ">" && out.endsWith("-->")) state = "text";
        break;
      case "tag":
        if (char === ">") state = RAW_TEXT.has(tag.toLowerCase()) && !closing ? "raw" : "text";
        else if (/\s/.test(char)) state = "afterAttribute";
        else if (char !== "/") tag += char;
        break;
      case "afterAttribute":
        if (char === ">") state = RAW_TEXT.has(tag.toLowerCase()) && !closing ? "raw" : "text";
        else if (char === "=") state = "beforeValue";
        else if (!/[\s/]/.test(char)) {
          attribute = char;
          state = "attribute";
        }
        break;
      case "attribute":
        if (char === ">") state = RAW_TEXT.has(tag.toLowerCase()) && !closing ? "raw" : "text";
        else if (char === "=") state = "beforeValue";
        else if (/[\s/]/.test(char)) state = "afterAttribute";
        else attribute += char;
        break;
      case "beforeValue":
        if (char === ">") state = RAW_TEXT.has(tag.toLowerCase()) && !closing ? "raw" : "text";
        else if (char === '"' || char === "'") {
          quote = char;
          atStart = true;
          state = "value";
        } else if (!/\s/.test(char)) {
          quote = "";
          atStart = false;
          state = "value";
        }
        break;
      case "value":
        if (quote ? char === quote : /\s/.test(char)) state = "afterAttribute";
        else if (!quote && char === ">") state = RAW_TEXT.has(tag.toLowerCase()) && !closing ? "raw" : "text";
        else if (!/\s/.test(char)) atStart = false;
        break;
      case "raw":
        if (char === "<" && text.slice(i, i + tag.length + 1).toLowerCase() === `/${tag.toLowerCase()}`) {
          closing = true;
          state = "tag";
          tag = "";
        }
        break;
    }
  }
  return out;
}

type Values = Map<string, string>;

/**
 * Whether a field holds HTML a block shows as it is, such as Custom HTML's,
 * marked `metadata: { html: true }`: an item's values go into it escaped, so
 * whoever writes an item never writes the page's markup.
 */
export function isHtmlField(field: unknown): boolean {
  const metadata = (field as { metadata?: unknown } | null | undefined)?.metadata;
  return typeof metadata === "object" && metadata !== null && (metadata as { html?: unknown }).html === true;
}

function fillText(text: string, values: Values, html: boolean): string {
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = values.get(name);
    if (value === undefined) return match;
    return html ? escapeHtml(value) : value;
  });
}

function fillValue(value: unknown, values: Values): unknown {
  if (typeof value === "string") return fillText(value, values, false);
  if (Array.isArray(value)) return value.map((item) => fillValue(item, values));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillValue(item, values)]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillProps(
  props: Record<string, unknown>,
  fields: Fields | undefined,
  values: Values,
  config: Config,
  nested = false,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => {
      if (key === "id" && !nested) return [key, value];
      const type = fields?.[key]?.type;
      if (type === "slot" && Array.isArray(value)) {
        return [key, value.map((child) => fillComponent(child as ComponentData, values, config))];
      }
      // Text a block shows as HTML, such as Custom HTML's, gets values by where each placeholder sits, never as
      // markup or script, and rich text gets them as text, before it's sanitized.
      if (isHtmlField(fields?.[key]) && typeof value === "string") return [key, fillHtml(value, values)];
      if (type === "richtext" && typeof value === "string") return [key, fillText(value, values, true)];
      // A list's rows and an object's settings follow their own fields, so rich text inside them is escaped too.
      const field = fields?.[key] as { arrayFields?: Fields; objectFields?: Fields } | undefined;
      if (type === "array" && Array.isArray(value) && field?.arrayFields) {
        const rows = field.arrayFields;
        return [
          key,
          value.map((row) => (isRecord(row) ? fillProps(row, rows, values, config, true) : fillValue(row, values))),
        ];
      }
      if (type === "object" && isRecord(value) && field?.objectFields) {
        return [key, fillProps(value, field.objectFields, values, config, true)];
      }
      return [key, fillValue(value, values)];
    }),
  );
}

function fillComponent(component: ComponentData, values: Values, config: Config): ComponentData {
  const definition = config.components[component.type];
  const fields = definition?.fields as Fields | undefined;
  const props = fillProps(component.props, fields, values, config);
  // A block that repeats for each entry fills its design with each of its own entries' values instead.
  const loop = entryLoop(definition);
  if (loop && loop.design in component.props) props[loop.design] = component.props[loop.design];
  return { ...component, props: props as ComponentData["props"] };
}

/**
 * Each field's value as it appears in place of its placeholder. Given the
 * site's `collections`, links to items show their titles.
 */
export function placeholderValues(
  collection: Collection,
  entry: Entry,
  language: string,
  timeZone?: string,
  collections?: readonly Collection[],
): Values {
  const itemTitle = collections ? itemTitleIn(collections) : undefined;
  return new Map(
    collection.settings.fields.map((field) => [
      field.name,
      formatFieldValue(field, entry.content.fields[field.name], language, timeZone, { itemTitle }),
    ]),
  );
}

/**
 * Fills an entry's values into its collection's template. Wherever the
 * template's text says `{name}` for one of the collection's fields, such as
 * `{title}` in a heading or `{video}` in a link, the entry's value goes in its
 * place. Values are plain text, escaped where the text is rich text or a block's
 * HTML (`isHtmlField()`). Text in
 * braces that isn't a field name is left as it is.
 */
export function applyEntry(
  data: Data,
  config: Config,
  collection: Collection,
  entry: Entry,
  language = "en",
  timeZone?: string,
  collections?: readonly Collection[],
): Data {
  const values = placeholderValues(collection, entry, language, timeZone, collections);
  const rootFields = config.root?.fields as Fields | undefined;
  return {
    ...data,
    root: { ...data.root, props: fillProps(data.root.props ?? {}, rootFields, values, config) },
    content: data.content.map((component) => fillComponent(component, values, config)),
    ...(data.zones && {
      zones: Object.fromEntries(
        Object.entries(data.zones).map(([zone, content]) => [
          zone,
          content.map((component) => fillComponent(component, values, config)),
        ]),
      ),
    }),
  };
}

// Blocks that repeat for each entry -------------------------------------------

const ENTRY_LOOP = Symbol.for("goodfellow.entryLoop");

/** The entry one of a repeating block's copies is for. */
export interface LoopItem {
  slug: string;
  title: string;
  /** The entry's page, if its collection gives entries pages. */
  path?: string;
}

/** How a block repeats the blocks it holds for each of a collection's entries. */
// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
export interface EntryLoop<Props = any> {
  /** The slot holding the blocks that repeat, as the editor designs them, with placeholders such as `{title}`. */
  design: string;
  /**
   * The slot their copies go into: for each entry, a block of the same kind
   * with `item` (a `LoopItem`) set, and the entry's values filled into a copy
   * of `design`.
   */
  items: string;
  /** The entries to repeat them for, in order, or `undefined` for none. */
  entries: (props: Props, site: SiteContextValue) => { collection: Collection; entries: Entry[] } | undefined;
}

/**
 * Makes a block repeat the blocks it holds once for each of a collection's
 * entries, with each entry's values filled in as in a collection's template.
 * The copies are made where pages are rendered (`preparePage()`), never in the
 * editor, so they're never saved.
 */
export function repeatsForEntries<T extends object>(component: T, loop: EntryLoop): T {
  return Object.assign(component, { [ENTRY_LOOP]: loop });
}

/** How a block repeats for each entry, if it does. */
export function entryLoop(component: unknown): EntryLoop | undefined {
  if (!component || typeof component !== "object") return undefined;
  return (component as { [ENTRY_LOOP]?: EntryLoop })[ENTRY_LOOP];
}

function isComponent(value: unknown): value is ComponentData {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ComponentData).type === "string" &&
    !!(value as ComponentData).props &&
    typeof (value as ComponentData).props === "object"
  );
}

/** A copy of blocks with ids of their own, so each copy's blocks can be told apart. */
function withIds(value: unknown, suffix: string): unknown {
  if (Array.isArray(value)) return value.map((item) => withIds(item, suffix));
  if (!isComponent(value)) return value;
  const props = Object.fromEntries(
    Object.entries(value.props).map(([key, item]) =>
      key === "id" ? [key, `${String(item)}-${suffix}`] : [key, Array.isArray(item) ? withIds(item, suffix) : item],
    ),
  );
  return { ...value, props };
}

function expandComponent(component: ComponentData, config: Config, site: SiteContextValue): ComponentData {
  const definition = config.components[component.type];
  const fields = definition?.fields as Fields | undefined;
  const loop = entryLoop(definition);
  const props: Record<string, unknown> = { ...component.props };
  // Blocks inside other blocks' slots can repeat too.
  for (const [key, field] of Object.entries(fields ?? {})) {
    if (field.type === "slot" && key !== loop?.items && Array.isArray(props[key])) {
      props[key] = (props[key] as ComponentData[]).map((child) => expandComponent(child, config, site));
    }
  }
  if (!loop || props.item) return { ...component, props: props as ComponentData["props"] };

  const found = loop.entries(props, site);
  const design = Array.isArray(props[loop.design]) ? (props[loop.design] as ComponentData[]) : [];
  props[loop.items] = (found?.entries ?? []).map((entry): ComponentData => {
    const values = placeholderValues(
      found?.collection as Collection,
      entry,
      site.settings.language,
      site.settings.timeZone,
      site.collections,
    );
    const item: LoopItem = { slug: entry.slug, title: entryTitle(entry), ...(entry.path && { path: entry.path }) };
    const copies = withIds(
      design.map((child) => fillComponent(child, values, config)),
      entry.slug,
    ) as ComponentData[];
    // Each copy has the block's settings, but not its classes, which are for the block as a whole.
    return {
      type: component.type,
      props: {
        ...props,
        id: `${String(props.id)}-${entry.slug}`,
        className: "",
        item,
        [loop.design]: copies,
        [loop.items]: [],
      },
    };
  });
  return { ...component, props: props as ComponentData["props"] };
}

/**
 * Makes the copies of blocks that repeat for each entry (see
 * `repeatsForEntries`), with each entry's values filled in.
 */
export function expandEntryLoops(data: Data, config: Config, site: SiteContextValue): Data {
  const expand = (content: ComponentData[]) => content.map((component) => expandComponent(component, config, site));
  return {
    ...data,
    content: expand(data.content),
    ...(data.zones && {
      zones: Object.fromEntries(Object.entries(data.zones).map(([zone, content]) => [zone, expand(content)])),
    }),
  };
}
