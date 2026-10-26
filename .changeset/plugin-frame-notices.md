---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Plugins' frames come with the notices of what they bundle: `goodfellow build`, `goodfellow dev`, `goodfellow-next finish` and `next dev` write `admin/plugins/<id>/LICENSES.txt` beside each frame, listing every package it bundles with its version, license and where its source is, then each license text once, and the frame's page links to it. Editor plugins' `session.styles()` gives `{ stylesheets, tailwind }`, with Tailwind's source for classes the site's last build hasn't seen, and `htmlBlocks()` in `@goodfellow-cms/core/wordpress` turns pasted HTML into the site's blocks with the WordPress import's conversion.
