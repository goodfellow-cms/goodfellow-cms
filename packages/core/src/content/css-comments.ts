/**
 * CSS without its comments. Searching on from each comment's start, rather
 * than matching `/\/\*[\s\S]*?\*\//g`, keeps a comment that never ends from
 * taking time that grows with the square of the CSS's length. One that never
 * ends stays, so what it names is still listed.
 */
export function withoutCssComments(css: string): string {
  let result = "";
  let from = 0;
  for (let start = css.indexOf("/*"); start !== -1; start = css.indexOf("/*", from)) {
    const end = css.indexOf("*/", start + 2);
    if (end === -1) break;
    result += css.slice(from, start);
    from = end + 2;
  }
  return result + css.slice(from);
}

/** What an escape may not be written out as, since it would end a string or a `url(` early, or start another escape. */
const KEPT_ESCAPED = /["'()\\\s]/;

/**
 * CSS with the escapes that spell names written out, as browsers read them:
 * a code point in hex (`\69`, `\000069 `, taking one space after it) and a
 * backslash before any other letter, so `@\69mport` and `u\72l(` read as
 * `@import` and `url(`. Escapes of anything else (`\"`, `\)`, `\\`) stay as
 * they are, and hex ones that spell a quote, parenthesis, backslash or space
 * stay escaped, written with six digits.
 */
export function withCssEscapesWritten(css: string): string {
  return css.replace(CSS_ESCAPE, (whole, hex: string | undefined, letter: string | undefined) => {
    if (letter) return letter;
    if (!hex) return whole;
    const char = codePoint(hex);
    if (!KEPT_ESCAPED.test(char)) return char;
    // Six digits, CSS's most, so a letter or digit written out after it can't join it, keeping its space.
    return `\\${hex.padStart(6, "0")}${whole.slice(hex.length + 1)}`;
  });
}

/** A value with every escape written out, such as an address as browsers read it from CSS. */
export function cssUnescaped(value: string): string {
  return value.replace(CSS_ESCAPE, (_whole, hex: string | undefined, letter: string | undefined, other: string) =>
    hex ? codePoint(hex) : (letter ?? other),
  );
}

/** One of CSS's escapes: a code point in hex with the space after it, a letter, or any other character. */
const CSS_ESCAPE = /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([g-z])|([\s\S]))/gi;

/** The character a hex escape names, or U+FFFD for one CSS reads as none. */
function codePoint(hex: string): string {
  const code = Number.parseInt(hex, 16);
  return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "�" : String.fromCodePoint(code);
}

/**
 * The strings `image-set()` (and `-webkit-image-set()`) loads, which it reads
 * as addresses without a `url(`. Strings inside its own functions, such as
 * `type("image/avif")`, aren't addresses, and `url()`s are read elsewhere.
 * It reads the CSS once, as browsers' tokens do: a string or an escape
 * outside `image-set()` is passed over whole, so `content: "image-set("`
 * opens nothing (a string ends at its quote or at a line break), an unquoted `url(…)` is one token to its `)`, quotes and
 * all, and an escaped parenthesis, as in `url(a\(b)`, opens and closes
 * nothing. Reading never goes back, so the time it takes grows with the
 * CSS's length alone.
 */
export function cssImageSetStrings(text: string): string[] {
  const values: string[] = [];
  const start = /image-set\(/iy;
  // The lookahead takes the spaces too, or `url( "…")` would read as unquoted after none of them.
  const url = /url\((?!\s*["'])\s*/iy;
  /**
   * Where the string starting at `at` ends: after its closing quote, or at a
   * line break that isn't escaped, which ends a string in CSS too.
   */
  const stringEnd = (at: number) => {
    const quote = text.charAt(at);
    let end = at + 1;
    while (end < text.length) {
      const char = text.charAt(end);
      if (char === quote) return end + 1;
      if (char === "\n" || char === "\r" || char === "\f") return end;
      end += char === "\\" ? 2 : 1;
    }
    return end;
  };
  /** Where an unquoted `url(` at `at` ends, after its `)`, or `undefined` where none starts there. */
  const urlEnd = (at: number) => {
    url.lastIndex = at;
    if (!url.test(text)) return undefined;
    let end = url.lastIndex;
    while (end < text.length && text.charAt(end) !== ")") end += text.charAt(end) === "\\" ? 2 : 1;
    return end + 1;
  };
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '"' || char === "'") {
      at = stringEnd(at);
      continue;
    }
    if (char === "\\") {
      at += 2;
      continue;
    }
    const outerUrl = urlEnd(at);
    if (outerUrl !== undefined) {
      at = outerUrl;
      continue;
    }
    start.lastIndex = at;
    if (!start.test(text)) {
      at += 1;
      continue;
    }
    at = start.lastIndex;
    let depth = 0;
    while (at < text.length) {
      const inner = text.charAt(at);
      if (inner === '"' || inner === "'") {
        const end = stringEnd(at);
        if (depth === 0) values.push(text.slice(at + 1, text.charAt(end - 1) === inner ? end - 1 : end));
        at = end;
        continue;
      }
      if (inner === "\\") {
        at += 2;
        continue;
      }
      const innerUrl = urlEnd(at);
      if (innerUrl !== undefined) {
        at = innerUrl;
        continue;
      }
      at += 1;
      if (inner === "(") depth += 1;
      else if (inner === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
    }
  }
  return values;
}
