---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/next": minor
---

The built-in blocks no longer need React in visitors' browsers. The Code block's copy button, the Dark mode switch and the Search box are plain HTML, each made to work by a small script of its own in `@goodfellow-cms/core` (`copyScript()`, `darkModeScript()`, `searchScript()`), which `goodfellow build` adds only to the pages that use it (`blockScriptsFor()`) and Next.js sites' layout has all of. A page made of built-in blocks now loads no React at all, about 70 kB less on pages with search or a Dark mode switch. `CodeView` no longer takes `code`: the copy button copies the `<pre>` beside it. Search results are plain links, so on a Next.js site choosing one loads its page.
