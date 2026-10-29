---
"@goodfellow-cms/core": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/registry": patch
---

On full-stack Next.js sites, only owners can choose to use Custom HTML exactly as written, which runs it on the site. Editors see the setting but can't change it, and the site's server refuses a publish that changes it or adds the block with it. Blocks of a site's own can mark settings like that with `metadata: { owners: true }` (`ownersOnlyFields()` and `ownersOnlyChanges()` in `@goodfellow-cms/core`, `AppApiOptions.ownersOnly`).
