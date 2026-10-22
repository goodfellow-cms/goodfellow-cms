---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
---

Restore the whole site as it was at an earlier publish, from Site Settings → Site history: every publish that changed the site's pages, items, settings or media, how the site looked after each, with its pictures, what has changed since, and restoring everything in `content/` and `public/media/` in one publish. Backends gain `filesAt(revision)`, which reads the site's files as they were, and `history()` lists a folder's publishes as well as a file's.
