/**
 * HTML pasted into an editor as the site's blocks, with the WordPress
 * import's conversion (`itemParts()`, `partBlocks()`), for editor plugins
 * such as Gutenberg's: WordPress's block markup, which copying from its
 * editor gives, by its blocks, and any other HTML by its elements and
 * WordPress's class names. Scripts and anything else that would run code are
 * left out, as an import leaves them out.
 */
import { isSafeUrl } from "../content/markdown.js";
import { hasBlocks } from "./blocks.js";
import { type ConversionNote, type ConvertContext, itemParts } from "./convert.js";
import { type BlockData, BlockWriter, partBlocks } from "./page-blocks.js";

export interface HtmlBlocksOptions {
  /**
   * The site's blocks. Those of `WORDPRESS_BLOCKS` it doesn't have come
   * across as the blocks it does would show them, such as a table as text.
   * Every one without it.
   */
  blocks?: readonly string[];
  /** A link's address as the site keeps it. Without it, links stay as they are, and unsafe ones become `""`. */
  link?: (address: string) => string;
  /** A picture's or other file's address as the site keeps it, such as one copied into the media library. */
  media?: (address: string) => string;
  /**
   * What the new blocks' ids are made of, `<type>-<prefix>-<count>`, so they
   * can't be ids already on the page: different each time without it.
   */
  prefix?: string;
}

export interface HtmlBlocks {
  /** The blocks, without a Section around them, for wherever they're pasted. */
  blocks: BlockData[];
  /** What couldn't come across as it was, each once. */
  notes: ConversionNote[];
}

/** Keeps addresses as they are, but ones that could run code, which become `""`. */
function keptLink(address: string): string {
  const text = address.trim();
  return text.startsWith("#") || isSafeUrl(text) ? text : "";
}

function randomPrefix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `paste-${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Pasted HTML as the site's blocks. */
export function htmlBlocks(html: string, options: HtmlBlocksOptions = {}): HtmlBlocks {
  const notes = new Set<ConversionNote>();
  const link = options.link ?? keptLink;
  const context: ConvertContext = {
    link,
    media: options.media ?? ((address) => link(address)),
    // Pasted content has no attachments or reusable blocks to look up.
    attachment: () => undefined,
    reusable: () => undefined,
    note: (note) => notes.add(note),
  };
  // Block markup by its blocks; anything else as a page shows it, since pasted HTML has no shortcodes to expand.
  const parts = itemParts({ content: html, rendered: !hasBlocks(html) }, context);
  const blocks = partBlocks(parts, new BlockWriter(options.prefix ?? randomPrefix()), {
    link,
    ...(options.blocks && { blocks: options.blocks }),
  });
  return { blocks, notes: [...notes] };
}
