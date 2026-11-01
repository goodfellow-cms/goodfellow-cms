---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
---

Import a folder of Markdown files, such as another static site's content: Site Settings' Import tab (formerly WordPress) and `goodfellow import markdown <folder>` (`goodfellow-next import markdown`) bring each folder in as pages or a collection, with links between the files at their new addresses, the pictures beside them copied into the media library, front matter as pages' settings and items' fields, and redirects from addresses that changed. `planMarkdownImport()` in `@goodfellow-cms/core/wordpress` plans it with no disk or network access.
