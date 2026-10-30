---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/expo": minor
"@goodfellow-cms/blocks": patch
---

The media library describes images: **Describe** on the Media screen says what an image shows, in each of the site's languages, kept in `content/media.json`, and images whose blocks leave their description empty use it, on the site, in the editor and in apps through the content API's `site.json`. The Media screen's search finds files by their descriptions too, and **Select files** deletes several files in one publish. `mediaFileChange()` now takes `{ credits, descriptions }`, and `withoutCredits()` is `withoutMediaDetails()`.
