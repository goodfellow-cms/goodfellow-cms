---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/registry": minor
---

Sites can ask visitors before showing content from other sites. With **Site Settings → General → Visitors' consent** on, a notice at the bottom of each page asks, and until visitors agree, YouTube, Vimeo and other sites' players, Google forms and maps load nothing and show a note with a button in their place, hCaptcha waits, and the site's custom code (all of the end of the page's, and the head's scripts, links and `noscript`) waits too. The answer is kept in the visitor's browser, links to `#consent` open the notice again, and every word of it can be changed, in each of the site's languages.
