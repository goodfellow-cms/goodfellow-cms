---
"create-goodfellow": patch
---

Full-stack sites' **Deploy** workflow checks what the build job built before the deploy job, which holds the Cloudflare token and the site's keys, gives it to wrangler. The build runs the site's code and every package it loads, and wrangler follows the config it writes, which could name a command to run before uploading, or files outside `dist/` to upload with the Worker, such as the deploy's own environment. The new `scripts/check-build.ts` takes the build's config only where it's `wrangler.jsonc`'s, leaving none of its settings out, with the build's own files in `dist/` and no links. Sites made with `create-goodfellow --server cloudflare` or the full-stack setup page before this release keep their copy: copy the example's `.github/workflows/deploy.yml` and `scripts/check-build.ts` into the site's code repository.
