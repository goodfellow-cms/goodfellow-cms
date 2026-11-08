---
"@goodfellow-cms/admin": minor
"@goodfellow-cms/core": minor
---

New pages, duplicates, and translations now start out not published: they're saved with the site, marked **Not published yet** on the Pages screen, and left out of builds until someone publishes them, with **Publish** in their editor or beside them on the Pages screen. Content files mark them with an optional `notPublished: true`.
