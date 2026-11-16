---
"@goodfellow-cms/github": patch
"@goodfellow-cms/core": patch
"@goodfellow-cms/next": patch
---

A full-stack site's server asks its token for a new one where GitHub refuses the one it has, as once it's been revoked, and tries the request again, as the admin panel's sign-in already does: `GitHost.server({ token })` and `goodfellowApi({ token })` take a function that's given `{ refresh: true }` then.
