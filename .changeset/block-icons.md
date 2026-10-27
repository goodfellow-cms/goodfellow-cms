---
"@goodfellow-cms/admin": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/core": minor
---

Every block in the editor's block list has its own icon, in place of the drag handle every block shared, and so do the blocks the search finds. Blocks get one with `withIcon()`, from Lucide-style icon data, which the site's description carries for editor plugins; the built-in blocks have Lucide's, and blocks without one show a box. Switching between the standard editor and an editor plugin now takes the latest changes along, and asks first when the other editor can't keep some of them.
