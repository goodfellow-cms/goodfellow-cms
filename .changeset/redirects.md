---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Redirects: Site Settings has a Redirects tab for sending visitors from old addresses to new ones, and changing a page's address adds a redirect from its old one. Builds write a page at each old address that sends visitors on at once, which works on every host, `goodfellow dev` and `next dev` follow them too, and `goodfellow-next finish` writes them into Next.js exports.
