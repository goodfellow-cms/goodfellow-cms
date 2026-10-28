---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/ai": minor
---

Every block's look can be set without code: its CSS classes setting is now **Style**, which the editor shows as controls for text alignment, text size, text and background colors (the theme's, or your own), space inside and around it, each side or all at once, and rounded corners, with a note when text may be hard to read on its background. They're kept as Tailwind classes in the block's `className` (`readBlockStyle()` and `withBlockStyle()` in `@goodfellow-cms/core`), beside any other classes, which **Other CSS classes** keeps, so content files, themes' parts, the Gutenberg plugin and the AI assistant work with them as before. Blocks with an alignment setting of their own keep it.
