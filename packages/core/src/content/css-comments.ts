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
 * `type("image/avif")`, aren't addresses, and `url()`s are read elsewhere;
 * one nested in another function, or in another `image-set()`, is read too.
 * It reads the CSS once, as browsers' tokens do: a string (which ends at its
 * quote or at a line break) or an escape is passed over whole, so
 * `content: "image-set("` opens nothing, an unquoted `url(…)` is one token to
 * its `)`, quotes and all, and an escaped parenthesis, as in `url(a\(b)`,
 * opens and closes nothing. Reading never goes back, and a pattern is tried
 * only at a letter that could start one, so the time it takes grows with the
 * CSS's length alone.
 */
export function cssImageSetStrings(text: string): string[] {
  const values: string[] = [];
  const imageSet = /image-set\(/iy;
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
  /** Where `pattern` matches at `at`, the position after it, or `undefined`. */
  const matchAt = (pattern: RegExp, at: number) => {
    pattern.lastIndex = at;
    return pattern.test(text) ? pattern.lastIndex : undefined;
  };
  // For each parenthesis open, whether `image-set(` opened it, so its strings are addresses.
  const open: boolean[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === '"' || char === "'") {
      const end = stringEnd(at);
      if (open.at(-1) === true) values.push(text.slice(at + 1, text.charAt(end - 1) === char ? end - 1 : end));
      at = end;
      continue;
    }
    if (char === "\\") {
      at += 2;
      continue;
    }
    const letter = char.toLowerCase();
    const afterUrl = letter === "u" ? matchAt(url, at) : undefined;
    if (afterUrl !== undefined) {
      // An unquoted address is one token to its ")".
      let end = afterUrl;
      while (end < text.length && text.charAt(end) !== ")") end += text.charAt(end) === "\\" ? 2 : 1;
      at = end + 1;
      continue;
    }
    const afterImageSet = letter === "i" ? matchAt(imageSet, at) : undefined;
    if (afterImageSet !== undefined) {
      open.push(true);
      at = afterImageSet;
      continue;
    }
    if (char === "(") open.push(false);
    else if (char === ")") open.pop();
    at += 1;
  }
  return values;
}
