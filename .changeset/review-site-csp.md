---
"@goodfellow-cms/core": patch
"create-goodfellow": patch
---

Sites on Cloudflare Pages and Vercel send a Content Security Policy of `object-src 'none'; base-uri 'self'` with every page: no plugins (`<object>`, `<embed>`), and no `<base>` pointing the page's links at another site. Scripts, styles and frames stay unlimited, since custom code and embeds need them. A Vercel site from before this keeps its own `vercel.ts` until a developer copies the starter's.
