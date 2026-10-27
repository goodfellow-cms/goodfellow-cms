---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/admin": minor
---

Staging copies of a site: a build with `GOODFELLOW_SITE_URL` uses that address in place of the Site address, and `GOODFELLOW_NO_INDEX=true` keeps every page out of search engines, without either one reaching content. The config's `copies` lists them for the sign-in service, through `goodfellow-site.json`. A copy at an address of its own keeps its admin panel there, and the Domain screen says where it is.
