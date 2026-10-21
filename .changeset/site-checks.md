---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
---

Site checks (roadmap step 26). Publishing in the admin panel now stops when it would leave links to pages, items or media that don't exist, including links a deletion would break, and lists suggestions editors can publish anyway: pages without a title or description, and theme colors text is hard to read on, which Site Settings → Colors & fonts also shows as colors are chosen. `goodfellow build` lists what the checks find, and `goodfellow build --strict` fails on errors. Core exports `checkSite()`, `publishProblems()`, `contrastProblems()`, `contrastRatio()` and `formatSiteProblem()`.

Moving a page, renaming an item or changing a collection's address pattern now changes every link to them on the site in the same publish (blocks, rich text, Markdown, items' fields, menus and redirects), so moves never stop a publish, and the move dialog no longer asks about menu links. `movePageChanges()` and `moveEntryChanges()` take the site's content (and its blocks, which say where links are) in place of its menus, `relinkSite()` and `relinkedChanges()` do the same for any change of addresses, and `updateMenuLinks()` is gone.

The default muted text color is a little darker (`#6b6b6b`), so it's easy enough to read on the subtle background color.
