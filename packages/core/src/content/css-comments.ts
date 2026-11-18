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
 * `@import` and `url(`. Escapes of anything else (`\"`, `\)`, `\\`), and hex
 * ones that spell a quote, parenthesis, backslash or space, stay as they are.
 */
export function withCssEscapesWritten(css: string): string {
  return css.replace(CSS_ESCAPE, (whole, hex: string | undefined, letter: string | undefined) => {
    if (letter) return letter;
    if (!hex) return whole;
    const char = codePoint(hex);
    return KEPT_ESCAPED.test(char) ? whole : char;
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
 * Each reads on to its own `)` and reading goes on from there, so the time
 * it takes grows with the CSS's length alone.
 */
export function cssImageSetStrings(text: string): string[] {
  const values: string[] = [];
  const start = /image-set\(/gi;
  for (let match = start.exec(text); match; match = start.exec(text)) {
    let at = start.lastIndex;
    let depth = 0;
    while (at < text.length) {
      const char = text.charAt(at);
      if (char === '"' || char === "'") {
        let end = at + 1;
        while (end < text.length && text.charAt(end) !== char) end += text.charAt(end) === "\\" ? 2 : 1;
        if (depth === 0) values.push(text.slice(at + 1, end));
        at = end + 1;
        continue;
      }
      if (char === "(") depth += 1;
      else if (char === ")") {
        if (depth === 0) break;
        depth -= 1;
      }
      at += 1;
    }
    start.lastIndex = Math.max(at, start.lastIndex);
  }
  return values;
}
