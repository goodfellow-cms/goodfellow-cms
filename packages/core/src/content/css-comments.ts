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
