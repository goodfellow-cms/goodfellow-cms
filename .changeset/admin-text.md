---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

The admin panel speaks any language a site has its text in: `content/admin-text/<code>.json` holds its words, Puck's and blocks' labels, each with a hash of the English it was made from, and the language menu offers it beside English and Spanish. Every string is checked as it's used, falling back to English where it's empty, too long or has other placeholders than the English, and the English is shown beside the site's own words for signing in, tokens, owners' screens, plugins and what can't be undone. Only owners change the files. `goodfellow build` and `goodfellow-next finish` publish them beside the admin panel, in `admin/text/`, so the sign-in screen speaks them too; full-stack Next.js sites get them in `public/admin/text/`, which the starter's `.gitignore` now leaves out.
