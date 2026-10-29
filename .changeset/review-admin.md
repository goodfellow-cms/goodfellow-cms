---
"@goodfellow-cms/admin": patch
"@goodfellow-cms/core": patch
---

The admin panel checks what Puck's editor hands back before publishing it (`checkPuckData()`), as it does editor plugins': only plain data, and only the site's blocks. Uploaded SVGs keep what they load as they draw to the file itself and the site, so opening one tells no other site. Media addresses are checked once decoded, so `%2e%2e` can't name another folder and a stray `%` no longer stops the admin panel. Blocks are installed from the registry release the admin panel came with, even where a build bundles its source, never the newest one.
