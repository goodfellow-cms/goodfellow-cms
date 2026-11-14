---
"create-goodfellow": minor
"@goodfellow-cms/core": minor
---

`create-goodfellow --server cloudflare` makes a full-stack site from the company example: editors sign in with the site's own accounts, on a Cloudflare Worker with a D1 database, with its code and content in GitHub repositories of their own. In a terminal, it then offers to put the site online with wrangler, step by step: signing in, the database and cache, a deploy, the secrets, and the first admin. Core's `planServerSite()` plans the site's files with no disk access, and `@goodfellow-cms/core/node` exports `commandToRun()`.
