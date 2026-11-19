---
"create-goodfellow": patch
---

New sites made with `npm create goodfellow -- --server cloudflare` install with Node 22's npm again. npm 10 crashed resolving the company example's vitest 5.1.0 once vitest 5.1.1 came out, so the example now uses 5.1.1. Sites made before keep the packages their lockfile names, which npm 10 installs as they are. The same crash stopped the docs from deploying, since the setup page's starters are written with Node 22's npm too.
