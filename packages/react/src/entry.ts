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
import { asciiLower, decodeAttribute, isHtmlSpace, RAW_TEXT, rawTextEnd, tagEnd } from "./html-scan.js";
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

/** `element attribute` pairs whose address is code the page runs, or a base every other address is read from. */
const CODE_ADDRESSES = new Set(["base href", "embed src", "object data", "script src"]);

/** Elements whose markup browsers read by other rules, SVG's and MathML's, until their end. */
const FOREIGN = new Set(["svg", "math"]);

/**
 * Whether `next`, the first character written after `before`, carries on a character reference `before` ends with
 * but hasn't ended, as a digit carries on `&#5`, and `/` doesn't.
 */
function continuesReference(before: string, next: string): boolean {
  const reference = /&(#[xX][0-9a-fA-F]*|#[0-9]*|[a-zA-Z0-9]*)$/.exec(before)?.[1];
  if (reference === undefined || next === "") return false;
  if (/^#[xX]/.test(reference)) return /[0-9a-fA-F;]/.test(next);
  if (reference === "#") return /[0-9xX]/.test(next);
  if (reference.startsWith("#")) return /[0-9;]/.test(next);
  return reference === "" ? /[a-zA-Z0-9#]/.test(next) : /[a-zA-Z0-9;]/.test(next);
}

/** One attribute value's parts: the owners' text as written, and an item's values as they are. */
type ValuePart = { text: string; value: boolean };

/**
 * An attribute of a `tag` with the item's values in its value: none in an `on…` handler, `srcdoc`, or the address of
 * code the page runs, such as a script's, and, in another address that's followed or loaded, none where they help
 * spell its scheme and the address they make, whole, could run script.
 */
function attributeValue(tag: string, attribute: string, parts: ValuePart[]): string {
  const name = attribute.toLowerCase();
  const owners = () => parts.map((part) => (part.value ? "" : part.text)).join("");
  if (!parts.some((part) => part.value)) return owners();
  if (name.startsWith("on") || name === "srcdoc") return owners();
  if (CODE_ADDRESSES.has(`${tag.toLowerCase()} ${name}`)) return owners();
  // A script's type or language decides whether and how it runs, so no value does: a type a value goes in is
  // `text/plain`, which isn't script, and such a language `none`, which makes a script without a type `text/none`,
  // which isn't either; a type the owners wrote still decides, as it does over any language.
  if (tag.toLowerCase() === "script" && name === "type") return "text/plain";
  if (tag.toLowerCase() === "script" && name === "language") return "none";
  if (ADDRESS_ATTRIBUTES.has(name)) {
    // Read as the browser reads what's written, all of it at once, since a reference the owners start can end in a
    // value, as `javascript&#5` and `8;…` write `&#58;`, a colon.
    let written = "";
    let firstValue = -1;
    for (const part of parts) {
      const text = part.value ? escapeAttribute(part.text) : part.text;
      // An empty value counts too, since it joins what's around it, as `da{x}ta:` writes `data:`.
      if (part.value && firstValue === -1) {
        // A value that carries on a reference the owners started helps spell what it reads as.
        const before = continuesReference(written, text[0] ?? "") ? written.replace(/&[#a-z0-9]*$/i, "") : written;
        firstValue = decodeAttribute(before).length;
      }
      written += text;
    }
    const address = decodeAttribute(written);
    // The scheme is settled by the first character that ends it; a value before then helps spell it.
    const settled = address.search(/[:/?#]/);
    const spells = firstValue !== -1 && (settled === -1 || firstValue <= settled);
    if (spells && (!isSafeUrl(address) || isScriptUrl(address))) {
      // What the owners wrote around the value can join into a scheme of its own once it's left out.
      const without = owners();
      return isScriptUrl(decodeAttribute(without)) ? "" : without;
    }
  }
  return parts.map((part) => (part.value ? escapeAttribute(part.text) : part.text)).join("");
}

/**
 * HTML a block shows as it is, such as Custom HTML's, with an item's values put in where its placeholders are, each
 * by where it sits in the owners' HTML: escaped between tags and in attributes' values, and in an address that's
 * followed or loaded only where the whole address is a safe one. Where no escaping would keep a value from being
 * markup or script, in a tag outside an attribute's value, just after a `<` (written as text), an `on…` handler,
 * `srcdoc`, the address of a script, or a script or style, it's left out, as is every value after an `<svg>` or
 * `<math>`, whose markup browsers read by rules of their own; and no value decides whether a script runs.
 */
function fillHtml(text: string, values: Values): string {
  type State = "text" | "comment" | "bogus" | "tag" | "before" | "attribute" | "after" | "beforeValue" | "value";
  let state: State = "text";
  let out = "";
  let tag = "";
  let closing = false;
  let attribute = "";
  let quote = "";
  // Where in `out` the `<` that ends the text before it is, until a browser has read enough after it to know what it
  // starts: a tag, an end tag, a comment, or text.
  let opener = -1;
  // Where the comment being read starts, past its `<!--`, since `--!>` ends it only with dashes of its own.
  let commentBody = 0;
  // Once SVG or MathML starts, whose markup browsers read by other rules, such as `<title>` holding tags and
  // `<![CDATA[` running to `]]>`: following those rules here would be one more way to read it differently from a
  // browser, so no value goes in from there on.
  let foreign = false;
  // The attribute value being read, put into `out` whole once it ends.
  let parts: ValuePart[] = [];
  // Whether a value left empty was straight after an attribute's `=`: what follows it decides how the browser reads
  // the value, a quote opening a quoted one, and whitespace or a `>` leaving it empty, written `""` so the next
  // attribute isn't taken for it.
  let deferred = false;
  // Read through a function: `startValue()` sets it, which narrowing in the loop doesn't see.
  const inValue = () => state === "value";
  const startValue = (opening: string) => {
    state = "value";
    deferred = false;
    quote = opening;
    parts = [];
  };
  const endValue = () => {
    const value = attributeValue(tag, attribute, parts);
    // An unquoted value left empty is written `""`, or the browser would take what follows it for the value.
    out += !quote && value === "" ? '""' : value;
    parts = [];
  };
  /**
   * The text of a raw-text element, straight after its start tag, and its end tag: values escaped in a text area or
   * title, else none. It ends where a browser ends it in the text as written, values in, not as the owners wrote it:
   * leaving `{x}` out of `<!--<scr{x}ipt>` writes the `<script>` that keeps a script's next `</script>` in it, and
   * leaving it out of `</scr{x}ipt>` writes the end tag, which is read whole here, so none of it is read again as text.
   */
  // The next placeholder with a value at or after `aheadFrom`, kept between raw-text elements, so a page of many of
  // them, with its next value far after them, isn't searched to that value again for each one.
  const ahead = new RegExp(PLACEHOLDER.source, "g");
  let aheadFrom = -1;
  let aheadMatch: RegExpExecArray | null = null;
  const valueAfter = (from: number): RegExpExecArray | null => {
    if (aheadFrom !== -1 && aheadFrom <= from && (aheadMatch === null || aheadMatch.index >= from)) return aheadMatch;
    ahead.lastIndex = from;
    let found: RegExpExecArray | null;
    do found = ahead.exec(text);
    while (found && values.get(found[1] ?? "") === undefined);
    aheadFrom = from;
    aheadMatch = found;
    return found;
  };
  const rawText = () => {
    const name = tag.toLowerCase();
    const escapes = name === "textarea" || name === "title";
    let filled = "";
    // Where each run of the text as written starts, and where in the owners' text it came from.
    const runs: [number, number][] = [];
    let from = i;
    let match: RegExpExecArray | null = null;
    const nextValue = () => {
      match = valueAfter(from);
    };
    nextValue();
    // Filled a little at a time, twice as much each time, so a long document's text isn't filled once for each
    // element: what's written up to an end tag doesn't change with what's written after it.
    const fillTo = (length: number) => {
      while (filled.length < length && from < text.length) {
        const start = match ? match.index : text.length;
        const stop = Math.min(start, from + (length - filled.length));
        if (stop > from) {
          runs.push([filled.length, from]);
          filled += text.slice(from, stop);
          from = stop;
        }
        if (match && from === start) {
          const value = values.get(match[1] ?? "") ?? "";
          if (escapes) filled += escapeHtml(value);
          from = start + match[0].length;
          nextValue();
        }
      }
    };
    let close = -1;
    for (let length = 1024; ; length *= 2) {
      fillTo(length);
      const lower = asciiLower(filled);
      const end = rawTextEnd(lower, name, 0);
      if (end !== -1) close = tagEnd(lower, end + 2 + name.length);
      if (close !== -1 || from >= text.length) break;
    }
    if (close === -1) {
      out += filled;
      i = text.length;
      return;
    }
    out += filled.slice(0, close + 1);
    // The end tag's `>` is the owners' own, since no value written here holds one: it's in the last run starting by it.
    let run: [number, number] = [0, i];
    for (const candidate of runs) if (candidate[0] <= close) run = candidate;
    i = run[1] + (close + 1 - run[0]);
  };
  const endTag = () => {
    state = "text";
    if (!closing && FOREIGN.has(tag.toLowerCase())) foreign = true;
    if (!foreign && !closing && RAW_TEXT.has(tag.toLowerCase())) rawText();
  };
  const placeholder = new RegExp(PLACEHOLDER.source, "y");
  let i = 0;
  while (i < text.length) {
    placeholder.lastIndex = i;
    const match = placeholder.exec(text);
    const value = match ? values.get(match[1] ?? "") : undefined;
    if (match && value !== undefined && foreign) {
      i += match[0].length;
      continue;
    }
    if (match && value !== undefined) {
      // Not in a script's type or language, where any value, empty too, is written so it doesn't decide how it runs.
      const runs = tag.toLowerCase() === "script" && /^(?:type|language)$/i.test(attribute);
      if (state === "beforeValue" && value === "" && !runs) {
        deferred = true;
        i += match[0].length;
        continue;
      }
      if (state === "beforeValue") startValue("");
      // Just after a `<`, `<!`, `<!-`, `<?` or `</`, a value, or leaving it out, would decide what the `<` starts, such
      // as `<{x}img` an image's tag, or `<!-{x}-` a comment where the owners' HTML reads as one ending at the next `>`.
      // So it's left out, and the `<` written as text.
      if ((state === "text" || state === "bogus") && opener >= 0 && /^<(?:[?/]|!-?)?$/.test(out.slice(opener))) {
        out = `${out.slice(0, opener)}&lt;${out.slice(opener + 1)}`;
        state = "text";
      } else if (inValue()) parts.push({ text: value, value: true });
      else if (state === "text" || state === "comment" || state === "bogus") out += escapeHtml(value);
      i += match[0].length;
      continue;
    }
    const char = text[i] ?? "";
    i++;
    if (inValue()) {
      if (quote ? char === quote : isHtmlSpace(char)) {
        endValue();
        state = "before";
      } else if (!quote && char === ">") {
        endValue();
        out += char;
        endTag();
        continue;
      } else {
        const last = parts.at(-1);
        if (last && !last.value) last.text += char;
        else parts.push({ text: char, value: false });
        continue;
      }
      out += char;
      continue;
    }
    out += char;
    switch (state) {
      case "text":
        if (char !== "<") break;
        opener = out.length - 1;
        if (text.startsWith("!--", i)) {
          out += "!--";
          i += 3;
          state = "comment";
          commentBody = out.length;
        } else if (/[a-zA-Z]/.test(text[i] ?? "") || (text[i] === "/" && /[a-zA-Z]/.test(text[i + 1] ?? ""))) {
          closing = text[i] === "/";
          if (closing) {
            out += "/";
            i++;
          }
          tag = "";
          state = "tag";
        } else if (text[i] === "!" || text[i] === "?" || (text[i] === "/" && text[i + 1] !== ">")) {
          // `<!x>`, `<?x>` and `</ x>` are comments to the first >.
          state = "bogus";
        }
        break;
      case "comment":
        // `-->` ends a comment, as does a `>` straight after `<!--` or `<!---`, which ends in `-->` too; `--!>` does
        // only with dashes after the `<!--`, so `<!--!>` and `<!---!>` go on.
        if (char === ">" && (out.endsWith("-->") || (out.endsWith("--!>") && out.length - 4 >= commentBody))) {
          state = "text";
        }
        break;
      case "bogus":
        if (char === ">") state = "text";
        break;
      case "tag":
        // A tag's name ends at whitespace or a `/`, as `<script/x>` is a script.
        if (char === ">") endTag();
        else if (isHtmlSpace(char) || char === "/") state = "before";
        else tag += char;
        break;
      case "before":
        if (char === ">") endTag();
        else if (!isHtmlSpace(char) && char !== "/") {
          // Here, even an `=` starts an attribute's name.
          attribute = char;
          state = "attribute";
        }
        break;
      case "attribute":
        if (char === ">") endTag();
        else if (char === "=") {
          state = "beforeValue";
          deferred = false;
        }
        // A `/` ends the tag only before its `>`; anything else after it starts an attribute's name, even an `=`, as
        // in `<img x /="…">`, whose `="…` is an attribute's name, not `x`'s value.
        else if (char === "/") state = "before";
        else if (isHtmlSpace(char)) state = "after";
        else attribute += char;
        break;
      case "after":
        if (char === ">") endTag();
        else if (char === "=") {
          state = "beforeValue";
          deferred = false;
        } else if (char === "/") state = "before";
        else if (!isHtmlSpace(char)) {
          attribute = char;
          state = "attribute";
        }
        break;
      case "beforeValue":
        if (deferred && (char === ">" || isHtmlSpace(char))) {
          out = `${out.slice(0, -1)}""${char}`;
          deferred = false;
          if (char !== ">") {
            state = "before";
            break;
          }
        }
        if (char === ">") endTag();
        else if (char === '"' || char === "'") startValue(char);
        else if (!isHtmlSpace(char)) {
          out = out.slice(0, -1);
          startValue("");
          parts.push({ text: char, value: false });
        }
        break;
    }
  }
  if (inValue()) endValue();
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
