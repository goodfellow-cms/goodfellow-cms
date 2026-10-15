---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/ai": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/next": minor
---

Full-stack Next.js sites (roadmap step 24): a Next.js app with a server of its own can be a Goodfellow site whose editors sign in with the app's own sign-in, while its server reads and publishes through GitHub or GitLab with one token that never reaches a browser.

- `goodfellowApi()` from `@goodfellow-cms/next/server` is the admin panel's API, as a catch-all route. The app's `authorize(request)` says who's signed in and whether they're an `editor` or an `owner`; only owners change Site Settings, blocks, and collections' settings and templates, which the server checks on every write. Commits name the editor as their author.
- `<GoodfellowAdmin server="/api/goodfellow" />` signs in through the app, and `withGoodfellow(config, { server: true })` builds for a server instead of static files.
- `ai: { anthropic: process.env.ANTHROPIC_API_KEY }` sends the AI assistant's requests through the server with the site's key (`aiServer()` in `@goodfellow-cms/ai`), so editors don't need keys of their own.
- `github()` and `gitlab()` have `server({ token })`, and core's `appApi()` (in `@goodfellow-cms/core/node`) is the API for other frameworks.
- Calendar files and search are static on full-stack sites too: `goodfellow-next finish --server`, after `next build`, writes the calendar files into `public/calendars/` and indexes the pages Next.js rendered into `public/pagefind/`.
