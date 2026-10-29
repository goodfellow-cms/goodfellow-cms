---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Builds make smaller copies of the media library's photos, 480, 800, 1200 and 1600 pixels wide, and images list them in `srcset`, so phones download no more than they show. `goodfellow build` and `goodfellow-next finish` (for static exports without an image loader of their own) write them into `media-sizes/`. Base paths now also apply to `srcset` as React spells it.
