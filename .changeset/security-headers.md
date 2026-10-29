---
"@goodfellow-cms/core": patch
"@goodfellow-cms/next": patch
"goodfellow": patch
"create-goodfellow": patch
---

Sites on Cloudflare Pages and Vercel get safer headers: every file is sent with `X-Content-Type-Options: nosniff` and a referrer policy, the media library's SVGs open sandboxed, so they can never run as the site, and the admin panel can't be framed by another site and opens in a window the site's pages can't reach. Builds add the rules to `_headers` after the site's own; the starters' `vercel.ts` and `withGoodfellow()` give them to Vercel. A static site on Vercel from before this keeps its own `vercel.ts`: copy the starter's to get them.
