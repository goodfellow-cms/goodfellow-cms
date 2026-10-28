---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
---

A page's address can no longer end in `/index`. Such a page was stored in the file of the page above it, so making `/index` replaced the home page, and `/news/index` the page at `/news`. The admin panel now says the address can't be used, and the Claude connector, imports and items' addresses refuse it too.
