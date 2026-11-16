---
"@goodfellow-cms/react": patch
---

Pages `goodfellow build` and `goodfellow dev` render put what blocks pass to Client Components into the page even where the site's own code holds text that looks like a template tag, such as `"<template>"` in a script's string, a comment, or an attribute, or a stray `</template>`. Before, the page came back with every island's passed content left in its template, so visitors without JavaScript, search engines, and the site's search didn't see it.
