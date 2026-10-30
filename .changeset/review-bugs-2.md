---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/next": patch
---

Front matter ends only at a line of its own `---`; moving a page re-points redirects to it however they write its address; languages with capitals, such as pt-BR, can have their own item addresses; structured data gives a time clocks skip as the instant it is; an event can't stop repeating before it starts, and a daily event from long ago shows its next day; `goodfellow due` reads a copy's own build record and, the first time, looks back to when the live site was built; `goodfellow-next finish` reads what `next build` wrote wherever the config's `distDir` puts it; scheduled builds are kept in step with the live site only, never a draft, and stale ones are removed once the admin panel loads; and the Updates screen waits for the run it started before showing how it went.
