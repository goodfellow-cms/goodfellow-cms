---
"@goodfellow-cms/core": patch
"create-goodfellow": patch
---

New sites' `package.json` has npm overrides that move happy-dom, which Puck renders rich text with through `@tiptap/html`, to 21.0.4, which fixes GHSA-834v-8h66-3h79 and GHSA-c8p4-j97h-3vg8, so `npm audit` finds nothing in a new site. `goodfellow update` adds them to older sites, and replaces the copies of happy-dom their lockfile has.
