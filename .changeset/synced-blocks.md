---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/mcp": minor
---

Synced blocks: blocks kept once in `content/synced-blocks/` and shown wherever the new Synced block block places them, on pages, collections' designs and the header and footer, so changing one changes every page. The admin panel lists, makes, renames and deletes them, edits each in an editor of its own (with a version for each language), saves a block on a page as one and detaches one into a page's own blocks. The site checks catch synced blocks that aren't there, links inside them are checked and moved with pages, the Claude connector reads and writes them, and WordPress's synced patterns import and export as synced blocks.
