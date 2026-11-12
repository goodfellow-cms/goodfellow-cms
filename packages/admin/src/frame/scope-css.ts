/**
 * The site's CSS for the editor's frame, where Puck's own controls share the
 * page with the site's blocks: every rule is kept to the canvas, `.gf-canvas`,
 * and media queries on the page's width become container queries on the
 * canvas's, so previewing at a phone's width shows the phone layout.
 */

/** The element the site's CSS is kept to, which is also the container its width queries ask about. */
export const CANVAS_CLASS = "gf-canvas";
const CANVAS = `.${CANVAS_CLASS}`;
export const CANVAS_CONTAINER = "gf-canvas";

/** At-rules whose blocks hold rules like the top level's, which are kept to the canvas too. */
const GROUPS = new Set(["media", "supports", "layer", "container", "document", "starting-style"]);

/** Where `text` has a comment, string, or escape starting at `index`, the index just after it. */
function skipAtom(text: string, index: number): number {
  const char = text[index];
  if (char === "/" && text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (char === '"' || char === "'") {
    let at = index + 1;
    while (at < text.length && text[at] !== char) at += text[at] === "\\" ? 2 : 1;
    return at + 1;
  }
  if (char === "\\") return index + 2;
  return index;
}

/** Splits a selector list at its top-level commas. */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < list.length; at++) {
    const skipped = skipAtom(list, at);
    if (skipped !== at) {
      at = skipped - 1;
      continue;
    }
    const char = list[at];
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, at));
      start = at + 1;
    }
  }
  parts.push(list.slice(start));
  return parts;
}

/** The page itself, as selectors name it, which becomes the canvas: `:root`, `html`, `html > body` or `body`. */
const ROOT = /^(?:(?:html|:root|:host)(?![\w-])(?:\s*>?\s*body(?![\w-]))?|body(?![\w-]))/i;

/** Attributes, classes, and pseudo-classes on the page itself, such as `[data-gf-color-scheme="dark"]`. */
const QUALIFIERS = /^(?:\[[^\]]*\]|[.#][\w-]+|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)+/;

/** Pseudo-elements CSS still lets selectors write with one colon. */
const SINGLE_COLON = new Set(["before", "after", "first-line", "first-letter"]);

/** Where the name of letters, digits, `_` and `-` that ends just before `end` starts. */
function nameStart(text: string, end: number): number {
  let at = end;
  while (at > 0 && /[\w-]/.test(text.charAt(at - 1))) at -= 1;
  return at;
}

/**
 * Where the pseudo-element ending at `end` starts (`::marker`, `::part(x)`, or one of `SINGLE_COLON`'s
 * with one colon), or -1 for none.
 */
function pseudoElementBefore(text: string, end: number): number {
  if (text.charAt(end - 1) === ")") {
    // Its argument holds no ")", so its "(" comes after the ")" before this one: the first there that follows a name.
    const after = text.lastIndexOf(")", end - 2) + 1;
    for (let open = text.indexOf("(", after); open !== -1 && open < end - 1; open = text.indexOf("(", open + 1)) {
      const name = nameStart(text, open);
      if (name < open && text.startsWith("::", name - 2)) return name - 2;
    }
    return -1;
  }
  const name = nameStart(text, end);
  if (name === end) return -1;
  if (text.startsWith("::", name - 2)) return name - 2;
  return text.charAt(name - 1) === ":" && SINGLE_COLON.has(text.slice(name, end).toLowerCase()) ? name - 1 : -1;
}

/**
 * Where the pseudo-elements at the end of a selector start, which `:is()` can't hold, or its length for none.
 * They're read back from the end one at a time, so a long selector takes time in proportion to its length,
 * where a pattern would try again from each colon.
 */
function pseudoElementsStart(selector: string): number {
  let start = selector.length;
  for (let found = pseudoElementBefore(selector, start); found !== -1; found = pseudoElementBefore(selector, start)) {
    start = found;
  }
  return start;
}

/** One selector, kept to the canvas. */
export function scopeSelector(selector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return selector;
  const root = trimmed.match(ROOT);
  if (root) {
    // What's said about the page stays on it, where the editor's frame sets it too, such as light or dark.
    const rest = trimmed.slice(root[0].length);
    const qualifiers = rest.match(QUALIFIERS)?.[0] ?? "";
    return qualifiers ? `:root${qualifiers} ${CANVAS}${rest.slice(qualifiers.length)}` : `${CANVAS}${rest}`;
  }
  const pseudo = pseudoElementsStart(trimmed);
  const base = trimmed.slice(0, pseudo).trim();
  const after = trimmed.slice(pseudo);
  return base ? `${CANVAS} :is(${base})${after}` : `${CANVAS} ${after}`;
}

/** A media query on the page's width alone, as one on the canvas's, or `undefined` for any other. */
function widthQuery(prelude: string): string | undefined {
  const query = prelude
    .replace(/^@media\s+/i, "")
    .replace(/^(?:only\s+)?screen\s+and\s+/i, "")
    .trim();
  if (query.includes(",")) return undefined;
  const features = query.split(/\s+and\s+/i);
  const onWidth = features.every((feature) =>
    /^\(\s*(?:(?:min-|max-)?width\s*:[^()]+|[^()]*\bwidth\b[^()]*)\)$/i.test(feature.trim()),
  );
  return onWidth
    ? `@container ${CANVAS_CONTAINER} ${features.map((feature) => feature.trim()).join(" and ")}`
    : undefined;
}

type Context = "group" | "other";

/** The site's CSS, kept to the canvas. */
export function scopeCss(css: string): string {
  let out = "";
  const stack: Context[] = ["group"];
  // The text since the last rule or declaration ended, which a `{` makes a prelude.
  let start = 0;
  let at = 0;
  while (at < css.length) {
    const skipped = skipAtom(css, at);
    if (skipped !== at) {
      at = skipped;
      continue;
    }
    const char = css[at];
    if (char === "{") {
      const raw = css.slice(start, at);
      const lead = raw.match(/^\s*/)?.[0] ?? "";
      const prelude = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const context = stack[stack.length - 1];
      if (context === "group") {
        if (prelude.startsWith("@")) {
          const name =
            prelude
              .slice(1)
              .match(/^[\w-]+/)?.[0]
              ?.toLowerCase() ?? "";
          const container = name === "media" ? widthQuery(prelude) : undefined;
          out += `${lead}${container ?? prelude}{`;
          stack.push(GROUPS.has(name) ? "group" : "other");
        } else {
          out += `${lead}${splitList(prelude).map(scopeSelector).join(", ")}{`;
          stack.push("other");
        }
      } else {
        out += `${raw}{`;
        stack.push("other");
      }
      at += 1;
      start = at;
      continue;
    }
    if (char === "}" || char === ";") {
      if (char === "}" && stack.length > 1) stack.pop();
      out += css.slice(start, at + 1);
      at += 1;
      start = at;
      continue;
    }
    at += 1;
  }
  out += css.slice(start);
  // The canvas is the container width queries ask about; it also holds fixed elements, as a page would.
  return `${CANVAS}{container:${CANVAS_CONTAINER}/inline-size}\n${out}`;
}
