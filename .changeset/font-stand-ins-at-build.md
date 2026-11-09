---
"@goodfellow-cms/next": patch
---

Full-stack Next.js sites' servers no longer include Fontaine's font measurements: `withGoodfellow()` works out the fonts' stand-ins while `next build` loads the config, so the server is about 3 MB smaller.

`goodfellow-next update` no longer adds `app/admin/editor/page.tsx` to full-stack sites, whose editor frames are static files: it adds it only where `app/admin/page.tsx` is one the starter wrote.
