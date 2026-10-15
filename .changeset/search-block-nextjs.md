---
"@goodfellow-cms/blocks": patch
---

The Search block works in Next.js sites: it passed all its props to its search box, including Puck's functions, which Next.js can't send to the browser, so pages with one failed to build.
