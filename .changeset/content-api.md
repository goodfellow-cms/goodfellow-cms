---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Builds write a content API at `/api/`: the site's content as static JSON, each page as it's shown after preparation, with each language's settings, menus, collections, header and footer, and a manifest listing every file with a hash, so apps and other sites can show the site without a server. Rich text and Markdown are written as sanitized HTML, as pages have them, and also as a simple structure an app can draw without an HTML renderer. `goodfellow build` and `goodfellow-next finish` write the same files, and the config's `api: false` leaves them out. Numbered lists that start past 1 keep their start when rich text is sanitized.
