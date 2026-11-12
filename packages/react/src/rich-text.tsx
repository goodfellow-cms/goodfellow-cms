import { cleanRichText } from "@goodfellow-cms/core";
import type { Config, FieldTransforms } from "@puckeditor/core";

/**
 * Rich text as pages show it, rendered by Goodfellow rather than Puck: `cleanRichText()` keeps what Puck's editor
 * makes, so it needs no editor code, loads nothing, and renders in one pass on the server and in previews alike.
 */
export function RichTextHtml({ html }: { html: unknown }) {
  const clean = typeof html === "string" ? cleanRichText(html) : "";
  // biome-ignore lint/security/noDangerouslySetInnerHtml: cleanRichText() keeps only formatting and safe links.
  return <div className="rich-text" dangerouslySetInnerHTML={{ __html: clean }} />;
}

/** Puck's field transform for rich text, which `Render` uses in place of its own renderer for every rich text field. */
export const richTextTransforms: FieldTransforms<Config> = {
  richtext: ({ value }) => <RichTextHtml html={value} />,
};
