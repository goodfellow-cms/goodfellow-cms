---
"create-goodfellow": patch
---

New sites made with `npm create goodfellow -- --server cloudflare` keep installing with Node 22's npm when vitest releases a new version. The site's `package.json` takes vitest 5.1.1 or any later 5.x release, where it named one release exactly: npm 10 stopped with `Cannot read properties of null (reading 'edgesOut')` once a newer one was out.
