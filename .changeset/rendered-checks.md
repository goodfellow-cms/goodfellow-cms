---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Site checks on rendered pages, finishing roadmap step 26. Publishing warns about images without a description, headings that skip a level and links whose text, such as "Click here", doesn't say where they go, on the pages it changes as they'll show. `goodfellow build`, and `goodfellow-next finish` for Next.js sites, check every built page for those and with axe-core's accessibility rules, explained in plain words, and say that automated checks find only some problems. Core's new `@goodfellow-cms/core/accessibility` entry has `checkBuiltPages()` and `reportSiteProblems()`, and `renderedProblems()` is in the main entry.

Blocks' output is more accessible: the Image block has an "Only decoration" setting; logos beside the site's name and Collection list's pictures are marked as decoration; Collection list's item titles are level 2 headings when the list has no heading of its own, and Calendar's days are level 2; photo credits are no longer an `<aside>` inside the page's main content.
