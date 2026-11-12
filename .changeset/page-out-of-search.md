---
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/core": minor
---

Pages and collections' templates have a new setting, **The site's search**: **Leave this page out of it** (`noSearch`) keeps a page out of the Search block's index, separately from hiding it from search engines. "Page not found", which is never in the site's search, shows the setting as chosen, with no choice. The index has only the pages that mark content for it, so a site whose every page is left out gets an empty index, where Pagefind would otherwise have indexed every page whole.
