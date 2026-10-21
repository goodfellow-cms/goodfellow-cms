---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"goodfellow": minor
---

Site checks (roadmap step 26). Publishing in the admin panel now stops when it would leave links to pages, items or media that don't exist, including links a deletion or move would break, and lists suggestions editors can publish anyway: pages without a title or description, and theme colors text is hard to read on, which Site Settings → Colors & fonts also shows as colors are chosen. `goodfellow build` lists what the checks find, and `goodfellow build --strict` fails on errors. Core exports `checkSite()`, `publishProblems()`, `contrastProblems()`, `contrastRatio()` and `formatSiteProblem()`.

The default muted text color is a little darker (`#6b6b6b`), so it's easy enough to read on the subtle background color.
