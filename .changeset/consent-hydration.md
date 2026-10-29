---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/registry": patch
---

On Next.js sites that ask visitors before loading other sites' content, a visitor who had agreed before no longer gets every player, script and piece of custom code loaded twice: the consent script now leaves the page's elements where React expects them. Custom HTML used exactly as written now waits for visitors to agree too, when it loads or runs anything. The notice and placeholders stay hidden whatever else styles them.
