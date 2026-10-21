/**
 * WordPress's blocks as they're saved: HTML with comments around each block,
 * `<!-- wp:image {"id":12} -->…<!-- /wp:image -->`, or `<!-- wp:spacer /-->`
 * for one with no HTML. WordPress's own parser is GPL-licensed, so this is a
 * parser of its own for the same format.
 */

/** One block, with the blocks inside it. */
export interface WordPressBlock {
  /** Its name with its namespace, such as `core/paragraph`; `core/freeform` for HTML between blocks. */
  name: string;
  attrs: Record<string, unknown>;
  innerBlocks: WordPressBlock[];
  /** Its own HTML, without its inner blocks'. */
  innerHTML: string;
  /** Its HTML in pieces, with `null` where each inner block goes. */
  innerContent: Array<string | null>;
}

const DELIMITER = /<!--\s+(\/)?wp:([a-z][a-z0-9_-]*(?:\/[a-z][a-z0-9_-]*)?)\s+(\{[\s\S]*?\}\s+)?(\/)?-->/g;

/** Whether content has block comments, as content saved by the block editor does. */
export function hasBlocks(content: string): boolean {
  return /<!--\s+wp:[a-z]/.test(content);
}

function fullName(name: string): string {
  return name.includes("/") ? name : `core/${name}`;
}

function parseAttrs(text: string | undefined): Record<string, unknown> {
  const json = text?.trim();
  if (!json?.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function freeform(html: string): WordPressBlock {
  return { name: "core/freeform", attrs: {}, innerBlocks: [], innerHTML: html, innerContent: [html] };
}

/**
 * Parses saved block content into blocks. HTML outside any block, such as a
 * classic post's, becomes `core/freeform` blocks; whitespace between blocks is
 * left out. A block that's never closed ends where its parent does.
 */
export function parseBlocks(content: string): WordPressBlock[] {
  const top: WordPressBlock[] = [];
  const stack: WordPressBlock[] = [];
  let last = 0;

  const addHtml = (html: string) => {
    const parent = stack.at(-1);
    if (parent) {
      parent.innerHTML += html;
      const previous = parent.innerContent.at(-1);
      if (typeof previous === "string") parent.innerContent[parent.innerContent.length - 1] = previous + html;
      else parent.innerContent.push(html);
    } else if (html.trim()) {
      top.push(freeform(html));
    }
  };
  const addBlock = (block: WordPressBlock) => {
    const parent = stack.at(-1);
    if (parent) {
      parent.innerBlocks.push(block);
      parent.innerContent.push(null);
    } else {
      top.push(block);
    }
  };

  for (const match of content.matchAll(DELIMITER)) {
    const [whole, closer, rawName, attrs, selfClosing] = match;
    const name = fullName(rawName ?? "");
    addHtml(content.slice(last, match.index));
    last = match.index + whole.length;
    if (closer) {
      // Close back to the block it names, closing any left open inside it.
      const at = stack.map((block) => block.name).lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) {
        const block = stack.pop();
        if (block) addBlock(block);
      }
      continue;
    }
    const block: WordPressBlock = { name, attrs: parseAttrs(attrs), innerBlocks: [], innerHTML: "", innerContent: [] };
    if (selfClosing) addBlock(block);
    else stack.push(block);
  }
  addHtml(content.slice(last));
  while (stack.length > 0) {
    const block = stack.pop();
    if (block) addBlock(block);
  }
  return top;
}

/** A block's whole HTML, with its inner blocks' put back where they go. */
export function blockHtml(block: WordPressBlock): string {
  let inner = 0;
  return block.innerContent
    .map((piece) => {
      if (piece !== null) return piece;
      const nested = block.innerBlocks[inner++];
      return nested ? blockHtml(nested) : "";
    })
    .join("");
}
