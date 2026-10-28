// Highlighted code as plain data, for apps, which can't show the Code block's HTML.

/** A run of code in one color. Dark colors are there where the site has dark mode. */
export interface CodeToken {
  text: string;
  color?: string;
  darkColor?: string;
}

/** Code as `highlightCode()` colored it: its lines, each a list of colored runs, and the block's own colors. */
export interface HighlightedCode {
  lines: CodeToken[][];
  /** Colors, or `undefined` where they're the page's (`var(--muted)`), as with `background: "site"`. */
  background?: string;
  darkBackground?: string;
  color?: string;
  darkColor?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A style attribute's declarations, by property. */
function declarations(style: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const declaration of style.split(";")) {
    const at = declaration.indexOf(":");
    if (at > 0) found[declaration.slice(0, at).trim().toLowerCase()] = declaration.slice(at + 1).trim();
  }
  return found;
}

/** Only plain colors: an app can't read the page's CSS variables. */
function plainColor(value: string | undefined): string | undefined {
  return value && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value) ? value : undefined;
}

function styleOf(tag: string): Record<string, string> {
  const style = /\sstyle="([^"]*)"/.exec(tag)?.[1];
  return style ? declarations(decode(style)) : {};
}

/**
 * The Code block's highlighted HTML (`highlightCode()`'s Shiki `<pre>`) as
 * lines of colored text, or nothing where it isn't such HTML. It reads only
 * the colors Shiki writes, and never runs or shows the HTML itself.
 */
export function highlightedCode(html: string | undefined): HighlightedCode | undefined {
  if (!html) return undefined;
  const pre = /<pre\b[^>]*>/i.exec(html);
  const start = html.indexOf("<code>");
  const end = html.lastIndexOf("</code>");
  if (!pre || start < 0 || end < start) return undefined;
  const own = styleOf(pre[0]);
  const lines: CodeToken[][] = [[]];
  // The colors of the spans the text is in, innermost last.
  const stack: Array<{ color?: string; darkColor?: string }> = [];
  const pattern = /<(\/?)span\b([^>]*)>|<[^>]*>|([^<]+)/gi;
  const body = html.slice(start + "<code>".length, end);
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const [, closing, attributes, text] = match;
    if (text !== undefined) {
      const color = [...stack].reverse().find((item) => item.color)?.color;
      const darkColor = [...stack].reverse().find((item) => item.darkColor)?.darkColor;
      decode(text)
        .split("\n")
        .forEach((piece, index) => {
          if (index > 0) lines.push([]);
          if (piece) lines.at(-1)?.push({ text: piece, ...(color && { color }), ...(darkColor && { darkColor }) });
        });
    } else if (attributes !== undefined) {
      if (closing) stack.pop();
      else {
        const style = styleOf(`<span${attributes}>`);
        const color = plainColor(style.color);
        const darkColor = plainColor(style["--shiki-dark"]);
        stack.push({ ...(color && { color }), ...(darkColor && { darkColor }) });
      }
    }
  }
  const background = plainColor(own["background-color"]);
  const darkBackground = plainColor(own["--shiki-dark-bg"]);
  const color = plainColor(own.color);
  const darkColor = plainColor(own["--shiki-dark"]);
  return {
    lines,
    ...(background && { background }),
    ...(darkBackground && { darkBackground }),
    ...(color && { color }),
    ...(darkColor && { darkColor }),
  };
}
