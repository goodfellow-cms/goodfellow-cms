---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"goodfellow": patch
"@goodfellow-cms/next": patch
---

Editor plugins' frames show the site's media as the standard editor does: from the site's folder on a site in a folder of its domain, from memory for a picture just uploaded that the site doesn't have yet, and from the storage a plugin keeps the site's media in, whose address their frames may now load images and videos from. Text edited in place keeps content's `/media/` addresses. Plugins can tell from `session.showsMedia` and leave the addresses as they are.
