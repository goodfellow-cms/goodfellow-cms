---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
---

Plugins can offer a page editor of their own (`editor` in a plugin, its admin module's `editor.mount()`), which each person editing the site can choose in place of the standard editor from the editor's header, for pages and, where the plugin says so, the header, footer and collections' templates. It runs in the plugin's sandboxed frame, is given what's edited, the blocks' fields, the site's settings and pages, the media library and the link preview, and hands back what's edited; the admin panel keeps Publish, drafts, the AI assistant, and Undo and Redo, and publishes only what passes `checkEditedData()` against the site's blocks. The Plugins screen and the token broker say when a plugin offers an editor, and installed plugins need approving again to add one.
