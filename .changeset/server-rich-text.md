---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": patch
---

Goodfellow renders rich text itself, in one pass on the server, rather than through Puck's renderer, which loaded TipTap and happy-dom and waited behind a Suspense boundary. Pages keep the formatting the editor makes (paragraphs, headings, lists, quotes, code, bold, italics, underline, strikethrough, links, line breaks, rules, and alignment) and leave out anything else, such as images that would load another site's files, keeping its text; links to the site's own pages no longer carry `target="_self"`. Core's new `cleanRichText()` and `RICH_TEXT_TAGS` do it, `@goodfellow-cms/react`'s `richTextTransforms` and `RichTextHtml` give it to Puck's `Render`, the editor's previews of the header, footer, items and synced blocks use it too, and the content API gives the same HTML.
