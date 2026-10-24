---
"@goodfellow-cms/core": patch
---

`goodfellow dev` and `next dev` write the admin panel's changes whole: each file goes to a temporary file first, then moves into place, so watchers and Tailwind never read one half-written. Tailwind keeps every class name it has seen until the development server restarts, so a half-written file could break the site's CSS until then.
