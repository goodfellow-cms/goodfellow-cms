---
"@goodfellow-cms/next": patch
---

Full-stack sites' editor frames are now bundled from the site's code by `goodfellow-next finish --server`, into `public/admin/editor/frames/`, as `next dev` bundles them, rather than taken from the page `next build` rendered. Their page runs no inline scripts, so the server sends its Content Security Policy as a header, and the step needs nothing `next build` writes, so it also works with builds that write no `.next/` folder. Add `public/admin/editor/frames/` to the site's `.gitignore`, as the Next.js starter's now has.
