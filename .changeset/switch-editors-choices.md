---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/admin": patch
---

Switching from an editor plugin back to Puck keeps what was edited where a block fills in its own choices, such as Collection list's choice of its collection's fields: the site's description says which blocks do (`resolvesFields`), and values left as the editor opened them are kept. Anything that still can't be kept is named by its block and setting, not its place in the page's data.
