---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
---

A page's **Search engines** setting shows **Show in search results** where the page hasn't chosen, as that's what it does, without writing the choice into the page's file. **Page not found**, which is never in search results, shows **Hide from search results**, and the setting can't be changed there. `neverIndexed()` says which pages search engines are never told about.
