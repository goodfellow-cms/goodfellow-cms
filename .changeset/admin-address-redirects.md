---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
---

Sites with an admin address on Vercel now send pages opened at the wrong address to the right one before they load: a site page opened at the admin address goes to the Site address, and, once the address is checked, the admin panel opened at the Site address goes to the admin address. Only pages opened in a tab are sent, so the admin panel's previews and what pages load stay where they are. The starters' `vercel.ts`, `withGoodfellow()` and content repositories' `vercel.ts` (`withVercelAdminAddress()`, kept in step by `goodfellow admin`) add them, from `vercelAdminRedirects()`. The docs give Cloudflare redirect rules that do the same on Cloudflare Pages. Existing sites on Vercel get them by copying the starter's `vercel.ts`.
