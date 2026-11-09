---
"@goodfellow-cms/next": patch
---

`goodfellow-next finish --server` no longer needs the `.next/` folder `next build` writes. It renders the site's pages for the search index and the page checks from the content and the config, as `goodfellow build` does, and reads `basePath` and `trailingSlash` from `next.config.ts` when there's no build to read them from, so it can run before builds that write no `.next/`, such as vinext's, as well as after `next build`.
