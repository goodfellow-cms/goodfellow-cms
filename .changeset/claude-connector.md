---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/ai": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/mcp": minor
"goodfellow": minor
---

Work on your site from Claude. Add Goodfellow's connector to Claude, sign in with GitHub or GitLab and choose your sites; Claude can then read and change pages, items, the header and footer, menus and settings in a draft, show you screenshots of them, and publish the draft or submit it for review, as a pull request or merge request. The new `@goodfellow-cms/mcp` package runs the same tools on your own computer, for Claude Code (`npx @goodfellow-cms/mcp`) and as a Claude Desktop extension, signed in with a token.

For this, every build publishes `goodfellow-site.json`, describing the site's blocks and the content formats it reads, and the admin panel has a preview page (`#/preview`) that shows unpublished content for screenshots. The GitHub and GitLab backends can keep changes in drafts (`drafts`) and read many files at once (`readFiles()`), and the admin panel's change helpers are in `@goodfellow-cms/core`.
