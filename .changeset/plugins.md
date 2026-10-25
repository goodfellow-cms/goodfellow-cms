---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Plugins, which developers add in the site's config (`plugins`), add what blocks can't: an admin module run in a sandboxed frame of its own whose Content Security Policy reaches only the addresses it declares, screens in Site Settings that read and publish only the files it declares, build steps each run in a Node process of its own with Node's permission model and only the secrets it declares, and routes on full-stack Next.js sites' servers, as well as blocks of their own. Blocks in the editor ask a plugin's services with `useSite().callPlugin`. See the docs' Plugins page.
