---
"@goodfellow-cms/mcp": patch
---

Claude's `update_settings` changes only the part of a setting it's given: asked to change one color, it keeps the rest of the theme, its dark colors, fonts, and parts' classes, and the rest of the contact details, where before it replaced the whole theme. `null` takes a setting out.
