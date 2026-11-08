---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"goodfellow": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/expo": patch
---

The content API's manifest lists a hash of each media library file (`media`), which both builds write, so apps download a picture replaced at the same address again. The field is optional, so apps that don't know it keep working.
