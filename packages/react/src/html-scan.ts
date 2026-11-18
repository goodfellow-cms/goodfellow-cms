// How browsers split HTML into tags, comments and text, as far as Goodfellow's own readers of rendered and owners'
// HTML need it (`fillHtml()` in entry.ts and `fillSlots()` in island.tsx): the HTML standard's tokenizer, not
// patterns, so markup that only looks like a tag, or a tag that doesn't look like one, is read the browser's way.

/** HTML's whitespace, which ends tag names and unquoted values: never others, such as U+00A0, which don't. */
export const isHtmlSpace = (char: string | undefined): boolean =>
  char === " " || char === "\t" || char === "\n" || char === "\f" || char === "\r";

/** ASCII letters in lowercase and the rest as they are, so every character stays where it was. */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** Elements whose content is text, never markup, until their own end tag. */
export const RAW_TEXT = new Set([
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "noscript",
  "plaintext",
]);

/** Whether an end tag `</name` at `at` in `lower` is one: followed by whitespace, `/` or `>`. */
function endTagAt(lower: string, name: string, at: number): boolean {
  if (!lower.startsWith(`</${name}`, at)) return false;
  const after = lower[at + name.length + 2];
  return isHtmlSpace(after) || after === "/" || after === ">";
}

/**
 * Where the text of a raw-text element `name` that starts at `from` ends: the start of its end tag, or -1 where it
 * never does (always for `plaintext`). A script's end tag ends it only outside a comment's `<script>`, as the
 * standard's script states say: `<!--<script>` … `</script>` inside a script is still the script.
 */
export function rawTextEnd(lower: string, name: string, from: number): number {
  if (name === "plaintext") return -1;
  if (name !== "script") {
    for (let at = lower.indexOf(`</${name}`, from); at !== -1; at = lower.indexOf(`</${name}`, at + 1)) {
      if (endTagAt(lower, name, at)) return at;
    }
    return -1;
  }
  let state: "data" | "escaped" | "double" = "data";
  for (let i = from; i < lower.length; ) {
    if (state === "data" && lower.startsWith("<!--", i)) {
      state = "escaped";
      i += 4;
      // Dashes and a > straight after end it again: `<!-->`, `<!--->`.
      while (lower[i] === "-") i++;
      if (lower[i] === ">") {
        state = "data";
        i++;
      }
      continue;
    }
    if (state !== "data" && lower.startsWith("-->", i)) {
      state = "data";
      i += 3;
      continue;
    }
    if (endTagAt(lower, "script", i)) {
      if (state !== "double") return i;
      state = "escaped";
      i += "</script".length;
      continue;
    }
    if (state === "escaped" && lower.startsWith("<script", i)) {
      const after = lower[i + "<script".length];
      if (isHtmlSpace(after) || after === "/" || after === ">") {
        state = "double";
        i += "<script".length;
        continue;
      }
    }
    i++;
  }
  return -1;
}

/** Where a comment whose `<!--` starts at `start` ends, past its `-->` or `--!>`, or -1 where it never does. */
export function commentEnd(html: string, start: number): number {
  // `<!-->` and `<!--->` end at once: their dashes are the end's. Past them, only dashes after the `<!--` end it, so
  // `<!--!>` and `<!---!>` go on.
  if (html[start + 4] === ">") return start + 5;
  if (html[start + 4] === "-" && html[start + 5] === ">") return start + 6;
  for (let at = html.indexOf("--", start + 4); at !== -1; at = html.indexOf("--", at + 1)) {
    if (html[at + 2] === ">") return at + 3;
    if (html[at + 2] === "!" && html[at + 3] === ">") return at + 4;
  }
  return -1;
}

/**
 * The `>` that ends a tag whose attributes start at `from`, or -1 where it never ends: attribute names, and values
 * quoted only straight after an `=` or unquoted to whitespace or `>`, as the standard's attribute states read them.
 */
export function tagEnd(html: string, from: number): number {
  return readTag(html, from).end;
}

