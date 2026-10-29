---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/admin": patch
---

Links that would run code, such as `javascript:` or `data:` addresses in menus, buttons or items' link fields, are left out of built pages, and the site checks stop a publish that adds one. A file replaced in the media library must be the same kind as the one it replaces, and every file published into the media library, a plugin's included, is checked by the name it's saved under, with SVGs cleaned again.
