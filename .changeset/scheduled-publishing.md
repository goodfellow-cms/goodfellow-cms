---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/mcp": minor
"goodfellow": minor
"create-goodfellow": minor
---

Scheduled publishing: pages and collection items can be shown from a time and hidden after one (`showFrom` and `hideAfter` in their files, in the site's time zone), which builds, `goodfellow dev` and Next.js apply, leaving menus' links to them out until they're shown. The admin panel schedules pages from the Pages screen and items in their editor, lists what's coming up, and warns that scheduled content can be read early on a public repository. On GitLab it adds a pipeline schedule at each time, so changes go live then; the starters' new `.github/workflows/scheduled.yml` checks each hour with the new `goodfellow due` command and builds the site only when something has come due. Letting editors publish on GitLab now lets Developers merge too, which adding those schedules needs.