/**
 * How the tag whose attributes start at `from` ends: the `>` that ends it, or -1, and whether it's written
 * self-closing, with a `/` straight before that `>` outside any value, as `<svg/>` and `<svg a=x />` are and
 * `<svg a=x/>`, whose `/` is the value's, isn't.
 */
export function readTag(html: string, from: number): { end: number; selfClosing: boolean } {
  let state: "before" | "name" | "after" | "beforeValue" | "unquoted" = "before";
  for (let j = from; j < html.length; j++) {
    const char = html[j];
    switch (state) {
      case "before":
        if (char === ">") return { end: j, selfClosing: j > from && html[j - 1] === "/" };
        if (!isHtmlSpace(char) && char !== "/") state = "name";
        break;
      case "name":
        if (char === ">") return { end: j, selfClosing: false };
        if (char === "=") state = "beforeValue";
        // After a `/`, even an `=` starts an attribute's name.
        else if (char === "/") state = "before";
        else if (isHtmlSpace(char)) state = "after";
        break;
      case "after":
        if (char === ">") return { end: j, selfClosing: false };
        if (char === "=") state = "beforeValue";
        else if (char === "/") state = "before";
        else if (!isHtmlSpace(char)) state = "name";
        break;
      case "beforeValue":
        if (isHtmlSpace(char)) break;
        if (char === '"' || char === "'") {
          const close = html.indexOf(char, j + 1);
          if (close === -1) return { end: -1, selfClosing: false };
          j = close;
          state = "before";
        } else if (char === ">") return { end: j, selfClosing: false };
        else state = "unquoted";
        break;
      case "unquoted":
        if (char === ">") return { end: j, selfClosing: false };
        if (isHtmlSpace(char)) state = "before";
        break;
    }
  }
  return { end: -1, selfClosing: false };
}

/**
 * The attributes of a tag whose attributes start at `from` and that `end`s (its `>`, from `readTag()`), by their
 * names in lowercase, each with its value as written, the first of each name only, as browsers keep them.
 */
export function tagAttributes(html: string, from: number, end: number): Map<string, string> {
  const found = new Map<string, string>();
  let j = from;
  while (j < end) {
    while (j < end && (isHtmlSpace(html[j]) || html[j] === "/")) j++;
    if (j >= end) break;
    // A name's first character may be an `=`; after it, an `=` ends the name.
    let nameEnd = j + 1;
    while (nameEnd < end && !isHtmlSpace(html[nameEnd]) && html[nameEnd] !== "/" && html[nameEnd] !== "=") nameEnd++;
    const name = asciiLower(html.slice(j, nameEnd));
    let k = nameEnd;
    while (k < end && isHtmlSpace(html[k])) k++;
    let value = "";
    j = nameEnd;
    if (html[k] === "=") {
      k++;
      while (k < end && isHtmlSpace(html[k])) k++;
      const quote = html[k];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, k + 1);
        value = html.slice(k + 1, close);
        j = close + 1;
      } else {
        let valueEnd = k;
        while (valueEnd < end && !isHtmlSpace(html[valueEnd])) valueEnd++;
        value = html.slice(k, valueEnd);
        j = valueEnd;
      }
    }
    if (!found.has(name)) found.set(name, value);
  }
  return found;
}

/** The named references that spell what ends an address's scheme, as browsers read them in attributes. */
const NAMED: Record<string, string> = {
  colon: ":",
  sol: "/",
  quest: "?",
  num: "#",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  Tab: "\t",
  NewLine: "\n",
};

/**
 * Owners' text in an attribute's value as a browser reads it, as far as an address's scheme goes: numeric references,
 * and the named ones that spell what ends a scheme. Others stay as they're written, which reads as no scheme at all
 * only where it really is one, so the check is stricter, never looser.
 */
export function decodeAttribute(text: string): string {
  return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (whole, hex: string, decimal: string, name: string) => {
    if (name !== undefined) return NAMED[name] ?? whole;
    const code = hex !== undefined ? Number.parseInt(hex, 16) : Number(decimal);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
  });
}
