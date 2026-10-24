---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"create-goodfellow": minor
---

Drafts in the admin panel. The editors' **Add to draft**, beside **Publish**, keeps a change on a draft branch instead of publishing it, and while a draft is open every Publish adds to it. A bar on every screen shows the draft, with **Publish all**, which runs the site checks over everything in it and publishes it in one change with one rebuild, **Submit for review**, **Throw away** and **Back to the live site**. Drafts stay when the tab closes, other editors see them, and ones started from Claude can be finished there. Full-stack sites, demos and the development servers keep the draft in the browser instead (`keptDrafts()`). Drafts can be listed (`SiteDrafts.list()`), list the files they changed (`Draft.paths()`), and start at a given revision (`create(name, { from })`). The starters' `vercel.ts` turns off Vercel's previews of draft branches; existing sites on Vercel can add its `git: { deploymentEnabled: { "goodfellow-draft-*": false } }` line, and sites on Cloudflare Pages can set preview branches to None.
