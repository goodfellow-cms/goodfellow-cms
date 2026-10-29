---
"goodfellow": minor
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/registry": minor
---

`goodfellow build` runs a site's Client Components with Preact (`preact/compat`) instead of React where every one of them says it works with it (`export const worksWithPreact = true` in its `"use client"` file), which every interactive block in Goodfellow's registry now does: pages with them load about 32 kB of JavaScript instead of about 230 kB. Islands are rendered with Preact where pages are built too, so `useId()` gives the same ids as in the browser, each island's with a prefix of its own. A Client Component that doesn't say so keeps the site on React, and the build names it; `preact: false` in the config keeps React whatever they say. `goodfellow dev` and Next.js always use React. `@goodfellow-cms/react/island` has `setIslandRenderer()` for this.
