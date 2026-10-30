---
"@goodfellow-cms/admin": minor
"@goodfellow-cms/ai": minor
---

Owners can add a language for the admin panel and have it translated in Site Settings → Admin panel languages, with the AI service they choose, as in the editor's AI panel. The admin panel's words, the editor's controls and the site's blocks' labels are translated a batch at a time, with a glossary that keeps the admin panel's words the same throughout and plain, every answer checked before it's used, and what comes back published at once, even if the service stops part way. The screen shows how much each language says, and translates again what's missing or out of date. `@goodfellow-cms/ai` has `translateAdminText()`, `adminTextRequest()` and `readAdminTextAnswer()`.
