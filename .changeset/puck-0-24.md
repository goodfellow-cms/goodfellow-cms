---
"@goodfellow-cms/admin": minor
"@goodfellow-cms/ai": minor
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
"create-goodfellow": minor
---

Goodfellow uses Puck 0.24.0. In the editor, each block's toolbar has a drag handle, so a large block such as a section can be moved without dragging the block itself. A page's settings are in groups: the title, description and whether search engines show the page come first, the rarer search engine settings are in **More for search engines**, which starts closed, and the image, picture size and link preview are under **Sharing**; a collection's page design has the same. A site's own blocks can use Puck's new checkbox fields, which the AI assistant, the Claude connector and the checks of what an editor hands back know: their value is a list of the chosen options. Puck now asks for happy-dom 21 itself, so new sites no longer get an npm override for it; older sites keep theirs, which does nothing.
