---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/next": patch
---

Full-stack sites' servers check what they're sent as the admin panel does: media must be a kind the site can use by the name it's saved under, and SVGs already cleaned; pages sent as bytes are read as text; a block an owner set to be used exactly as written is the owner's whole, and two blocks with one id are refused; editors may add and remove media storage's files but not move it; and settings submitted for review are owners' too. SVG cleaning keeps out more ways of spelling another site's address (`/\host`, `URL(`, CSS escapes in any attribute, `image-set()`), and media SVGs are sandboxed however their extension is spelled. The Next.js starter has a `vercel.json` that turns off previews of drafts' and tasks' branches, which updates add to older Next.js sites.
